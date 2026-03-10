# Developer Guide: coral-reef

## Prerequisites

- Node.js 18+ (ESM support required)
- `../coral` repository must exist (coral-reef depends on it via `file:../coral`)
- Coral CLI running to enable live SSE stream (dashboard works offline with cold scan only)

## Project Structure

coral-reef is a **dual-package** project: a Node.js backend at the root, and a separate React SPA in `src/web/`. Each has its own `package.json` and must be installed independently.

```
coral-reef/
├── package.json          # Backend — Node.js server
├── tsconfig.json         # Backend TypeScript config
├── src/
│   ├── server/           # HTTP server, SQLite, WebSocket
│   ├── api/              # REST API handlers
│   ├── indexer/          # Cold scan + SSE client
│   └── web/              # Frontend (separate npm package)
│       ├── package.json  # Frontend — React SPA
│       ├── vite.config.ts
│       └── src/
└── dist/                 # Backend compiled output (gitignored)
```

## Build Commands

### Backend

```bash
# Install backend dependencies (requires ../coral to exist)
npm install

# Compile TypeScript → dist/
npm run build

# Start the server (requires prior build)
npm start

# Watch mode — recompile on changes (server must be restarted manually)
npm run dev
```

Backend runs on `http://localhost:3100` by default.

### Frontend

```bash
# Install frontend dependencies
cd src/web && npm install

# Build for production (tsc type-check + vite bundle → src/web/dist/)
cd src/web && npm run build

# Start Vite dev server (proxies /api and /ws to localhost:3100)
cd src/web && npm run dev

# Preview production build
cd src/web && npm run preview
```

Frontend dev server runs on `http://localhost:5173`. It proxies `/api` and `/ws` to the backend at port 3100.

### Full Dev Setup

For active development, run both:

```bash
# Terminal 1: backend watch mode
npm run dev

# Terminal 2: frontend dev server (after npm install in src/web)
cd src/web && npm run dev
```

Then visit `http://localhost:5173`.

For production: build both (`npm run build` + `cd src/web && npm run build`), then `npm start`. The backend serves the frontend from `src/web/dist/`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORAL_REEF_PORT` | `3100` | HTTP server port |

Set via environment: `CORAL_REEF_PORT=4000 npm start`

## Database

SQLite database is stored at `~/.claude/coral-reef/db.sqlite` (WAL mode). It is created automatically on first start. The database is gitignored.

To reset: `rm ~/.claude/coral-reef/db.sqlite` and restart.

## Testing

No test framework is currently configured. When adding tests:

1. Add Vitest to `package.json` (ESM-compatible)
2. Unit tests: place alongside source in `__tests__/` subdirectories
3. Integration tests for API handlers: use in-memory SQLite (`:memory:`)

```bash
# Once configured:
npm test
```

## Conventions

See `.claude/rules/conventions.md` for the full conventions reference.

Key points:
- **TypeScript strict mode** — no `any`; use `unknown` + type guards for untrusted data
- **ESM modules** — `"type": "module"` in package.json; use `.js` extensions in relative imports
- **camelCase** for TypeScript identifiers; `PascalCase` for types/components
- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- **No formatter configured** — match existing style (2-space indent, single quotes, semicolons)

## Workflow

**Before implementing**: Read `docs/ARCHITECTURE.md` to understand layer boundaries. Check `.claude/rules/agents.md` for the consultation matrix.

**After implementing**: Run `review-orchestrator` agent. Fix any BLOCKING findings before building.

**Build verification**: `npm run build` (backend) + `cd src/web && npm run build` (frontend). Both must pass.

## Common Issues

**`cannot find module 'coral/client'`**: The `file:../coral` dependency requires `../coral` to exist and be built. Run `npm install` in `../coral` first.

**Frontend not found (503)**: Run `cd src/web && npm install && npm run build` to build the frontend before starting the backend.

**SQLite WAL files (`*.sqlite-wal`, `*.sqlite-shm`)**: These appear during operation and disappear on clean shutdown. They are gitignored. If leftover after a crash, they are safe to leave — SQLite will recover on next start.
