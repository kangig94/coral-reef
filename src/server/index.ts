import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeApi, sendJson } from '../api/router.js';
import { runIndexer, SseClient } from '../indexer/index.js';
import { closeDb, getDb } from './db.js';
import { ensureLocalAutoRow } from './schema.js';
import { createWsRelay } from './ws.js';

const PORT = parseInt(process.env.CORAL_REEF_PORT ?? '3100', 10);
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FRONTEND_DIST_DIR = resolve(REPO_ROOT, 'src/web/dist');
const FRONTEND_INDEX_PATH = resolve(FRONTEND_DIST_DIR, 'index.html');

function main(): void {
  const db = getDb();
  ensureLocalAutoRow(db);
  runIndexer(db);

  const sseClient = new SseClient(db);
  sseClient.start();

  const server = createServer((req, res) => {
    void handleRequest(req, res, db).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[coral-reef] Request failed: ${message}\n`);

      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' });
        return;
      }

      if (!res.writableEnded) {
        res.end();
      }
    });
  });
  const wss = createWsRelay(server, sseClient);
  let shuttingDown = false;

  server.listen(PORT, () => {
    process.stderr.write(`[coral-reef] Dashboard running at http://localhost:${PORT}\n`);
  });

  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    process.stderr.write('[coral-reef] Shutting down...\n');
    sseClient.stop();
    wss.close();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: ReturnType<typeof getDb>,
): Promise<void> {
  if (await routeApi(req, res, db)) {
    return;
  }

  if (serveFrontend(req, res)) {
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

function serveFrontend(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname.startsWith('/api/') || pathname === '/ws') {
    return false;
  }

  if (!existsSync(FRONTEND_INDEX_PATH)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend build not found. Run `npm install && npm run build` in src/web/.');
    return true;
  }

  const assetPath = resolve(FRONTEND_DIST_DIR, `.${pathname}`);
  const isAssetRequest = pathname !== '/' && extname(pathname) !== '' && assetPath.startsWith(FRONTEND_DIST_DIR);
  if (isAssetRequest && existsSync(assetPath)) {
    sendFile(res, assetPath);
    return true;
  }

  if (pathname === '/' || extname(pathname) === '') {
    sendFile(res, FRONTEND_INDEX_PATH);
    return true;
  }

  return false;
}

function sendFile(res: ServerResponse, filePath: string): void {
  const contents = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  res.end(contents);
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.ico':
      return 'image/x-icon';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

main();
