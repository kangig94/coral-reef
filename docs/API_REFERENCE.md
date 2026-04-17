# API Reference: coral-reef

Architecture-level reference for the coral-reef HTTP API. For endpoint request/response field details, read the handler source in `src/api/`.

## Design Conventions

### Raw HTTP Routing

coral-reef uses no HTTP framework. All routing is URL prefix matching in `src/api/router.ts`. Each handler receives `(req, res, db)` and returns `boolean` — `true` if it handled the request, `false` to fall through to the next handler.

Routing order in `router.ts`:
1. CORS headers set on all requests (wildcard `*` — local tool)
2. OPTIONS preflight → 204 immediately
3. Prefix match routes in registration order
4. No match → falls through to frontend static serving → 404

### Error Response Format

All error responses use the uniform shape:

```json
{ "error": "<error_code_string>" }
```

No stack traces, no internal paths, no verbose messages. Error codes are snake_case strings (e.g., `job_not_found`, `invalid_date_range`, `method_not_allowed`).

HTTP status codes follow REST conventions: 200 success, 400 validation error, 404 not found, 405 method not allowed, 500 internal error.

### Read-Only API

All endpoints except `/api/chat` are GET-only. coral-reef is a read + monitor dashboard — mutations happen through the Coral backend directly.

### Auth Strategy

No authentication is implemented. coral-reef is designed for local use alongside the Coral CLI plugin. The WebSocket relay inherits this model — no token required for the `/ws` endpoint.

If deployed in a shared environment, add auth middleware at the `routeApi` level in `src/api/router.ts`.

## Endpoint Groups

### Resource Endpoints (read from SQLite)

| Endpoint | Description |
|----------|-------------|
| `GET /api/jobs` | All jobs, ordered by creation time descending |
| `GET /api/jobs/:jobId` | Single job with its progress events |
| `GET /api/sessions` | All sessions, ordered by last used time |
| `GET /api/sessions/:sessionId` | Single session |
| `GET /api/discuss` | All discuss sessions, ordered by activity |
| `GET /api/discuss/:sessionId` | Single discuss session with transcript |
| `GET /api/workflows` | Jobs where `jobKind = 'workflow'` |
| `GET /api/metrics` | Daily metrics with optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` filter |

### System Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/system/health` | DB stats, indexer status, coral backend health check |

### Stub Endpoints

| Endpoint | Status | Description |
|----------|--------|-------------|
| `POST /api/chat` | **Stub** | Returns placeholder response. Not wired to Coral execution. Response includes `"stub": true`. |

### WebSocket

| Endpoint | Protocol | Description |
|----------|----------|-------------|
| `/ws` | WebSocket | Real-time event relay. Messages are `{ event: string, data: Record }`. |

## WebSocket Event Types

Events emitted to WebSocket clients mirror the SSE events received from the coral backend, plus connection lifecycle:

| Event | Direction | Payload |
|-------|-----------|---------|
| `connected` | server → client | `{ streamId, sseState }` — sent on WS connect |
| `ready` | relayed | SSE stream connected |
| `job:created` | relayed | New job started |
| `job:phase_changed` | relayed | Job phase transition |
| `job:progress` | relayed | Job progress event |
| `job:completed` | relayed | Job finished |
| `discuss:updated` | relayed | Discuss session state changed |

Frontend components use `wsClient.subscribe(handler)` and call `fetchApi` to refresh data on any `job:*` or `ready` event.

## Unimplemented Schema Features

The following tables exist in the SQLite schema but have no write path yet:

| Table | Status |
|-------|--------|
| `daily_metrics` | Schema defined in `src/server/schema.ts` — no aggregation logic implemented |
| `search_index` | FTS5 virtual table defined — not populated or queried |
