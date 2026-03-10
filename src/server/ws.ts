import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ConnectionManager } from '../indexer/connection-manager.js';

export function createWsRelay(httpServer: Server, manager: ConnectionManager): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (event: string, data: Record<string, unknown>, source: string): void => {
    const message = JSON.stringify({ event, data, source });

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        client.send(message);
      } catch {
        // Broadcast is fire-and-forget.
      }
    }
  };

  manager.onBroadcast(broadcast);

  wss.on('connection', (ws) => {
    try {
      ws.send(JSON.stringify({
        event: 'connected',
        data: {
          streamId: manager.getPrimaryStreamId(),
          sseState: manager.getPrimaryState(),
          connections: manager.listConnections(),
        },
      }));
    } catch {
      // Connection might already be closing.
    }
  });

  wss.on('close', () => {
    manager.offBroadcast(broadcast);
  });

  return wss;
}
