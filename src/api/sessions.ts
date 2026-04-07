import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson } from './router.js';

type SessionRow = {
  sessionId: string;
  provider: string | null;
  name: string | null;
  agentName: string | null;
  state: string | null;
  activeJobId: string | null;
  lastJobId: string | null;
  conversationRef: string | null;
  providerContinuity: string | null;
  model: string | null;
  cwd: string | null;
  projectRoot: string | null;
  backendNamespace: string | null;
  shardHash: string | null;
  provenanceState: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  version: number | null;
};

export function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const parts = requestUrl.pathname.split('/').filter(Boolean);

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'sessions') {
    const sessionId = decodeURIComponent(parts[2]);
    const session = db.prepare('SELECT * FROM sessions WHERE sessionId = ?').get(sessionId) as SessionRow | undefined;
    if (!session) {
      sendJson(res, 404, { error: 'session_not_found' });
      return true;
    }

    sendJson(res, 200, { session: toApiSession(session) });
    return true;
  }

  if (requestUrl.pathname !== '/api/sessions') {
    return false;
  }

  const sessions = db.prepare(`
    SELECT *
    FROM sessions
    ORDER BY lastUsedAt DESC, createdAt DESC, sessionId DESC
  `).all() as SessionRow[];
  sendJson(res, 200, { sessions: sessions.map(toApiSession) });
  return true;
}

function toApiSession(row: SessionRow): Record<string, unknown> {
  const session: Record<string, unknown> = {
    sessionId: row.sessionId,
    provenanceState: normalizeProvenanceState(row.provenanceState),
  };

  if (row.provider !== null) session.provider = row.provider;
  if (row.name !== null) session.name = row.name;
  if (row.agentName !== null) session.agentName = row.agentName;
  if (row.state !== null) session.state = row.state;
  if (row.activeJobId !== null) session.activeJobId = row.activeJobId;
  if (row.lastJobId !== null) session.lastJobId = row.lastJobId;
  if (row.conversationRef !== null) session.conversationRef = row.conversationRef;
  if (row.model !== null) session.model = row.model;
  if (row.cwd !== null) session.cwd = row.cwd;
  if (row.projectRoot !== null) session.projectRoot = row.projectRoot;
  if (row.backendNamespace !== null) session.backendNamespace = row.backendNamespace;
  if (row.shardHash !== null) session.shardHash = row.shardHash;
  if (row.createdAt !== null) session.createdAt = row.createdAt;
  if (row.lastUsedAt !== null) session.lastUsedAt = row.lastUsedAt;
  if (row.version !== null) session.version = row.version;

  const providerContinuity = parseProviderContinuity(row.providerContinuity);
  if (providerContinuity !== null) {
    session.providerContinuity = providerContinuity;
  }

  return session;
}

function normalizeProvenanceState(value: string): 'authoritative' | 'legacy_unresolved' {
  return value === 'authoritative' ? 'authoritative' : 'legacy_unresolved';
}

function parseProviderContinuity(value: string | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}
