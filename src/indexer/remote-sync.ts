import type Database from 'better-sqlite3';
import type { DiscussDetailResponse } from 'coral/client';
import { upsertDiscussDetail, type UpsertDiscussResult } from './discuss-index.js';
import { toReefId } from './source-ids.js';

export type SyncConfig = {
  connectionId: string;
  host: string;
  port: number;
  token: string;
  signal?: AbortSignal;
};

export type DiscussSyncParams = {
  projectRoot: string;
  originDiscussSessionId: string;
  status: string;
};

type RemoteSessionProvenanceState = 'authoritative' | 'legacy_unresolved';

type RemoteSessionEntry = {
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
  provenanceState: RemoteSessionProvenanceState;
};

export async function remoteSync(db: Database.Database, config: SyncConfig): Promise<void> {
  const { connectionId, host, port, token, signal } = config;
  const baseUrl = `http://${host}:${port}`;
  const headers: Record<string, string> = { 'X-Coral-Backend-Token': token };

  const [jobsRes, sessionsRes, discussRes] = await Promise.all([
    safeFetch<{ jobs: Array<Record<string, unknown>> }>(`${baseUrl}/api/jobs`, headers, signal),
    safeFetch<{ sessions: RemoteSessionEntry[] }>(`${baseUrl}/sessions`, headers, signal),
    safeFetch<{ sessions: Array<Record<string, unknown>> }>(`${baseUrl}/api/discuss`, headers, signal),
  ]);

  if (signal?.aborted) return;

  if (jobsRes && Array.isArray(jobsRes.jobs)) {
    syncJobs(db, connectionId, jobsRes.jobs);
  }

  if (sessionsRes && Array.isArray(sessionsRes.sessions)) {
    syncSessions(db, connectionId, sessionsRes.sessions);
  }

  if (discussRes && Array.isArray(discussRes.sessions)) {
    await syncDiscussSessions(db, config, discussRes.sessions);
  }
}

function syncJobs(db: Database.Database, connectionId: string, jobs: Array<Record<string, unknown>>): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO jobs (
      jobId, sessionId, provider, projectRoot, phase, launchState, createdAt,
      completedAt, result, jobKind, costUsd, inputTokens, outputTokens, durationMs,
      connectionId, originJobId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((): void => {
    for (const job of jobs) {
      const originJobId = str(job, 'jobId') ?? '';
      const reefJobId = toReefId(connectionId, originJobId);

      insert.run(
        reefJobId,
        str(job, 'sessionId') ?? '',
        str(job, 'provider') ?? 'unknown',
        str(job, 'projectRoot') ?? '',
        str(job, 'phase') ?? 'running',
        str(job, 'launchState') ?? null,
        str(job, 'createdAt') ?? null,
        str(job, 'completedAt') ?? null,
        typeof job.result === 'object' && job.result !== null ? JSON.stringify(job.result) : str(job, 'result'),
        str(job, 'jobKind') ?? 'provider',
        num(job, 'costUsd'),
        num(job, 'inputTokens'),
        num(job, 'outputTokens'),
        num(job, 'durationMs'),
        connectionId,
        originJobId,
      );
    }
  });

  try {
    transaction();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[sync:${connectionId}] Jobs sync failed: ${message}\n`);
  }
}

function syncSessions(db: Database.Database, connectionId: string, sessions: RemoteSessionEntry[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      sessionId, provider, name, agentName, state, activeJobId, lastJobId, conversationRef,
      providerContinuity, model, cwd, projectRoot, backendNamespace, provenanceState,
      createdAt, lastUsedAt, version,
      connectionId, originSessionId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((): void => {
    for (const session of sessions) {
      const originSessionId = session.sessionId;
      if (originSessionId.length === 0) {
        continue;
      }
      const reefSessionId = toReefId(connectionId, originSessionId);

      insert.run(
        reefSessionId,
        session.provider ?? null,
        session.name ?? null,
        session.agentName ?? null,
        session.state ?? null,
        session.activeJobId ?? null,
        session.lastJobId ?? null,
        session.conversationRef ?? null,
        session.providerContinuity ? JSON.stringify(session.providerContinuity) : null,
        session.model ?? null,
        session.cwd ?? null,
        session.projectRoot ?? null,
        session.backendNamespace ?? null,
        session.provenanceState,
        session.createdAt ?? null,
        session.lastUsedAt ?? null,
        typeof session.version === 'number' ? session.version : null,
        connectionId,
        originSessionId,
      );
    }
  });

  try {
    transaction();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[sync:${connectionId}] Sessions sync failed: ${message}\n`);
  }
}

async function syncDiscussSessions(
  db: Database.Database,
  config: SyncConfig,
  sessions: Array<Record<string, unknown>>,
): Promise<void> {
  for (const session of sessions) {
    if (config.signal?.aborted) return;

    const projectRoot = str(session, 'projectRoot');
    const originDiscussSessionId = str(session, 'sessionId');
    if (!projectRoot || !originDiscussSessionId) {
      continue;
    }

    try {
      await syncDiscussSession(db, config, {
        projectRoot,
        originDiscussSessionId,
        status: str(session, 'status') ?? 'unknown',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[sync:${config.connectionId}] Discuss session ${originDiscussSessionId} sync failed: ${message}\n`);
    }
  }
}

export async function syncDiscussSession(
  db: Database.Database,
  config: SyncConfig,
  params: DiscussSyncParams,
): Promise<UpsertDiscussResult | null> {
  const detail = await fetchDiscussDetail(config, params);
  if (!detail) {
    return null;
  }

  return upsertDiscussDetail(db, detail, {
    connectionId: config.connectionId,
    projectRoot: params.projectRoot,
    originDiscussSessionId: params.originDiscussSessionId,
  });
}

async function fetchDiscussDetail(
  config: SyncConfig,
  params: DiscussSyncParams,
): Promise<DiscussDetailResponse | null> {
  const { host, port, token, signal } = config;
  const baseUrl = `http://${host}:${port}`;
  const headers: Record<string, string> = { 'X-Coral-Backend-Token': token };
  const preferredView = params.status === 'ended' ? 'audit' : 'control';

  const detail = await safeFetch<DiscussDetailResponse>(
    buildDiscussDetailUrl(baseUrl, params.projectRoot, params.originDiscussSessionId, preferredView),
    headers,
    signal,
  );

  if (!detail) {
    return null;
  }

  if (preferredView === 'control' && detail.session.status === 'ended') {
    return await safeFetch<DiscussDetailResponse>(
      buildDiscussDetailUrl(baseUrl, params.projectRoot, params.originDiscussSessionId, 'audit'),
      headers,
      signal,
    ) ?? detail;
  }

  return detail;
}

function buildDiscussDetailUrl(
  baseUrl: string,
  projectRoot: string,
  sessionId: string,
  view: 'control' | 'audit',
): string {
  return `${baseUrl}/api/discuss/detail?projectRoot=${encodeURIComponent(projectRoot)}&sessionId=${encodeURIComponent(sessionId)}&view=${view}`;
}

async function safeFetch<T>(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T | null> {
  try {
    const response = await fetch(url, { method: 'GET', headers, signal });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function str(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

function num(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === 'number' ? value : null;
}
