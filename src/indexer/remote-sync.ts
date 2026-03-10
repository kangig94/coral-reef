import type Database from 'better-sqlite3';
import { toReefId, toDiscussReefId } from './source-ids.js';

export type SyncConfig = {
  connectionId: string;
  host: string;
  port: number;
  token: string;
  signal?: AbortSignal;
};

export async function remoteSync(db: Database.Database, config: SyncConfig): Promise<void> {
  const { connectionId, host, port, token, signal } = config;
  const baseUrl = `http://${host}:${port}`;
  const headers: Record<string, string> = { 'X-Coral-Backend-Token': token };

  const [jobsRes, sessionsRes, discussRes] = await Promise.all([
    safeFetch(`${baseUrl}/api/jobs`, headers, signal),
    safeFetch(`${baseUrl}/api/sessions`, headers, signal),
    safeFetch(`${baseUrl}/api/discuss`, headers, signal),
  ]);

  if (signal?.aborted) return;

  if (jobsRes) {
    const { jobs } = jobsRes as { jobs: Array<Record<string, unknown>> };
    if (Array.isArray(jobs)) {
      syncJobs(db, connectionId, jobs);
    }
  }

  if (sessionsRes) {
    const { sessions } = sessionsRes as { sessions: Array<Record<string, unknown>> };
    if (Array.isArray(sessions)) {
      syncSessions(db, connectionId, sessions);
    }
  }

  if (discussRes) {
    const { sessions: discussSessions } = discussRes as { sessions: Array<Record<string, unknown>> };
    if (Array.isArray(discussSessions)) {
      await syncDiscussSessions(db, connectionId, baseUrl, headers, discussSessions, signal);
    }
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

function syncSessions(db: Database.Database, connectionId: string, sessions: Array<Record<string, unknown>>): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      sessionId, provider, name, state, model, cwd, projectRoot, shardHash,
      provenanceState, createdAt, lastUsedAt, version, activeJobId, lastJobId,
      connectionId, originSessionId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((): void => {
    for (const session of sessions) {
      const originSessionId = str(session, 'sessionId') ?? '';
      const reefSessionId = toReefId(connectionId, originSessionId);

      insert.run(
        reefSessionId,
        str(session, 'provider') ?? 'unknown',
        str(session, 'name') ?? '',
        str(session, 'state') ?? 'pending',
        str(session, 'model') ?? 'unknown',
        str(session, 'cwd') ?? '',
        str(session, 'projectRoot') ?? null,
        str(session, 'shardHash') ?? '',
        'resolved',
        str(session, 'createdAt') ?? null,
        str(session, 'lastUsedAt') ?? null,
        typeof session.version === 'number' ? session.version : 0,
        str(session, 'activeJobId') ?? null,
        str(session, 'lastJobId') ?? null,
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
  connectionId: string,
  baseUrl: string,
  headers: Record<string, string>,
  sessions: Array<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<void> {
  const insertDiscuss = db.prepare(`
    INSERT OR REPLACE INTO discuss_sessions (
      sessionId, topic, projectRoot, status, sessionDir, createdAt, lastActivityAt, stateJson,
      connectionId, originDiscussSessionId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteTranscript = db.prepare('DELETE FROM transcript_entries WHERE discussSessionId = ?');
  const insertTranscript = db.prepare(`
    INSERT INTO transcript_entries (
      discussSessionId, seq, kind, agent, content, epoch, round, ts, payload
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const session of sessions) {
    if (signal?.aborted) return;

    const originId = str(session, 'sessionId') ?? '';
    const projectRoot = str(session, 'projectRoot') ?? '';
    const reefId = toDiscussReefId({ connectionId, projectRoot, originDiscussSessionId: originId });

    const detailUrl = `${baseUrl}/api/discuss/detail?projectRoot=${encodeURIComponent(projectRoot)}&sessionId=${encodeURIComponent(originId)}`;
    const detail = await safeFetch(detailUrl, headers, signal) as {
      session?: Record<string, unknown>;
      transcript?: Array<Record<string, unknown>>;
    } | null;

    const detailSession = detail?.session;
    const transcript = detail?.transcript;

    const transaction = db.transaction((): void => {
      insertDiscuss.run(
        reefId,
        str(detailSession ?? session, 'topic') ?? str(session, 'topic') ?? '',
        projectRoot,
        str(detailSession ?? session, 'status') ?? 'unknown',
        str(detailSession ?? session, 'sessionDir') ?? '',
        str(detailSession ?? session, 'createdAt') ?? str(session, 'createdAt') ?? null,
        str(detailSession ?? session, 'lastActivityAt') ?? null,
        detailSession ? JSON.stringify(detailSession) : null,
        connectionId,
        originId,
      );

      if (transcript && Array.isArray(transcript)) {
        deleteTranscript.run(reefId);
        for (let i = 0; i < transcript.length; i++) {
          const entry = transcript[i];
          insertTranscript.run(
            reefId,
            i + 1,
            str(entry, 'type') ?? str(entry, 'kind') ?? 'unknown',
            str(entry, 'agent') ?? null,
            str(entry, 'content') ?? str(entry, 'summary') ?? str(entry, 'detail') ?? null,
            typeof entry.epoch === 'number' ? entry.epoch : null,
            typeof entry.step === 'number' ? entry.step : (typeof entry.round === 'number' ? entry.round : null),
            str(entry, 'ts') ?? null,
            JSON.stringify(entry),
          );
        }
      }
    });

    try {
      transaction();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[sync:${connectionId}] Discuss session ${originId} sync failed: ${message}\n`);
    }
  }
}

async function safeFetch(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(url, { method: 'GET', headers, signal });
    if (!response.ok) return null;
    return await response.json();
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
