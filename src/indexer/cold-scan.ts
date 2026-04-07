import type Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  buildDiscussDetail,
  readDiscussDiscovery,
  readDiscussSnapshot,
  readProgressLog,
  readSessionEntryLenient,
  readStatusRecord,
} from 'coral/client';
import { JOBS_DIR, discussBaseDir, sessionBase } from 'coral/infra';
import { upsertDiscussDetail } from './discuss-index.js';

const SESSION_DIR_PATTERN = /^((?:\d{8}-\d{6}|\d{6}-\d{4})-[a-z0-9]+)-(.+)$/;

export type ColdScanResult = {
  jobs: number;
  sessions: number;
  discussSessions: number;
};

type DiscoveredDiscussSession = {
  sessionId: string;
  topic: string;
  sessionDir: string;
  createdAt: string | null;
};

type LenientIndexedSession = {
  sessionId: string;
  provider?: string;
  name?: string;
  agentName?: string;
  state?: string;
  activeJobId?: string;
  lastJobId?: string;
  conversationRef?: string;
  providerContinuity?: Record<string, unknown>;
  model?: string;
  cwd?: string;
  projectRoot?: string;
  backendNamespace?: string;
  createdAt?: string;
  lastUsedAt?: string;
  version?: number;
  provenanceState: 'authoritative' | 'legacy_unresolved';
};

export function coldScan(db: Database.Database): ColdScanResult {
  const jobs = scanJobs(db);
  const sessions = scanSessions(db);
  const discussSessions = scanDiscussSessions(db);

  return { jobs, sessions, discussSessions };
}

function scanJobs(db: Database.Database): number {
  let jobIds: string[];
  try {
    jobIds = readdirSync(JOBS_DIR);
  } catch {
    return 0;
  }

  const insertJob = db.prepare(`
    INSERT OR REPLACE INTO jobs (
      jobId, sessionId, provider, projectRoot, phase, launchState, createdAt,
      completedAt, result, jobKind, costUsd, inputTokens, outputTokens, durationMs,
      connectionId, originJobId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteEvents = db.prepare('DELETE FROM events WHERE jobId = ?');
  const insertEvent = db.prepare(`
    INSERT INTO events (jobId, eventId, type, ts, message, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const jobId of jobIds) {
    const status = readStatusRecord(jobId) as unknown;
    const eventRows = buildEventRows(readProgressLog(jobId) as unknown[]);
    const normalized = normalizeJobStatus(status, eventRows);
    if (!normalized) {
      continue;
    }

    insertJob.run(
      jobId,
      normalized.sessionId,
      normalized.provider,
      normalized.projectRoot,
      normalized.phase,
      normalized.launchState,
      normalized.createdAt,
      normalized.completedAt,
      normalized.result,
      normalized.jobKind,
      normalized.costUsd,
      normalized.inputTokens,
      normalized.outputTokens,
      normalized.durationMs,
      'local:auto',
      jobId,
    );

    deleteEvents.run(jobId);
    for (const event of eventRows) {
      insertEvent.run(
        jobId,
        event.eventId,
        event.type,
        event.ts,
        event.message ?? null,
        event.payload,
      );
    }

    count += 1;
  }

  return count;
}

function scanSessions(db: Database.Database): number {
  let shardDirs: string[];
  try {
    const baseDir = sessionBase();
    shardDirs = readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(baseDir, entry.name));
  } catch {
    return 0;
  }

  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      sessionId, provider, name, agentName, state, activeJobId, lastJobId, conversationRef,
      providerContinuity, model, cwd, projectRoot, backendNamespace, shardHash, provenanceState,
      createdAt, lastUsedAt, version,
      connectionId, originSessionId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const transaction = db.transaction((): void => {
    for (const shardDir of shardDirs) {
      const shardHash = basename(shardDir);
      let files: string[];
      try {
        files = readdirSync(shardDir).filter((file) => file.endsWith('.json'));
      } catch {
        continue;
      }

      for (const file of files) {
        const entry = readSessionEntryLenient(join(shardDir, file)) as LenientIndexedSession | null;
        if (!entry) {
          continue;
        }

        insertSession.run(
          entry.sessionId,
          entry.provider ?? null,
          entry.name ?? null,
          entry.agentName ?? null,
          entry.state ?? null,
          entry.activeJobId ?? null,
          entry.lastJobId ?? null,
          entry.conversationRef ?? null,
          entry.providerContinuity ? JSON.stringify(entry.providerContinuity) : null,
          entry.model ?? null,
          entry.cwd ?? null,
          entry.projectRoot ?? null,
          entry.backendNamespace ?? null,
          shardHash,
          entry.provenanceState,
          entry.createdAt ?? null,
          entry.lastUsedAt ?? null,
          typeof entry.version === 'number' ? entry.version : null,
          'local:auto',
          entry.sessionId,
        );
        count += 1;
      }
    }
  });

  transaction();
  return count;
}

function scanDiscussSessions(db: Database.Database): number {
  const projectRoots = db.prepare(`
    SELECT DISTINCT projectRoot
    FROM sessions
    WHERE projectRoot IS NOT NULL AND projectRoot != ''
  `).all() as Array<{ projectRoot: string }>;

  let count = 0;
  const transaction = db.transaction((): void => {
    for (const row of projectRoots) {
      const sessions = discoverDiscussSessions(row.projectRoot);
      for (const session of sessions) {
        const snapshot = readDiscussSnapshot(join(session.sessionDir, 'state.json'));
        if (!snapshot) {
          continue;
        }

        const detail = snapshot.state.status === 'ended'
          ? buildDiscussDetail(snapshot, 'audit', 'persisted')
          : buildDiscussDetail(snapshot, 'control', 'persisted');

        upsertDiscussDetail(db, detail, {
          connectionId: 'local:auto',
          projectRoot: snapshot.projectRoot,
          originDiscussSessionId: snapshot.sessionId,
          sessionDir: session.sessionDir,
        });

        count += 1;
      }
    }
  });

  transaction();
  return count;
}

function discoverDiscussSessions(projectRoot: string): DiscoveredDiscussSession[] {
  const discovery = readDiscussDiscovery(projectRoot);
  if (discovery) {
    return discovery.sessions.map((session) => ({
      sessionId: session.sessionId,
      topic: session.topic,
      sessionDir: session.sessionDir,
      createdAt: session.createdAt,
    }));
  }

  const baseDir = discussBaseDir(projectRoot);
  let entries: string[];
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const sessions: DiscoveredDiscussSession[] = [];
  for (const entry of entries) {
    const match = entry.match(SESSION_DIR_PATTERN);
    if (!match) {
      continue;
    }

    sessions.push({
      sessionId: match[1],
      topic: match[2],
      sessionDir: join(baseDir, entry),
      createdAt: null,
    });
  }

  return sessions;
}
function isTerminalPhase(phase: string): boolean {
  return phase === 'completed' || phase === 'error' || phase === 'aborted';
}

function normalizeJobStatus(
  value: unknown,
  eventRows: Array<{
    eventId: number;
    type: string;
    ts: string | null;
    message: string | null;
    payload: string;
  }>,
): {
  sessionId: string;
  provider: string;
  projectRoot: string;
  phase: string;
  launchState: string | null;
  createdAt: string | null;
  completedAt: string | null;
  result: string | null;
  jobKind: string;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const launch = readRecord(value, 'launch');
  const result = readRecord(value, 'result');
  const usage = readRecord(result, 'usage') ?? readRecord(value, 'usage');
  const phase = normalizePhase(value);
  const createdAt = readString(launch, 'updatedAt')
    ?? readString(value, 'createdAt')
    ?? eventRows[0]?.ts
    ?? null;
  const completedAt = readString(value, 'completedAt')
    ?? [...eventRows].reverse().find((event) => event.type === 'terminal')?.ts
    ?? (isTerminalPhase(phase) ? createdAt : null);

  return {
    sessionId: readString(value, 'sessionId') ?? readString(value, 'session') ?? '',
    provider: readString(value, 'provider') ?? 'unknown',
    projectRoot: readString(value, 'projectRoot') ?? '',
    phase,
    launchState: readString(launch, 'state') ?? normalizeLegacyLaunchState(readString(value, 'status')),
    createdAt,
    completedAt,
    result: result ? JSON.stringify(result) : null,
    jobKind: readString(value, 'jobKind') ?? 'provider',
    costUsd: readNumber(usage, 'costUsd') ?? readNumber(usage, 'cost_usd') ?? null,
    inputTokens: readInteger(usage, 'inputTokens') ?? readInteger(usage, 'input_tokens') ?? null,
    outputTokens: readInteger(usage, 'outputTokens') ?? readInteger(usage, 'output_tokens') ?? null,
    durationMs: readInteger(result, 'durationMs')
      ?? readInteger(value, 'durationMs')
      ?? readInteger(value, 'duration_ms')
      ?? null,
  };
}

function buildEventRows(
  events: unknown[],
): Array<{
  eventId: number;
  type: string;
  ts: string | null;
  message: string | null;
  payload: string;
}> {
  const rows: Array<{
    eventId: number;
    type: string;
    ts: string | null;
    message: string | null;
    payload: string;
  }> = [];

  for (const event of events) {
    if (!isRecord(event) || !Number.isInteger(event.eventId)) {
      continue;
    }

    rows.push({
      eventId: event.eventId as number,
      type: readString(event, 'type') ?? 'unknown',
      ts: readString(event, 'ts') ?? null,
      message: readString(event, 'message') ?? null,
      payload: JSON.stringify(event),
    });
  }

  return rows;
}

function normalizePhase(value: Record<string, unknown>): string {
  const phase = readString(value, 'phase');
  if (phase) {
    return phase;
  }

  const status = readString(value, 'status');
  if (
    status === 'queued'
    || status === 'launching'
    || status === 'running'
    || status === 'completed'
    || status === 'error'
    || status === 'aborted'
  ) {
    return status;
  }

  return 'running';
}

function normalizeLegacyLaunchState(status: string | null): string | null {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
    case 'completed':
      return 'ready';
    case 'error':
    case 'aborted':
      return 'error';
    default:
      return null;
  }
}

function readRecord(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  const candidate = value[key];
  return isRecord(candidate) ? candidate : null;
}

function readString(value: Record<string, unknown> | null, key: string): string | null {
  if (!value) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : null;
}

function readNumber(value: Record<string, unknown> | null, key: string): number | null {
  if (!value) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === 'number' ? candidate : null;
}

function readInteger(value: Record<string, unknown> | null, key: string): number | null {
  const candidate = readNumber(value, key);
  return Number.isInteger(candidate) ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
