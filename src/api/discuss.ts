import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson } from './router.js';

export function handleDiscuss(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const parts = requestUrl.pathname.split('/').filter(Boolean);

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'discuss') {
    const sessionId = decodeURIComponent(parts[2]);
    const session = db.prepare('SELECT * FROM discuss_sessions WHERE sessionId = ?').get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'discuss_session_not_found' });
      return true;
    }

    const transcript = db.prepare(`
      SELECT *
      FROM transcript_entries
      WHERE discussSessionId = ?
      ORDER BY seq ASC, id ASC
    `).all(sessionId);

    sendJson(res, 200, { session, transcript });
    return true;
  }

  if (requestUrl.pathname !== '/api/discuss') {
    return false;
  }

  const discussSessions = db.prepare(`
    SELECT *
    FROM discuss_sessions
    ORDER BY lastActivityAt DESC, createdAt DESC, sessionId DESC
  `).all();

  sendJson(res, 200, { discussSessions });
  return true;
}
