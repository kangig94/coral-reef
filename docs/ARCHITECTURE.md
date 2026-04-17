# Architecture: coral-reef

coral-reef is a full-stack TypeScript dashboard for the Coral CLI plugin. It indexes Coral's filesystem artifacts into SQLite, serves a REST API, and relays live events to a React SPA over WebSocket.

## Layer Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  L3: Frontend (React SPA)                                    │
│  src/web/src — App, components, api, types                   │
│  React 19 + React Router 7 + Recharts + Vite 6              │
│  Communicates via HTTP (REST) and WebSocket only             │
├──────────────────────────────────────────────────────────────┤
│  L2: REST API Layer                                          │
│  src/api — router, jobs, sessions, discuss,                  │
│             workflows, metrics, chat, health                 │
│  Raw node:http routing, CORS, sendJson helper                │
├──────────────────────────────────────────────────────────────┤
│  L1: Server Core + Realtime                                  │
│  src/server — index, db, schema, ws                          │
│  HTTP server entry, SQLite singleton, WebSocket relay        │
├──────────────────────────────────────────────────────────────┤
│  L0: Indexer (Data Ingestion)                                │
│  src/indexer — index, cold-scan, sse-client                  │
│  Cold startup scan + live SSE stream from coral backend      │
│  Depends on coral/client for filesystem path constants       │
└──────────────────────────────────────────────────────────────┘
         ↕ coral backend SSE (/events/stream)
         ↕ coral filesystem (~/.claude/*)
```

**Dependency rule**: Code in Lx may only depend on L0..L(x-1). L3 communicates with the backend exclusively through HTTP/WS — no direct imports from backend modules.

**Known exception**: `src/api/health.ts` imports `getIndexerStatus` from L0 (`src/indexer/index.ts`). This L2→L0 cross-layer import is permitted for health aggregation only. Do not create additional L2→L0 imports without explicit justification.

## Realtime Data Flow

```
coral backend
    │
    │  SSE /events/stream (job:created, job:phase_changed, job:progress, job:completed, discuss:updated)
    ▼
SseClient (src/indexer/sse-client.ts)
    │  ├── SQLite mutations (best-effort INSERT/UPDATE)
    │  └── broadcastToWs → WsClient listeners
    ▼
WebSocket relay (src/server/ws.ts, /ws)
    │
    ▼
React components (Kanban, JobDetail, etc.)
    │  ├── wsClient.subscribe(handler) → trigger fetchApi refresh
    └── fetchApi('/api/jobs') → REST endpoint → SQLite SELECT
```

The cold scan at startup is authoritative. Live SSE updates are best-effort — missed events are recovered at next restart.

## Request Lifecycle (REST API)

```
node:http createServer
    │
    ▼
handleRequest (src/server/index.ts:63)
    │
    ├── routeApi (src/api/router.ts) — prefix match on req.url
    │       │  /api/jobs        → handleJobs
    │       │  /api/sessions    → handleSessions
    │       │  /api/discuss     → handleDiscuss
    │       │  /api/workflows   → handleWorkflows
    │       │  /api/metrics     → handleMetrics
    │       │  /api/chat        → handleChat
    │       │  /api/system/health → handleHealth
    │       └── (no match)     → return false
    │
    ├── serveFrontend — static file serving from src/web/dist/
    │
    └── sendJson(res, 404, { error: 'not_found' })
```

## Database Access Patterns

- **Singleton**: one SQLite instance per process, initialized in `src/server/db.ts`, stored at `~/.claude/coral-reef/db.sqlite`
- **WAL mode**: `journal_mode = WAL` + `foreign_keys = ON` set on init
- **Direct queries**: `db.prepare(sql).get/all/run()` — no ORM or query builder
- **Transactions**: bulk inserts (sessions, discuss transcripts) wrapped in `db.transaction()`
- **Cold scan**: `INSERT OR REPLACE` — idempotent, runs at startup
- **Live updates**: best-effort `INSERT OR IGNORE` / `UPDATE` — failures silently swallowed

## Component Hierarchy (Frontend)

```
BrowserRouter (main.tsx)
└── App
    └── Layout (sidebar nav + Outlet)
        ├── /              → Kanban (job phase board, WS + polling)
        ├── /jobs/:jobId   → JobDetail
        ├── /chat          → ChatUI (stub endpoint)
        ├── /chat/:sessionId → ChatUI
        ├── /sessions      → Sessions
        ├── /discuss       → DiscussViewer
        ├── /discuss/:sessionId → DiscussViewer
        ├── /workflows     → Workflows
        ├── /metrics       → Metrics (lazy-loaded via React.lazy + Suspense)
        └── /*             → Navigate to /
```

Metrics is a code-splitting boundary — it loads Recharts only when the route is visited.

## API Integration Layer (Frontend)

- **HTTP**: `src/web/src/api/client.ts` — `fetchApi<T>(path)` and `postApi<T>(path, body)` thin wrappers around `fetch`. No caching (`cache: 'no-store'`).
- **WebSocket**: `src/web/src/api/ws.ts` — `WsClient` singleton. Auto-reconnects every 3 seconds. Components call `wsClient.connect()` (idempotent) + `wsClient.subscribe(handler)` in `useEffect`, with the returned unsubscribe function called in cleanup.
- **State**: local per-component `useState`. No global store — `src/web/src/store/index.ts` is intentionally empty.

## Key Files

| File | Role |
|------|------|
| `src/server/index.ts` | Entry point — wires all subsystems, serves frontend static assets |
| `src/server/schema.ts` | 6 SQLite tables + FTS5 search_index (schema-only, search unimplemented) |
| `src/indexer/sse-client.ts` | SSE stream consumer with reconnect, DB mutations, WS broadcast |
| `src/indexer/cold-scan.ts` | Startup filesystem scan — reads coral job/session/discuss artifacts |
| `src/api/router.ts` | URL prefix routing, CORS headers, `sendJson` utility |
| `src/api/chat.ts` | **Stub** — POST /api/chat returns placeholder; not yet wired to Coral execution |
| `src/web/src/App.tsx` | Route definitions — all 10 routes including lazy Metrics |
| `src/web/src/api/ws.ts` | WsClient singleton — subscribe/unsubscribe API |
| `src/web/src/components/Kanban.tsx` | Reference pattern: active flag, wsClient lifecycle, 15s polling |

## Source Tree Modification Policy

| Directory | Modification Rule |
|-----------|-------------------|
| `src/indexer/` | May only import from `coral/client`. Adding new data sources: add to `cold-scan.ts` scanners and `sse-client.ts` event handlers. |
| `src/server/` | Schema changes go in `schema.ts` only. DB singleton in `db.ts` only. New persistent resources must register cleanup in `index.ts:44-57`. |
| `src/api/` | New endpoints: add handler file + register prefix in `router.ts`. Handlers must return `boolean`. All SQL must use parameterized queries. |
| `src/web/` | Separate npm package. Never import from backend. All data via HTTP/WS. Follow React patterns from `Kanban.tsx`. |
| `docs/` | Architecture decisions only — not source contents. Update when structure changes, not when function signatures change. |
| `.claude/rules/` | Stable principles only. Facts about current architecture belong in `docs/`. |
