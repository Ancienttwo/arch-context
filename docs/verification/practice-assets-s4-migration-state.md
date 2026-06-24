# Practice Assets S4 Migration State

This slice closes S4-11 for the deterministic checker registry. It registers `migration-review-date` and `migration-removal-condition` for `migration.target-and-removal-state`, with complete enforcement limited to explicit migration evidence.

## P1 Map

- Practice asset: `packages/core/practice-catalog/assets/practices/migration.target-and-removal-state.yaml` declares both migration check IDs.
- Checker registry: `packages/core/practice-engine/src/check-registry.ts` owns complete-stage deterministic checker dispatch.
- Enforcement evaluator: `packages/core/practice-engine/src/enforcement.ts` selects only repo policy rules promoted to `complete`.
- Runtime integration: `packages/local-runtime/runtime-daemon/src/index.ts` already routes complete-stage practice enforcement through the same evaluator.
- Catalog manifest: `packages/core/practice-catalog/assets/catalog.yaml` is updated because the migration asset is now repo opt-in complete-capable.
- Tests: `packages/core/practice-engine/test/practice-engine.test.ts` covers explicit migration evidence, missing fields, vague removal state, and non-blocking symbol evidence.

Out of scope: free-text migration inference, historical migration inventory scans, date-expiry policy, or CLI/MCP caller-provided enforcement results.

## P2 Trace

Concrete complete-gate path:

1. Repo policy opts `migration.target-and-removal-state` into `complete` with `checkIds: ["migration-review-date", "migration-removal-condition"]`.
2. `evaluatePracticeEnforcement` loads the current practice match and dispatches both checks through `runRegisteredPracticeCheck`.
3. Each checker accepts only non-heuristic `architecture-model` / `diff` evidence with explicit migration prefixes such as `migration:module.billing-v1-removal`.
4. Plain symbol evidence such as `symbol.legacyMigrationAdapter` returns `not_applicable:no-violation`.
5. `migration-review-date` requires exactly one matching `migration-review-date:<subject>=YYYY-MM-DD` or `review-date:<subject>=YYYY-MM-DD` declaration.
6. `migration-removal-condition` requires exactly one matching `migration-removal-condition:<subject>=...`, `removal-condition:<subject>=...`, or `removal-state:<subject>=...` declaration with a durable non-vague condition.
7. Missing, malformed, duplicated, or vague proof fails with the migration subject as the violation subject.

## P3 Decision

The invariant is that complete enforcement must remain deterministic and evidence-owned. The checker does not infer migration state from task text, file names, generic symbols, or broad old/new coexistence signals. Those can still recommend the practice at prepare/checkpoint, but complete requires explicit migration evidence.

The tradeoff is that upstream matchers must emit explicit migration subjects before the hard gate applies. This is intentional: it avoids converting historical `legacy` symbols into a complete-stage blocker without a declared migration boundary.

At 10x repository size, the checker scales with the number of matched evidence items. The first pressure point is upstream evidence production and naming consistency, not checker complexity.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/core/practice-catalog/test/practice-catalog.test.ts packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --test-name-pattern "complete_task applies repo opt-in deterministic practice enforcement"
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
bun run verify
```

Observed readbacks:

- Practice-engine focused suite: 12 pass / 0 fail / 60 expects.
- Practice catalog + practice engine focused suites: 19 pass / 0 fail / 81 expects.
- Runtime complete-task focused test: 1 pass / 0 fail / 8 expects.
- `bun run typecheck`: pass.
- `node scripts/sprint-status-check.mjs`: pass.
- `git diff --check`: pass.
- Full verification: `bun run verify` passed with 601 tests / 0 fail / 3590 expects. The verify chain also passed packaged CLI smoke, privacy route audit, GitHub API contract audit, privacy/security manifest readback, acceptance ledger, sprint status check, and representative eval.

## Gate Evidence

- `migration-review-date` and `migration-removal-condition` are registered in the deterministic checker registry.
- `migration.target-and-removal-state` is repo opt-in complete-capable.
- Plain symbol evidence is advisory/checkpoint relevance only and does not hard-fail complete.
- Explicit migration subjects pass only with a valid review date and durable removal condition.
- Missing, malformed, or vague migration proof fails with stable violation subjects.
