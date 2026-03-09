import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { initSchema } from './schema.js';

const DATA_DIR = join(homedir(), '.claude', 'coral-reef');
const DB_PATH = join(DATA_DIR, 'db.sqlite');

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!instance) {
    mkdirSync(DATA_DIR, { recursive: true });
    instance = new Database(DB_PATH);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    initSchema(instance);
  }

  return instance;
}

export function closeDb(): void {
  if (!instance) {
    return;
  }

  instance.pragma('wal_checkpoint(TRUNCATE)');
  instance.close();
  instance = null;
}
