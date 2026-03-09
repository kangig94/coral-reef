import Database from 'better-sqlite3';

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
}
