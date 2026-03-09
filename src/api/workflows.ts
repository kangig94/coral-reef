import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson } from './router.js';

export function handleWorkflows(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/workflows') {
    return false;
  }

  const workflows = db.prepare(`
    SELECT *
    FROM jobs
    WHERE jobKind = 'workflow'
    ORDER BY createdAt DESC, jobId DESC
  `).all();

  sendJson(res, 200, { workflows });
  return true;
}
