# Agent System

## Agent Quick Reference

| Agent | Tier | Model | Purpose |
|-------|------|-------|---------|
| review-orchestrator | 0 | opus | Final validation supervisor — mandatory last step |
| api-guardian | 1 | opus | Auth enforcement, input validation, error handling consistency for raw HTTP |
| async-safety | 1 | opus | Unhandled promise rejections, event loop blocking, SSE/WS connection lifecycle |
| state-guardian | 1 | opus | React state management bugs — stale closures, dependency arrays, re-render prevention |
| code-critic | 3 | sonnet | Code quality review (elegance, complexity, pattern adherence) |
| doc-critic | 3 | sonnet | Documentation quality review (accuracy, structure, completeness) |
| test-critic | 3 | sonnet | Test quality review (design, coverage, assertions, isolation) |

## Consultation Matrix

| Task Type | Mandatory Agent | Recommended Agent |
|-----------|----------------|-------------------|
| New REST API handler or route | api-guardian | code-critic |
| Modify SSE client or WS relay | async-safety | code-critic |
| Modify cold scan or indexer | async-safety, api-guardian | code-critic |
| New React component | state-guardian | code-critic |
| Modify WsClient or store | state-guardian | code-critic |
| Add/modify SQLite schema | api-guardian | doc-critic |
| Any documentation change | doc-critic | — |
| Any test change | test-critic | — |
| All implementations before finish | review-orchestrator | — |

## Design Principles

### Fresh Context for Verification

When verifying work output, spawn a dedicated subagent instead of self-verifying.

**Why**: The producing agent accumulates context bias through planning, decision-making, and execution — it is predisposed to confirm its own output. A fresh subagent has no prior commitment to the result.

**Pattern**:
- Producer agent generates output (files, plans, code)
- Verifier subagent receives only: inputs (requirements, analysis) + outputs (generated files)
- Verifier has a single goal: do the outputs satisfy the inputs?
- One goal, clean context, higher accuracy

**Anti-pattern**: Agent generates artifacts → same agent "spot-checks" its own work → confirmation bias → defects pass through.
