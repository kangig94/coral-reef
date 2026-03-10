import type Database from 'better-sqlite3';
import { coldScan, type ColdScanResult } from './cold-scan.js';
export { ConnectionManager } from './connection-manager.js';
export { SseClient } from './sse-client.js';

type IndexerStatus = {
  lastRunAt: string | null;
  lastResult: ColdScanResult | null;
};

const indexerStatus: IndexerStatus = {
  lastRunAt: null,
  lastResult: null,
};

export function runIndexer(db: Database.Database): void {
  const result = coldScan(db);
  indexerStatus.lastRunAt = new Date().toISOString();
  indexerStatus.lastResult = result;

  process.stderr.write(
    `[indexer] Cold scan complete: ${result.jobs} jobs, ${result.sessions} sessions, ${result.discussSessions} discuss sessions\n`,
  );
}

export function getIndexerStatus(): IndexerStatus {
  return {
    lastRunAt: indexerStatus.lastRunAt,
    lastResult: indexerStatus.lastResult,
  };
}
