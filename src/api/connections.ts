import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConnectionManager } from '../indexer/connection-manager.js';
import { sendJson } from './router.js';

export async function handleConnections(
  req: IncomingMessage,
  res: ServerResponse,
  manager: ConnectionManager,
): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const parts = requestUrl.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api' || parts[1] !== 'connections') {
    return false;
  }

  if (req.method === 'GET' && parts.length === 2) {
    const connections = manager.listConnections();
    sendJson(res, 200, { connections });
    return true;
  }

  if (req.method === 'POST' && parts.length === 2) {
    if (!checkMutationOrigin(req, res)) return true;

    const body = await readBody(req);
    if (!body) {
      sendJson(res, 400, { error: 'invalid_body' });
      return true;
    }

    const { label, host, port, token } = body as Record<string, unknown>;
    if (typeof label !== 'string' || typeof host !== 'string' || typeof port !== 'number' || typeof token !== 'string') {
      sendJson(res, 400, { error: 'missing_fields', required: ['label', 'host', 'port', 'token'] });
      return true;
    }

    const id = manager.addManualConnection(label, host, port, token);
    sendJson(res, 201, { id });
    return true;
  }

  if (req.method === 'DELETE' && parts.length === 3) {
    if (!checkMutationOrigin(req, res)) return true;

    const connectionId = decodeURIComponent(parts[2]);
    const result = manager.removeConnection(connectionId);
    if (result.error) {
      sendJson(res, 403, { error: result.error });
      return true;
    }

    sendJson(res, 200, { deleted: connectionId });
    return true;
  }

  return false;
}

function checkMutationOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  const host = req.headers.host;
  if (!host) {
    sendJson(res, 403, { error: 'cross_origin_not_allowed' });
    res.removeHeader('Access-Control-Allow-Origin');
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const hostParts = host.split(':');
    const hostHostname = hostParts[0];
    const hostPort = hostParts[1] ?? (originUrl.protocol === 'https:' ? '443' : '80');

    if (originUrl.hostname !== hostHostname || originUrl.port !== hostPort) {
      sendJson(res, 403, { error: 'cross_origin_not_allowed' });
      res.removeHeader('Access-Control-Allow-Origin');
      return false;
    }
  } catch {
    sendJson(res, 403, { error: 'cross_origin_not_allowed' });
    res.removeHeader('Access-Control-Allow-Origin');
    return false;
  }

  return true;
}

const MAX_BODY_SIZE = 64 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}
