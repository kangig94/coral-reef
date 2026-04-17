import type Database from 'better-sqlite3';
import { toReefId } from './source-ids.js';

type SsePayload = Record<string, unknown>;
type BroadcastListener = (event: string, data: SsePayload, source: string) => void;

export type SseClientState = 'disconnected' | 'connecting' | 'connected';

export type ResolvedConnection = {
  host: string;
  port: number;
  token: string;
};

export type SseClientConfig = {
  connectionId: string;
  label: string;
  resolveConnection: () => Promise<ResolvedConnection>;
  onStatusChange: (status: SseClientState, lastError?: string) => void;
  onReady: (streamId: string) => void;
};

export class SseClient {
  private readonly db: Database.Database;
  private readonly config: SseClientConfig;
  private state: SseClientState = 'disconnected';
  private currentStreamId: string | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private wsListeners: BroadcastListener[] = [];

  constructor(db: Database.Database, config: SseClientConfig) {
    this.db = db;
    this.config = config;
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

    this.state = 'connecting';
    this.config.onStatusChange('connecting');

    void this.resolveAndConsume()
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.config.onStatusChange('disconnected', message);
        process.stderr.write(`[sse:${this.config.connectionId}] Stream error: ${message}\n`);
      })
      .finally(() => {
        if (this.state === 'disconnected') {
          this.currentStreamId = null;
          return;
        }

        this.state = 'disconnected';
        this.currentStreamId = null;
        this.config.onStatusChange('disconnected');
        this.scheduleReconnect(3_000);
      });
  }

  private async resolveAndConsume(): Promise<void> {
    let resolved: ResolvedConnection;
    try {
      resolved = await this.config.resolveConnection();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.config.onStatusChange('disconnected', message);
      this.state = 'disconnected';
      this.scheduleReconnect(5_000);
      return;
    }

    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      await this.consumeStream(resolved, abortController.signal);
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  private async consumeStream(info: ResolvedConnection, signal: AbortSignal): Promise<void> {
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
      case 'ready': {
        const newStreamId = readString(payload, 'streamId');
        this.currentStreamId = newStreamId;
        this.state = 'connected';
        this.config.onStatusChange('connected');
        process.stderr.write(`[sse:${this.config.connectionId}] Connected, streamId=${newStreamId ?? 'unknown'}\n`);
        if (newStreamId) {
          this.config.onReady(newStreamId);
        }
        this.broadcastToWs(eventType, payload);
        return;
      }

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

      case 'discuss:updated':
        this.broadcastToWs(eventType, payload);
        return;

      default:
        this.broadcastToWs(eventType, payload);
        return;
    }
  }

  private upsertJob(payload: SsePayload): void {
    const originJobId = readString(payload, 'jobId') ?? '';
    const reefJobId = toReefId(this.config.connectionId, originJobId);

    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO jobs (jobId, sessionId, provider, projectRoot, phase, createdAt, connectionId, originJobId)
        VALUES (?, ?, ?, ?, 'launching', ?, ?, ?)
      `).run(
        reefJobId,
        readString(payload, 'sessionId') ?? '',
        readString(payload, 'provider') ?? '',
        readString(payload, 'projectRoot') ?? '',
        new Date().toISOString(),
        this.config.connectionId,
        originJobId,
      );
    } catch {
      // Cold scan remains authoritative, so live inserts stay best-effort.
    }
  }

  private updateJobPhase(payload: SsePayload): void {
    const reefJobId = toReefId(this.config.connectionId, readString(payload, 'jobId') ?? '');

    try {
      this.db.prepare('UPDATE jobs SET phase = ? WHERE jobId = ?').run(
        readString(payload, 'phase'),
        reefJobId,
      );
    } catch {
      // Best-effort optimistic update.
    }
  }

  private insertProgressEvent(payload: SsePayload): void {
    const reefJobId = toReefId(this.config.connectionId, readString(payload, 'jobId') ?? '');
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
        reefJobId,
        eventId,
        new Date().toISOString(),
        readString(payload, 'message') ?? '',
        JSON.stringify(payload),
        reefJobId,
        eventId,
      );
    } catch {
      // Best-effort optimistic update.
    }
  }

  private updateJobCompleted(payload: SsePayload): void {
    const reefJobId = toReefId(this.config.connectionId, readString(payload, 'jobId') ?? '');
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
        reefJobId,
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
        listener(event, data, this.config.connectionId);
      } catch {
        // Listener failures should not affect the SSE client.
      }
    }
  }
}

function readSseField(line: string, prefix: string): string {
  const value = line.slice(prefix.length);
  return value.startsWith(' ') ? value.slice(1) : value;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

function readRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
}
