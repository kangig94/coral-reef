import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LOCAL_BACKEND_INFO_PATH } from '../coral-paths.js';
import { SseClient, type SseClientState, type ResolvedConnection } from './sse-client.js';
import { remoteSync, syncDiscussSession } from './remote-sync.js';
import { toDiscussReefId } from './source-ids.js';

const DISCUSS_REFRESH_DEBOUNCE_MS = 150;

type ConnectionRow = {
  id: string;
  label: string;
  source: string;
  host: string | null;
  port: number | null;
  token: string | null;
  status: string;
  lastError: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

type ConnectionRuntime = {
  sseClient: SseClient;
  generation: number;
  lastStreamId: string | null;
  syncAbort: AbortController | null;
  discussRefreshes: Map<string, PendingDiscussRefresh>;
};

type BroadcastListener = (event: string, data: Record<string, unknown>, source: string) => void;

type DiscussRefreshPayload = {
  projectRoot: string;
  originDiscussSessionId: string;
  status: string;
};

type PendingDiscussRefresh = {
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  dirty: boolean;
  latest: DiscussRefreshPayload;
  abortController: AbortController | null;
};

export class ConnectionManager {
  private readonly db: Database.Database;
  private readonly runtimes = new Map<string, ConnectionRuntime>();
  private readonly wsListeners: BroadcastListener[] = [];

  constructor(db: Database.Database) {
    this.db = db;
  }

  initialize(): void {
    const rows = this.db.prepare('SELECT * FROM connections').all() as ConnectionRow[];

    for (const row of rows) {
      this.startRuntime(row);
    }
  }

  getPrimaryStreamId(): string | null {
    const runtime = this.runtimes.get('local:auto');
    return runtime?.sseClient.getStreamId() ?? null;
  }

  getPrimaryState(): SseClientState {
    const runtime = this.runtimes.get('local:auto');
    return runtime?.sseClient.getState() ?? 'disconnected';
  }

  onBroadcast(listener: BroadcastListener): void {
    this.wsListeners.push(listener);
  }

  offBroadcast(listener: BroadcastListener): void {
    const index = this.wsListeners.indexOf(listener);
    if (index !== -1) {
      this.wsListeners.splice(index, 1);
    }
  }

  listConnections(): Array<Omit<ConnectionRow, 'token'> & { sseState: SseClientState }> {
    const rows = this.db.prepare('SELECT * FROM connections ORDER BY createdAt ASC').all() as ConnectionRow[];
    return rows.map(({ token: _token, ...rest }) => ({
      ...rest,
      sseState: this.runtimes.get(rest.id)?.sseClient.getState() ?? 'disconnected',
    }));
  }

  addManualConnection(label: string, host: string, port: number, token: string): string {
    const id = `manual:${randomId()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO connections (id, label, source, host, port, token, status, createdAt)
      VALUES (?, ?, 'manual', ?, ?, ?, 'disconnected', ?)
    `).run(id, label, host, port, token, now);

    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow;
    this.startRuntime(row);

    return id;
  }

  removeConnection(id: string): { error?: string } {
    if (id === 'local:auto') {
      return { error: 'Cannot remove local:auto connection' };
    }

    const runtime = this.runtimes.get(id);
    if (runtime) {
      this.stopRuntime(runtime);
      this.runtimes.delete(id);
    }

    this.purgeConnectionData(id);
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);

    return {};
  }

  shutdown(): void {
    for (const [id, runtime] of this.runtimes) {
      this.stopRuntime(runtime);
      this.runtimes.delete(id);
    }
  }

  private startRuntime(row: ConnectionRow): void {
    const connectionId = row.id;
    const resolveConnection = row.source === 'auto'
      ? () => this.resolveLocalAuto()
      : () => this.resolveManual(connectionId);

    const runtime: ConnectionRuntime = {
      sseClient: null!,
      generation: 0,
      lastStreamId: null,
      syncAbort: null,
      discussRefreshes: new Map(),
    };

    const sseClient = new SseClient(this.db, {
      connectionId,
      label: row.label,
      resolveConnection,
      onStatusChange: (status, lastError) => {
        this.updateConnectionStatus(connectionId, status, lastError);
      },
      onReady: (streamId) => {
        this.handleReady(connectionId, streamId);
      },
    });

    sseClient.onBroadcast((event, data, source) => {
      if (event === 'discuss:updated') {
        this.handleDiscussUpdated(connectionId, data);
        return;
      }

      this.broadcast(event, data, source);
    });

    runtime.sseClient = sseClient;
    this.runtimes.set(connectionId, runtime);
    sseClient.start();
  }

  private async resolveLocalAuto(): Promise<ResolvedConnection> {
    try {
      const raw = JSON.parse(readFileSync(LOCAL_BACKEND_INFO_PATH, 'utf-8')) as Record<string, unknown>;
      if (typeof raw.port !== 'number' || typeof raw.token !== 'string') {
        throw new Error('Invalid backend.json');
      }

      const resolved: ResolvedConnection = {
        host: typeof raw.host === 'string' ? raw.host : '127.0.0.1',
        port: raw.port,
        token: raw.token,
      };

      this.db.prepare(`
        UPDATE connections SET host = ?, port = ?, token = ?, status = 'connected', lastError = NULL, lastSeenAt = ?
        WHERE id = 'local:auto'
      `).run(resolved.host, resolved.port, resolved.token, new Date().toISOString());

      return resolved;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.prepare(`
        UPDATE connections SET status = 'error', lastError = ?, lastSeenAt = ?
        WHERE id = 'local:auto'
      `).run(message, new Date().toISOString());

      throw new Error(`Backend not available: ${message}`);
    }
  }

  private async resolveManual(connectionId: string): Promise<ResolvedConnection> {
    const resolved = this.readConnectionCredentials(connectionId);
    if (!resolved) {
      throw new Error('Missing connection credentials');
    }

    return resolved;
  }

  private updateConnectionStatus(connectionId: string, status: SseClientState, lastError?: string): void {
    try {
      if (lastError) {
        this.db.prepare(`
          UPDATE connections SET status = ?, lastError = ?, lastSeenAt = ?
          WHERE id = ?
        `).run(status === 'disconnected' ? 'error' : status, lastError, new Date().toISOString(), connectionId);
      } else {
        this.db.prepare(`
          UPDATE connections SET status = ?, lastSeenAt = ?
          WHERE id = ?
        `).run(status, new Date().toISOString(), connectionId);
      }
    } catch {
      // Best-effort status update.
    }
  }

  private handleReady(connectionId: string, streamId: string): void {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime) return;

    const previousStreamId = runtime.lastStreamId;
    runtime.lastStreamId = streamId;

    // Resync on first connect (previousStreamId === null) or streamId change
    if (previousStreamId === null || previousStreamId !== streamId) {
      this.triggerResync(connectionId, runtime);
    }
  }

  private triggerResync(connectionId: string, runtime: ConnectionRuntime): void {
    runtime.syncAbort?.abort();
    const generation = runtime.generation;
    const abortController = new AbortController();
    runtime.syncAbort = abortController;

    const resolved = this.readConnectionCredentials(connectionId);
    if (!resolved) return;

    void remoteSync(this.db, {
      connectionId,
      host: resolved.host,
      port: resolved.port,
      token: resolved.token,
      signal: abortController.signal,
    })
      .then(() => {
        if (runtime.generation === generation) {
          process.stderr.write(`[manager:${connectionId}] Resync complete\n`);
        }
      })
      .catch((error: unknown) => {
        if (runtime.generation !== generation) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[manager:${connectionId}] Resync failed: ${message}\n`);
      })
      .finally(() => {
        if (runtime.syncAbort === abortController) {
          runtime.syncAbort = null;
        }
      });
  }

  private handleDiscussUpdated(connectionId: string, data: Record<string, unknown>): void {
    const projectRoot = readString(data, 'projectRoot');
    const originDiscussSessionId = readString(data, 'sessionId');

    if (!projectRoot || !originDiscussSessionId) {
      return;
    }

    this.scheduleDiscussRefresh(connectionId, {
      projectRoot,
      originDiscussSessionId,
      status: readString(data, 'status') ?? 'unknown',
    });
  }

  private scheduleDiscussRefresh(connectionId: string, payload: DiscussRefreshPayload): void {
    const runtime = this.runtimes.get(connectionId);
    if (!runtime) {
      return;
    }

    const reefSessionId = toDiscussReefId({
      connectionId,
      projectRoot: payload.projectRoot,
      originDiscussSessionId: payload.originDiscussSessionId,
    });

    let refresh = runtime.discussRefreshes.get(reefSessionId);
    if (!refresh) {
      refresh = {
        timer: null,
        inFlight: false,
        dirty: false,
        latest: payload,
        abortController: null,
      };
      runtime.discussRefreshes.set(reefSessionId, refresh);
    }

    refresh.latest = payload;

    if (refresh.timer) {
      clearTimeout(refresh.timer);
      refresh.timer = null;
    }

    if (refresh.inFlight) {
      refresh.dirty = true;
      return;
    }

    this.armDiscussRefresh(connectionId, runtime, reefSessionId, refresh);
  }

  private armDiscussRefresh(
    connectionId: string,
    runtime: ConnectionRuntime,
    reefSessionId: string,
    refresh: PendingDiscussRefresh,
  ): void {
    refresh.timer = setTimeout(() => {
      refresh.timer = null;
      void this.runDiscussRefresh(connectionId, runtime, reefSessionId, refresh);
    }, DISCUSS_REFRESH_DEBOUNCE_MS);
  }

  private async runDiscussRefresh(
    connectionId: string,
    runtime: ConnectionRuntime,
    reefSessionId: string,
    refresh: PendingDiscussRefresh,
  ): Promise<void> {
    const resolved = this.readConnectionCredentials(connectionId);
    if (!resolved) {
      runtime.discussRefreshes.delete(reefSessionId);
      return;
    }

    const generation = runtime.generation;
    const payload = refresh.latest;
    const abortController = new AbortController();
    refresh.inFlight = true;
    refresh.dirty = false;
    refresh.abortController = abortController;

    try {
      const result = await syncDiscussSession(this.db, {
        connectionId,
        host: resolved.host,
        port: resolved.port,
        token: resolved.token,
        signal: abortController.signal,
      }, payload);

      if (!result) {
        return;
      }

      if (runtime.generation !== generation || this.runtimes.get(connectionId) !== runtime) {
        return;
      }

      this.broadcast('discuss:synced', {
        sessionId: result.sessionId,
        originDiscussSessionId: result.originDiscussSessionId,
        lastSeq: result.lastSeq,
        projectRoot: payload.projectRoot,
        status: result.status,
      }, connectionId);
    } catch (error: unknown) {
      if (runtime.generation !== generation) {
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[manager:${connectionId}] Discuss refresh failed for ${payload.originDiscussSessionId}: ${message}\n`);
    } finally {
      if (refresh.abortController === abortController) {
        refresh.abortController = null;
      }
      refresh.inFlight = false;

      if (runtime.generation !== generation || this.runtimes.get(connectionId) !== runtime) {
        runtime.discussRefreshes.delete(reefSessionId);
        return;
      }

      if (refresh.dirty) {
        this.armDiscussRefresh(connectionId, runtime, reefSessionId, refresh);
        return;
      }

      if (!refresh.timer) {
        runtime.discussRefreshes.delete(reefSessionId);
      }
    }
  }

  private readConnectionCredentials(connectionId: string): ResolvedConnection | null {
    const row = this.db.prepare('SELECT host, port, token FROM connections WHERE id = ?').get(connectionId) as {
      host: string | null;
      port: number | null;
      token: string | null;
    } | undefined;

    if (!row?.host || !row.port || !row.token) {
      return null;
    }

    return { host: row.host, port: row.port, token: row.token };
  }

  private broadcast(event: string, data: Record<string, unknown>, source: string): void {
    for (const listener of this.wsListeners) {
      try {
        listener(event, data, source);
      } catch {
        // Broadcast failures should not affect the manager.
      }
    }
  }

  private stopRuntime(runtime: ConnectionRuntime): void {
    runtime.generation += 1;
    runtime.syncAbort?.abort();
    runtime.syncAbort = null;

    for (const refresh of runtime.discussRefreshes.values()) {
      if (refresh.timer) {
        clearTimeout(refresh.timer);
        refresh.timer = null;
      }
      refresh.abortController?.abort();
      refresh.abortController = null;
    }
    runtime.discussRefreshes.clear();

    runtime.sseClient.stop();
  }

  private purgeConnectionData(connectionId: string): void {
    const transaction = this.db.transaction((): void => {
      const jobIds = this.db.prepare('SELECT jobId FROM jobs WHERE connectionId = ?').all(connectionId) as Array<{ jobId: string }>;
      for (const { jobId } of jobIds) {
        this.db.prepare('DELETE FROM events WHERE jobId = ?').run(jobId);
      }
      this.db.prepare('DELETE FROM jobs WHERE connectionId = ?').run(connectionId);
      this.db.prepare('DELETE FROM sessions WHERE connectionId = ?').run(connectionId);

      const discussIds = this.db.prepare('SELECT sessionId FROM discuss_sessions WHERE connectionId = ?').all(connectionId) as Array<{ sessionId: string }>;
      for (const { sessionId } of discussIds) {
        this.db.prepare('DELETE FROM transcript_entries WHERE discussSessionId = ?').run(sessionId);
      }
      this.db.prepare('DELETE FROM discuss_sessions WHERE connectionId = ?').run(connectionId);
    });

    try {
      transaction();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[manager] Purge failed for ${connectionId}: ${message}\n`);
    }
  }
}

function randomId(): string {
  return randomBytes(9).toString('base64url');
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : null;
}
