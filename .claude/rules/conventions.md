# Conventions

**Commits**: Conventional commits — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

**Naming**:
- TypeScript identifiers: `camelCase` for variables/functions, `PascalCase` for types/classes/components
- File names: `camelCase.ts` for backend modules, `PascalCase.tsx` for React components
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants (e.g., `CORAL_REEF_PORT`, `FRONTEND_DIST_DIR`)
- Database columns: `camelCase` matching TypeScript type field names

**TypeScript**:
- Strict mode enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- No `any` — use `unknown` for untyped external data, then narrow with type guards
- Runtime type guards pattern: `isRecord`, `readString`, `readNumber` helpers for untrusted payloads
- ESM modules (`type: "module"`, `.js` extensions in imports)

**Tests**: No test framework is currently configured. When adding tests:
- Use a framework compatible with ESM (Vitest recommended)
- Unit tests alongside source files in `__tests__/` subdirectories
- Integration tests for API handlers should use an in-memory SQLite instance

**Formatting**: No formatter is configured. Match the existing style:
- 2-space indentation
- Single quotes for strings
- Trailing commas in multiline structures
- Semicolons required
