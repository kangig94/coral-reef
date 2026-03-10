<!-- GENERATION RULE: This file must contain only STABLE PRINCIPLES - not volatile facts.
     Module dependency graphs, specific file lists, and current architecture details
     belong in docs/ (ARCHITECTURE.md, DEV_GUIDE.md). Reference docs instead of duplicating.
     Test: if content needs updating on refactor (without principle change), it belongs in docs. -->

# Design Philosophy

## Core Principles

**Clarity First**: Good code guides readers naturally — structure reveals intent without requiring explanation. Dense code can be clear; minimal code can be confusing. Optimize for cognitive load, not line count.

**Defensive Runtime Typing**: All external data (coral filesystem reads, SSE payloads, HTTP request bodies) must be validated at entry points with explicit type guards (`isRecord`, `readString`, `readNumber`). Never trust incoming data shapes.

**Raw-HTTP Routing Discipline**: The server uses no framework middleware. All routing is explicit prefix matching in `src/api/router.ts`. Every handler returns `boolean` — claimed (`true`) or not (`false`). This discipline must be maintained: no implicit routing, no global state in handlers.

**Local Component State**: React components own their own state via `useState`/`useEffect`. No global store is introduced unless a concrete cross-component sharing need is identified. Over-engineering state management before it is needed adds complexity without value.

**Best-Effort Writes, Authoritative Cold Scan**: Live SSE updates to SQLite are best-effort (wrapped in try/catch, no throws). The cold scan at startup is authoritative. This design means missed live events are recovered at next restart — always prefer data consistency over immediate freshness.

## Source Tree Policy

| Directory | Layer | Contents | Modification Rule |
|-----------|-------|----------|-------------------|
| `src/indexer/` | L0 | Filesystem scanner, SSE client | May import from `coral/client` only. No imports from L1-L3. |
| `src/server/` | L1 | HTTP server, SQLite singleton, WebSocket relay | May import from L0. No imports from L2-L3. |
| `src/api/` | L2 | REST API route handlers | May import from L0, L1. No imports from L3. |
| `src/web/` | L3 | React SPA (separate npm package) | Communicates with L1-L2 via HTTP/WS protocols only. No direct imports from backend. |

Key rules:
1. **Layer dependency**: code in Lx may only depend on L0..L(x-1)
2. **Known exception**: `src/api/health.ts` imports `getIndexerStatus` from L0 (`src/indexer/index.ts`) — a cross-layer import permitted for health aggregation only. Do not create additional L2→L0 imports without explicit justification.
3. **Frontend isolation**: `src/web/` is a completely separate npm package with its own `package.json`. It must not import any backend modules. All data flows through the REST API and WebSocket.

## Module Structure

Dependency direction is strict: the composition root (`src/server/index.ts`) imports from lower modules; lower modules never import from the composition root. See `docs/ARCHITECTURE.md` for the current dependency graph.

## Agent System Philosophy

- **Tiered Expertise**: Opus for safety/orchestration (tier 1), Sonnet for domain/quality (tier 2-3)
- **Mandatory Consultations**: Cross-domain changes (backend + frontend) require both `api-guardian` and `state-guardian`
- **Final Validation**: `review-orchestrator` is the mandatory last step before completing any implementation
