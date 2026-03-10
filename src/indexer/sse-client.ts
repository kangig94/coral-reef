import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { BACKEND_INFO_PATH } from 'coral/client';
import { updateLocalAutoConnection } from '../server/schema.js';

type BackendInfo = {
  host: string;
  port: number;
  token: string;
  instanceId: string;
};

type SsePayload = Record<string, unknown>;
type BroadcastListener = (event: string, data: SsePayload) => void;

export type SseClientState = 'disconnected' | 'connecting' | 'connected';

export class SseClient {
  private readonly db: Database.Database;
  private state: SseClientState = 'disconnected';
  private currentStreamId: string | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private wsListeners: BroadcastListener[] = [];

  constructor(db: Database.Database) {
    this.db = db;
  }

  start(): void {
    if (this.state !== 'disconnected') {
      return;
    }

    this.connect();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.state = 'disconnected';
    this.currentStreamId = null;
  }

  getState(): SseClientState {
    return this.state;
  }

  getStreamId(): string | null {
    return this.currentStreamId;
  }

  onBroadcast(listener: BroadcastListener): void {
    this.wsListeners.push(listener);
  }

  offBroadcast(listener: BroadcastListener): void {
    this.wsListeners = this.wsListeners.filter((candidate) => candidate !== listener);
  }

  private connect(): void {
    if (this.state !== 'disconnected') {
      return;
    }

    const info = readBackendInfo();
    if (!info) {
      updateLocalAutoConnection(this.db, { error: 'Backend not available' });
      this.scheduleReconnect(5_000);
      return;
    }

    updateLocalAutoConnection(this.db, { host: info.host, port: info.port, token: info.token });
    this.state = 'connecting';

    const abortController = new AbortController();
    this.abortController = abortController;

    void this.consumeStream(info, abortController.signal)
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        updateLocalAutoConnection(this.db, { error: message });
        process.stderr.write(`[sse] Stream error: ${message}\n`);
      })
      .finally(() => {
        if (this.abortController === abortController) {
          this.abortController = null;
        }

        if (this.state === 'disconnected') {
          this.currentStreamId = null;
          return;
        }

        this.state = 'disconnected';
        this.currentStreamId = null;
        this.scheduleReconnect(3_000);
      });
  }

  private async consumeStream(info: BackendInfo, signal: AbortSignal): Promise<void> {
    const response = await fetch(`http://${info.host}:${info.port}/events/stream`, {
      method: 'GET',
      headers: {
        'X-Coral-Backend-Token': info.token,
      },
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connect failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        if (line === '') {
          if (eventType && dataLines.length > 0) {
            this.handleEvent(eventType, dataLines.join('\n'));
          }

          eventType = '';
          dataLines = [];
          continue;
        }

        if (line.startsWith(':')) {
          continue;
        }

        if (line.startsWith('event:')) {
          eventType = readSseField(line, 'event:');
          continue;
        }

        if (line.startsWith('data:')) {
          dataLines.push(readSseField(line, 'data:'));
        }
      }
    }
  }

  private handleEvent(eventType: string, data: string): void {
    let payload: SsePayload;
    try {
      payload = JSON.parse(data) as SsePayload;
    } catch {
      return;
    }

    switch (eventType) {
      case 'ready':
        this.currentStreamId = readString(payload, 'streamId');
        this.state = 'connected';
        process.stderr.write(`[sse] Connected, streamId=${this.currentStreamId ?? 'unknown'}\n`);
        this.broadcastToWs(eventType, payload);
        return;

      case 'job:created':
        this.upsertJob(payload);
        this.broadcastToWs(eventType, payload);
        return;

      case 'job:phase_changed':
        this.updateJobPhase(payload);
        this.broadcastToWs(eventType, payload);
        return;

      case 'job:progress':
        this.insertProgressEvent(payload);
        this.broadcastToWs(eventType, payload);
        return;

      case 'job:completed':
        this.updateJobCompleted(payload);
        this.broadcastToWs(eventType, payload);
        return;

      case 'session:updated':
        this.broadcastToWs(eventType, payload);
        return;

      default:
        this.broadcastToWs(eventType, payload);
        return;
    }
  }

  private upsertJob(payload: SsePayload): void {
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO jobs (jobId, sessionId, provider, projectRoot, phase, createdAt)
        VALUES (?, ?, ?, ?, 'launching', ?)
      `).run(
        readString(payload, 'jobId'),
        readString(payload, 'sessionId') ?? '',
        readString(payload, 'provider') ?? '',
        readString(payload, 'projectRoot') ?? '',
        new Date().toISOString(),
      );
    } catch {
      // Cold scan remains authoritative, so live inserts stay best-effort.
    }
  }

  private updateJobPhase(payload: SsePayload): void {
    try {
      this.db.prepare('UPDATE jobs SET phase = ? WHERE jobId = ?').run(
        readString(payload, 'phase'),
        readString(payload, 'jobId'),
      );
    } catch {
      // Best-effort optimistic update.
    }
  }

  private insertProgressEvent(payload: SsePayload): void {
    const jobId = readString(payload, 'jobId');
    const eventId = readNumber(payload, 'eventId');

    try {
      this.db.prepare(`
        INSERT INTO events (jobId, eventId, type, ts, message, payload)
        SELECT ?, ?, 'progress', ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM events
          WHERE jobId = ? AND eventId = ?
        )
      `).run(
        jobId,
        eventId,
        new Date().toISOString(),
        readString(payload, 'message') ?? '',
        JSON.stringify(payload),
        jobId,
        eventId,
      );
    } catch {
      // Best-effort optimistic update.
    }
  }

  private updateJobCompleted(payload: SsePayload): void {
    const result = readRecord(payload, 'result');
    const usage = result ? readRecord(result, 'usage') : null;
    const phase = result?.aborted === true ? 'aborted' : 'completed';

    try {
      this.db.prepare(`
        UPDATE jobs
        SET phase = ?, completedAt = ?, result = ?, costUsd = ?, inputTokens = ?, outputTokens = ?, durationMs = ?
        WHERE jobId = ?
      `).run(
        phase,
        new Date().toISOString(),
        result ? JSON.stringify(result) : null,
        usage ? readNumber(usage, 'costUsd') : null,
        usage ? readNumber(usage, 'inputTokens') : null,
        usage ? readNumber(usage, 'outputTokens') : null,
        result ? readNumber(result, 'durationMs') : null,
        readString(payload, 'jobId'),
      );
    } catch {
      // Best-effort optimistic update.
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private broadcastToWs(event: string, data: SsePayload): void {
    for (const listener of this.wsListeners) {
      try {
        listener(event, data);
      } catch {
        // Listener failures should not affect the SSE client.
      }
    }
  }
}

function readBackendInfo(): BackendInfo | null {
  try {
    const raw = JSON.parse(readFileSync(BACKEND_INFO_PATH, 'utf-8')) as Record<string, unknown>;
    if (typeof raw.port !== 'number' || typeof raw.token !== 'string') {
      return null;
    }

    return {
      host: typeof raw.host === 'string' ? raw.host : '127.0.0.1',
      port: raw.port,
      token: raw.token,
      instanceId: typeof raw.instanceId === 'string' ? raw.instanceId : '',
    };
  } catch {
    return null;
  }
}

function readSseField(line: string, prefix: string): string {
  const value = line.slice(prefix.length);
  return value.startsWith(' ') ? value.slice(1) : value;
}

function readString(payload: SsePayload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(payload: SsePayload, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

function readRecord(payload: SsePayload, key: string): SsePayload | null {
  const value = payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as SsePayload;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
}
