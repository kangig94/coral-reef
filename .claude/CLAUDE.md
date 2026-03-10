# coral-reef — Development Instructions

coral-reef is the web dashboard for the Coral CLI plugin. It indexes Coral's filesystem artifacts (jobs, sessions, discuss runs) into SQLite, serves a REST API and WebSocket relay for live events, and provides a React SPA for monitoring and visualization.

The project is full-stack TypeScript: a Node.js backend (raw HTTP, SQLite WAL, WebSocket via `ws`) and a separate React 19 SPA (Vite 6) in `src/web/`. Both packages must be installed and built independently.

**Critical Requirements**:
- `../coral` must exist — coral-reef depends on it via `file:../coral`
- Backend and frontend are separate npm packages — `npm install` at root AND in `src/web/`
- Layer boundaries are strict — `src/web/` communicates with backend via HTTP/WS only

**Key Documentation**:
- `docs/ARCHITECTURE.md` — Layer diagram, data flow, request lifecycle, modification policy
- `docs/DEV_GUIDE.md` — Build commands, dual-package workflow, environment variables
- `docs/API_REFERENCE.md` — API design conventions, error format, endpoint groups
- `docs/DATABASE_SCHEMA.md` — Data model design, indexing strategy, WAL rationale

**Build Commands**:
```bash
# Backend
npm install
npm run build        # tsc → dist/
npm start            # node dist/server/index.js (port 3100)
npm run dev          # tsc --watch

# Frontend (separate package)
cd src/web && npm install
cd src/web && npm run build   # tsc + vite build → src/web/dist/
cd src/web && npm run dev     # Vite dev server on :5173 (proxies to :3100)
```

Rules in `.claude/rules/` are auto-loaded. Domain-specific rules activate based on file paths via `paths:` frontmatter:
- `backend-node.md` → `src/api/**`, `src/server/**`, `src/indexer/**`
- `frontend-react.md` → `src/web/**`

Good code guides readers naturally — structure reveals intent without requiring explanation.

## Workflow

**Before**: Read `docs/ARCHITECTURE.md` and `docs/DEV_GUIDE.md`. Identify required agent consultations from matrix in `.claude/rules/agents.md`.

**During**: Invoke domain agents per consultation matrix. Follow source tree policy and layer dependency rules from `.claude/rules/design-philosophy.md`.

**After Implementation** (strict order, fail-fast by cost):

**Scope gate**: Steps 1-4 apply only when source-affecting files are modified (source code, build config, dependencies). Non-source changes (docs, agent definitions, config prose) skip entirely.

1. **Lint** — no linter configured yet; add Biome or ESLint when ready
2. **Review Gate** — run `review-orchestrator`. BLOCKING items must pass before build.
3. **Build** — `npm run build` (backend) + `cd src/web && npm run build` (frontend). Both must pass.
4. **Test** — `npm test` once a test framework is configured. All tests must pass before declaring complete.
