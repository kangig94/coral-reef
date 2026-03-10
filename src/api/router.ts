import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import type { ConnectionManager } from '../indexer/connection-manager.js';
import { handleChat } from './chat.js';
import { handleConnections } from './connections.js';
import { handleDiscuss } from './discuss.js';
import { handleHealth } from './health.js';
import { handleJobs } from './jobs.js';
import { handleMetrics } from './metrics.js';
import { handleSessions } from './sessions.js';
import { handleWorkflows } from './workflows.js';

export async function routeApi(
  req: IncomingMessage,
  res: ServerResponse,
  db: Database.Database,
  manager?: ConnectionManager,
): Promise<boolean> {
  const url = req.url ?? '';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (url.startsWith('/api/connections') && manager) return handleConnections(req, res, manager);
  if (url.startsWith('/api/jobs')) return handleJobs(req, res, db);
  if (url.startsWith('/api/sessions')) return handleSessions(req, res, db);
  if (url.startsWith('/api/discuss')) return handleDiscuss(req, res, db);
  if (url.startsWith('/api/workflows')) return handleWorkflows(req, res, db);
  if (url.startsWith('/api/metrics')) return handleMetrics(req, res, db);
  if (url.startsWith('/api/chat')) return handleChat(req, res);
  if (url.startsWith('/api/system/health')) return handleHealth(req, res, db);

  return false;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
