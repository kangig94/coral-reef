import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson } from './router.js';

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
    const session = db.prepare('SELECT * FROM sessions WHERE sessionId = ?').get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'session_not_found' });
      return true;
    }

    sendJson(res, 200, { session });
    return true;
  }

  if (requestUrl.pathname !== '/api/sessions') {
    return false;
  }

  const sessions = db.prepare(`
    SELECT *
    FROM sessions
    ORDER BY lastUsedAt DESC, createdAt DESC, sessionId DESC
  `).all();
  sendJson(res, 200, { sessions });
  return true;
}
