import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { SseClient } from '../indexer/sse-client.js';

export function createWsRelay(httpServer: Server, sseClient: SseClient): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (event: string, data: Record<string, unknown>): void => {
    const message = JSON.stringify({ event, data });

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

  sseClient.onBroadcast(broadcast);

  wss.on('connection', (ws) => {
    try {
      ws.send(JSON.stringify({
        event: 'connected',
        data: {
          streamId: sseClient.getStreamId(),
          sseState: sseClient.getState(),
        },
      }));
    } catch {
      // Connection might already be closing.
    }
  });

  wss.on('close', () => {
    sseClient.offBroadcast(broadcast);
  });

  return wss;
}
