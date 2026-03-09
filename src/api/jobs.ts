import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { sendJson } from './router.js';

export function handleJobs(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const parts = requestUrl.pathname.split('/').filter(Boolean);

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'jobs') {
    const jobId = decodeURIComponent(parts[2]);
    const job = db.prepare('SELECT * FROM jobs WHERE jobId = ?').get(jobId);
    if (!job) {
      sendJson(res, 404, { error: 'job_not_found' });
      return true;
    }

    const events = db.prepare('SELECT * FROM events WHERE jobId = ? ORDER BY eventId ASC').all(jobId);
    sendJson(res, 200, { job, events });
    return true;
  }

  if (requestUrl.pathname !== '/api/jobs') {
    return false;
  }

  const jobs = db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC, jobId DESC').all();
  sendJson(res, 200, { jobs });
  return true;
}
