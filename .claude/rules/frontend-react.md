---
paths:
  - "src/web/**"
---
# Frontend — React Rules

## Mandatory Concerns

### useEffect Dependency Arrays
Every value referenced inside `useEffect` must appear in the dependency array or be stable (module-level constants, `useRef` values). Stale closures cause silent bugs where event handlers see outdated state.

```tsx
// CORRECT: loadJobs is recreated when active changes
useEffect(() => {
  let active = true;
  const load = async () => {
    const data = await fetchApi('/api/jobs');
    if (active) setJobs(data.jobs);
  };
  void load();
  return () => { active = false; };
}, []); // active is local, not state — correct

// WRONG: stale closure — setJobs from outer scope not in deps
useEffect(() => {
  fetchApi('/api/jobs').then(data => setJobs(data.jobs)); // setJobs is stable (setter), but pattern risky
}, []); // missing error handling
```

### List Keys
All `Array.map()` renders in JSX must use stable, unique `key` props from the data (e.g., `job.jobId`, `session.sessionId`). Never use array index as key.

```tsx
// CORRECT: stable ID from data (verified at Kanban.tsx:174)
jobs.map((job) => <JobCard key={job.jobId} job={job} />)

// WRONG: index key — causes DOM reconciliation bugs on reorder
jobs.map((job, i) => <JobCard key={i} job={job} />)
```

### WsClient Lifecycle
Components using `wsClient` must:
1. Call `wsClient.connect()` once (idempotent)
2. Call `wsClient.subscribe(listener)` and store the returned unsubscribe function
3. Call the unsubscribe function in the `useEffect` cleanup return

```tsx
// CORRECT pattern (from Kanban.tsx)
useEffect(() => {
  wsClient.connect();
  const unsubscribe = wsClient.subscribe((event) => { /* ... */ });
  return () => { unsubscribe(); };
}, []);
```

## Validation Checklist

### BLOCKING
- [ ] No stale closures — all referenced state/props in `useEffect` dependency arrays
- [ ] All list renders use stable, unique `key` props from data IDs
- [ ] No direct state mutation (always use setter)
- [ ] `wsClient.subscribe()` cleanup in `useEffect` return

### STRONG
- [ ] Expensive computations wrapped in `useMemo` when in render path
- [ ] Error states displayed (not just loading and data states)
- [ ] Empty arrays/null data handled without runtime crashes
- [ ] Interactive elements have accessible labels (`aria-label` or visible text)
- [ ] Lazy-loaded routes (`Metrics`) have `Suspense` fallback

## Anti-Patterns

| Bug | Symptom | Detection | Fix |
|-----|---------|-----------|-----|
| Stale closure | Callbacks see old state after updates | `eslint-plugin-react-hooks` exhaustive-deps | Add missing dependencies or extract to `useRef` |
| Index as key | List items shuffle/lose state on reorder | `grep -rn 'key={i}' src/web/` | Use stable data ID |
| Missing WS cleanup | Memory leak, duplicate event handlers | Check `useEffect` returns in components using `wsClient` | Store and call unsubscribe in cleanup |
| Missing Suspense | White screen on lazy route load failure | Check `App.tsx` lazy routes have fallback | Wrap in `<Suspense fallback={...}>` |

## Style Notes

Inline style objects are the current project convention (no CSS framework). This is accepted — do not introduce CSS modules or Tailwind without team agreement.
