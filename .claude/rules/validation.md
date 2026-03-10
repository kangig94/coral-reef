---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---
# Validation Checklists

## BLOCKING (must pass)

### Backend (src/api/**, src/server/**, src/indexer/**)
- [ ] All SQL queries use parameterized statements (`db.prepare(...).run(?, ?)`) — never string interpolation with external input
- [ ] Request body validation on all POST/PUT handlers before processing
- [ ] Error responses use `sendJson` with structured `{ error: string }` format — no stack traces
- [ ] Async handlers wrapped in try/catch or use the server's top-level catch at `src/server/index.ts:23`
- [ ] No synchronous blocking I/O in the SSE client or WS relay hot paths

### Frontend (src/web/**)
- [ ] No stale closures in `useEffect` — all referenced state/props in dependency array
- [ ] All list renders have stable, unique `key` props (never array index)
- [ ] No direct state mutation (always use setter functions)
- [ ] `wsClient.connect()` and `wsClient.subscribe()` paired with cleanup in `useEffect` return

## STRONG (must document if skipped)

### Backend
- [ ] Graceful shutdown handling for SIGTERM/SIGINT present in new server additions
- [ ] SSE reconnect logic handles all error cases (abort, network failure, stale info file)
- [ ] New DB tables have appropriate indexes for their query patterns
- [ ] Health check endpoint extended if new subsystems are added

### Frontend
- [ ] Expensive computations memoized with `useMemo` when called in render
- [ ] Error states handled (not just loading and success states)
- [ ] Components handle empty data gracefully (no runtime crashes on empty arrays)
- [ ] Accessibility: interactive elements have accessible labels

## MINOR (should document)
- Code complexity within thresholds (cyclomatic ≤ 10, function ≤ 50 lines)
- Naming conventions followed (camelCase for TypeScript, kebab-case for files)
- No dead code introduced
- TypeScript strict mode — no `any` without explicit justification
