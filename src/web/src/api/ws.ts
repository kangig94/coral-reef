type WsListener = (event: string, data: Record<string, unknown>) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private reconnectTimer: number | null = null;

  connect(): void {
    if (this.ws || this.reconnectTimer !== null) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.ws = ws;

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as {
          event?: string;
          data?: Record<string, unknown>;
        };

        if (typeof parsed.event !== 'string' || !parsed.data || typeof parsed.data !== 'object') {
          return;
        }

        for (const listener of this.listeners) {
          listener(parsed.event, parsed.data);
        }
      } catch {
        // Ignore malformed payloads from the relay.
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
      }

      if (this.reconnectTimer !== null) {
        return;
      }

      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000);
    };
  }

  subscribe(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      const connection = this.ws;
      this.ws = null;
      connection.close();
    }
  }
}

export const wsClient = new WsClient();
