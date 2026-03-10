# Database Schema: coral-reef

Architecture-level reference for the coral-reef SQLite database. For exact column definitions, read `src/server/schema.ts`.

## Storage

- **Location**: `~/.claude/coral-reef/db.sqlite`
- **Mode**: WAL (Write-Ahead Logging) with `foreign_keys = ON`
- **Created by**: `src/server/db.ts` on first start

## WAL Mode Rationale

WAL mode is chosen over default journal mode because:
- The indexer (cold scan + live SSE updates) writes concurrently with the REST API reading
- WAL allows readers and writers to operate without blocking each other
- `wal_checkpoint(TRUNCATE)` is called on clean shutdown to consolidate WAL files

## Data Model Overview

```
jobs ──┐
       │ FK (jobId)
       └──→ events
       └──→ search_index (FTS5, unimplemented)

sessions ──┐
           │ (projectRoot link — no FK)
           └──→ discuss_sessions ──┐
                                   │ FK (sessionId)
                                   └──→ transcript_entries

daily_metrics (standalone — no FK, unimplemented write path)
```

## Table Design

### `jobs` + `events`

Jobs represent single Coral execution runs. Events are the timestamped progress log for each job.

**Design decisions**:
- `INSERT OR REPLACE` in cold scan makes ingest idempotent — safe to re-run on restart
- `INSERT OR IGNORE` in live SSE updates prevents duplicates from cold scan + live overlap
- `phase` field normalizes both legacy (`status` string) and current (`phase` string) job records — see `normalizePhase` in `src/indexer/cold-scan.ts:438-457`
- `jobKind` distinguishes `workflow` jobs from `provider` jobs — enables the `/api/workflows` filtered view

### `sessions`

Sessions represent Coral agent sessions. Populated from `~/.claude/sessions/` shards.

**Design decisions**:
- `shardHash` records which filesystem shard directory the session came from (for debugging)
- `provenanceState` distinguishes `resolved` (modern session format with `provenanceState: 'authoritative'`) from `legacy_unresolved` (older format) — relevant for UI display
- `version` field tracks optimistic concurrency for future mutation support

### `discuss_sessions` + `transcript_entries`

Discuss sessions are multi-agent discussion runs. Populated by scanning `projectRoot`-keyed discuss directories.

**Design decisions**:
- Discovery path: `sessions.projectRoot` → `readDiscussDiscovery(projectRoot)` → discuss session dirs
- `stateJson` stores the full discuss state JSON for UI rendering (DiscussViewer component)
- `transcript_entries` normalizes 4 entry types (speech, epoch_summary, session_event, bids) into a unified table with optional fields for agent/content/epoch/round
- `DELETE ... INSERT` pattern on each cold scan (not upsert) — discuss state is always rebuilt fresh from the source files

### `daily_metrics`

**Status**: Table is schema-defined but has no write path. The cold scan does not aggregate metrics. Reserved for future implementation.

### `search_index` (FTS5)

**Status**: FTS5 virtual table is defined but not populated or queried. Reserved for future full-text search over job progress messages.

## Indexing Strategy

| Index | Table | Columns | Query Pattern |
|-------|-------|---------|---------------|
| Primary key | `jobs` | `jobId` | Point lookups by job ID |
| `idx_events_job` | `events` | `(jobId, eventId)` | Range scan for all events of a job, ordered by event sequence |
| Primary key | `sessions` | `sessionId` | Point lookups by session ID |
| Primary key | `discuss_sessions` | `sessionId` | Point lookups by discuss session ID |
| `idx_transcript_session` | `transcript_entries` | `(discussSessionId, seq)` | Range scan for all transcript entries of a discuss session, in order |
| Primary key | `daily_metrics` | `(date, projectRoot)` | Range scan by date range and project |

## Cold Scan vs Live Update Strategy

| Update Type | Mechanism | Consistency |
|-------------|-----------|-------------|
| Startup cold scan | `INSERT OR REPLACE` — reads filesystem → overwrites DB | **Authoritative** |
| Live SSE update | Best-effort `INSERT OR IGNORE` / `UPDATE` — wraps in try/catch | **Best-effort** |
| Discuss sessions | `DELETE` + `INSERT` per session on cold scan | **Authoritative** |

Missed live events are recovered at next restart. Do not rely on live updates being complete — always query the DB for current state.
