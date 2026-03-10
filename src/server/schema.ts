import Database from 'better-sqlite3';

// Schema version history:
//   0 — original schema (no connections, no source-aware columns)
//   1 — connections table + connectionId/originId columns on jobs/sessions/discuss_sessions
const CURRENT_VERSION = 1;

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      jobId TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      provider TEXT NOT NULL,
      projectRoot TEXT NOT NULL,
      phase TEXT NOT NULL,
      launchState TEXT,
      createdAt TEXT,
      completedAt TEXT,
      result TEXT,
      jobKind TEXT,
      costUsd REAL,
      inputTokens INTEGER,
      outputTokens INTEGER,
      durationMs INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobId TEXT NOT NULL,
      eventId INTEGER NOT NULL,
      type TEXT NOT NULL,
      ts TEXT,
      message TEXT,
      payload TEXT,
      FOREIGN KEY (jobId) REFERENCES jobs(jobId)
    );
    CREATE INDEX IF NOT EXISTS idx_events_job ON events(jobId, eventId);

    CREATE TABLE IF NOT EXISTS sessions (
      sessionId TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      model TEXT NOT NULL,
      cwd TEXT NOT NULL,
      projectRoot TEXT,
      shardHash TEXT NOT NULL,
      provenanceState TEXT NOT NULL DEFAULT 'resolved',
      createdAt TEXT,
      lastUsedAt TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      activeJobId TEXT,
      lastJobId TEXT
    );

    CREATE TABLE IF NOT EXISTS discuss_sessions (
      sessionId TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      projectRoot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      sessionDir TEXT NOT NULL,
      createdAt TEXT,
      lastActivityAt TEXT,
      stateJson TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discussSessionId TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      agent TEXT,
      content TEXT,
      epoch INTEGER,
      round INTEGER,
      ts TEXT,
      payload TEXT,
      FOREIGN KEY (discussSessionId) REFERENCES discuss_sessions(sessionId)
    );
    CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_entries(discussSessionId, seq);

    CREATE TABLE IF NOT EXISTS daily_metrics (
      date TEXT NOT NULL,
      projectRoot TEXT NOT NULL,
      inputTokens INTEGER NOT NULL DEFAULT 0,
      outputTokens INTEGER NOT NULL DEFAULT 0,
      costUsd REAL NOT NULL DEFAULT 0,
      jobCount INTEGER NOT NULL DEFAULT 0,
      successCount INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, projectRoot)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      jobId,
      content,
      content_type
    );
  `);

  migrateSchema(db);
}

export function ensureLocalAutoRow(db: Database.Database): void {
  db.prepare(`
    INSERT OR IGNORE INTO connections (id, label, source, status, createdAt)
    VALUES ('local:auto', 'Local backend', 'auto', 'disconnected', ?)
  `).run(new Date().toISOString());
}

export function updateLocalAutoConnection(
  db: Database.Database,
  update: { host: string; port: number; token: string } | { error: string },
): void {
  if ('error' in update) {
    db.prepare(`
      UPDATE connections SET status = 'error', lastError = ?, lastSeenAt = ?
      WHERE id = 'local:auto'
    `).run(update.error, new Date().toISOString());
    return;
  }

  db.prepare(`
    UPDATE connections SET host = ?, port = ?, token = ?, status = 'connected', lastError = NULL, lastSeenAt = ?
    WHERE id = 'local:auto'
  `).run(update.host, update.port, update.token, new Date().toISOString());
}

function migrateSchema(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= CURRENT_VERSION) return;

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
        host TEXT,
        port INTEGER,
        token TEXT,
        status TEXT NOT NULL DEFAULT 'disconnected',
        lastError TEXT,
        createdAt TEXT NOT NULL,
        lastSeenAt TEXT
      )
    `);
    db.exec(`ALTER TABLE jobs ADD COLUMN connectionId TEXT NOT NULL DEFAULT 'local:auto'`);
    db.exec(`ALTER TABLE jobs ADD COLUMN originJobId TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN connectionId TEXT NOT NULL DEFAULT 'local:auto'`);
    db.exec(`ALTER TABLE sessions ADD COLUMN originSessionId TEXT`);
    db.exec(`ALTER TABLE discuss_sessions ADD COLUMN connectionId TEXT NOT NULL DEFAULT 'local:auto'`);
    db.exec(`ALTER TABLE discuss_sessions ADD COLUMN originDiscussSessionId TEXT`);
    db.pragma('user_version = 1');
  }
}
