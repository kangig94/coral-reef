import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { BackendHealth } from 'coral/client';
import { LOCAL_BACKEND_INFO_PATH } from '../coral-paths.js';
import type { ConnectionManager } from '../indexer/connection-manager.js';
import { getIndexerStatus } from '../indexer/index.js';
import { sendJson } from './router.js';

const HEALTH_TIMEOUT_MS = 3_000;

type BackendInfoFile = {
  pid: number;
  host: string;
  port: number;
  token: string;
  version: string;
  bundleHash: string;
  instanceId: string;
  startedAt: number;
};

type BackendStatus =
  | BackendHealth
  | { status: 'shutting_down' }
  | { status: 'not_running' }
  | { status: 'invalid_info' }
  | { status: 'unreachable'; reason: string };

export async function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
  manager?: ConnectionManager,
): Promise<boolean> {
  if (req.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/system/health') {
    return false;
  }

  const backend = await readBackendStatus();
  const pageCount = Number(db.pragma('page_count', { simple: true }) ?? 0);
  const pageSize = Number(db.pragma('page_size', { simple: true }) ?? 0);
  const journalMode = String(db.pragma('journal_mode', { simple: true }) ?? 'unknown');

  const response: Record<string, unknown> = {
    status: 'ok',
    indexer: getIndexerStatus(),
    db: {
      journalMode,
      pageCount,
      pageSize,
      estimatedSizeBytes: pageCount * pageSize,
      tables: {
        jobs: countRows(db, 'jobs'),
        events: countRows(db, 'events'),
        sessions: countRows(db, 'sessions'),
        discussSessions: countRows(db, 'discuss_sessions'),
        transcriptEntries: countRows(db, 'transcript_entries'),
        dailyMetrics: countRows(db, 'daily_metrics'),
      },
    },
    backend,
  };

  if (manager) {
    response.backends = manager.listConnections().map((conn) => ({
      id: conn.id,
      label: conn.label,
      host: conn.host,
      sseState: conn.sseState,
      status: conn.status,
    }));
  }

  sendJson(res, 200, response);
  return true;
}

function countRows(db: Database.Database, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function readBackendInfoFile(): BackendInfoFile | null {
  try {
    const raw = JSON.parse(readFileSync(LOCAL_BACKEND_INFO_PATH, 'utf-8')) as unknown;
    return isBackendInfoFile(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function readBackendStatus(): Promise<BackendStatus> {
  const info = readBackendInfoFile();
  if (!info) {
    return { status: 'not_running' };
  }

  if (!isProcessAlive(info.pid)) {
    return { status: 'unreachable', reason: 'stale_pid' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${info.host}:${info.port}/health`, {
      method: 'GET',
      headers: { 'X-Coral-Backend-Token': info.token },
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.status === 200 && isBackendHealth(body)) {
      return body;
    }

    if (
      response.status === 503
      && (isRecord(body) && body.error === 'backend_shutting_down')
    ) {
      return { status: 'shutting_down' };
    }

    return { status: 'unreachable', reason: `${response.status} ${response.statusText}` };
  } catch {
    return { status: 'unreachable', reason: 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function isBackendInfoFile(value: unknown): value is BackendInfoFile {
  if (!isRecord(value)
    || !Number.isInteger(value.pid)
    || !Number.isInteger(value.port)
    || typeof value.token !== 'string'
    || typeof value.version !== 'string'
    || typeof value.bundleHash !== 'string'
    || typeof value.instanceId !== 'string'
    || !Number.isFinite(value.startedAt)) {
    return false;
  }

  if (typeof value.host !== 'string') {
    (value as Record<string, unknown>).host = '127.0.0.1';
  }
  return true;
}

function isBackendHealth(value: unknown): value is BackendHealth {
  return isRecord(value)
    && value.status === 'ok'
    && typeof value.version === 'string'
    && typeof value.bundleHash === 'string'
    && typeof value.instanceId === 'string'
    && Number.isFinite(value.uptimeMs)
    && Number.isInteger(value.activeChildren)
    && Number.isInteger(value.activeJobs)
    && Number.isInteger(value.inflightRequests)
    && Number.isInteger(value.queueDepth);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    return nodeError.code === 'EPERM';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
