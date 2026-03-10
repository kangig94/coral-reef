---
paths:
  - "src/api/**"
  - "src/server/**"
  - "src/indexer/**"
---
# Backend — Node.js / TypeScript Rules

## Mandatory Concerns

### SQL Safety
All database queries MUST use parameterized prepared statements. Never interpolate external input into SQL strings.

```typescript
// CORRECT: parameterized
const job = db.prepare('SELECT * FROM jobs WHERE jobId = ?').get(jobId);

// WRONG: string interpolation with external input
const job = db.prepare(`SELECT * FROM jobs WHERE jobId = '${jobId}'`).get();
```

**Known exception**: `countRows` in `src/api/health.ts:68-70` uses string interpolation for table names. This is safe because all call sites at `health.ts:55-60` pass hardcoded string literals — no user input reaches this function. Do not replicate this pattern; it is documented here to prevent false violation flags.

### Async Safety
All async operations must handle rejection. The server provides a top-level catch at `src/server/index.ts:23`, but individual handlers should still catch domain-specific errors for structured responses.

```typescript
// CORRECT: void with catch
void asyncOperation().catch((err) => { /* handle */ });

// CORRECT: await in try/catch
try {
  await asyncOperation();
} catch (err) {
  sendJson(res, 500, { error: 'operation_failed' });
}

// WRONG: floating promise (no catch)
asyncOperation();
```

### Error Responses
Use `sendJson` from `src/api/router.ts` for all error responses. Response body must be `{ error: string }`.

```typescript
// CORRECT
sendJson(res, 404, { error: 'job_not_found' });

// WRONG: leaks internal details
sendJson(res, 500, { error: err.stack });
```

### Graceful Shutdown
Any new long-lived resources (timers, streams, connections) MUST be cleaned up in the shutdown handler at `src/server/index.ts:44-57`. Register cleanup there, not ad hoc.

## Validation Checklist

### BLOCKING
- [ ] All SQL queries use parameterized statements (exception: `countRows` hardcoded table names)
- [ ] POST handler body is validated before use
- [ ] Error responses are structured `{ error: string }` — no stack traces
- [ ] No unhandled promise rejections in new async code

### STRONG
- [ ] Graceful shutdown: new persistent resources registered in shutdown handler
- [ ] SSE/WS lifecycle: new connections have explicit cleanup paths
- [ ] Health endpoint updated if new subsystems added

## Anti-Patterns

| Bug | Symptom | Detection | Fix |
|-----|---------|-----------|-----|
| Floating promise | Silent failures in SSE/WS handlers | `grep -rn 'sseClient\.\|ws\.' src/ \| grep -v 'void \|await \|catch'` | Add `void` + `.catch()` or `await` in try/catch |
| Missing handler return | Route falls through to 404 unexpectedly | Check all `handleX` functions return `true` on match | Add explicit `return true` after `sendJson` |
| Synchronous blocking in hot path | High latency on all requests | Profile with `--prof` | Move to `setImmediate` or worker thread |
