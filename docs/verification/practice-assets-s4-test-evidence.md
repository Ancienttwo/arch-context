# Practice Assets S4 Test Evidence

This slice closes S4-12 for the deterministic checker registry. It registers `required-test-evidence` and limits complete enforcement to test commands or test evidence explicitly declared by repo policy.

## P1 Map

- Practice asset: `packages/core/practice-catalog/assets/practices/api.contract-before-implementation.yaml` declares `checkId: required-test-evidence`.
- Policy contract: `packages/contracts/src/practices.ts` and `schemas/repo/practices/practice-policy.schema.json` define optional `testEvidence` declarations on a policy rule.
- Enforcement evaluator: `packages/core/practice-engine/src/enforcement.ts` validates `testEvidence` and passes the selected policy rule into checker dispatch.
- Checker registry: `packages/core/practice-engine/src/check-registry.ts` owns `required-test-evidence` evaluation and test-evidence subject matching.
- Catalog manifest: `packages/core/practice-catalog/assets/catalog.yaml` is updated because the API contract asset is now repo opt-in complete-capable.
- Tests: `packages/core/practice-engine/test/practice-engine.test.ts` covers policy-declared commands, subjects, missing proof, partial proof, and non-blocking heuristic evidence.

Out of scope: inferring tests from package scripts, task text, filenames, CI provider logs, or caller-provided complete-task results.

## P2 Trace

Concrete complete-gate path:

1. Repo policy opts `api.contract-before-implementation` into `complete` with `checkIds: ["required-test-evidence"]`.
2. The same policy rule may declare `testEvidence.commands` and/or `testEvidence.subjects`.
3. `validatePracticeEnforcementPolicy` rejects empty declarations, non-array fields, blank subjects, and multi-line test commands.
4. `evaluatePracticeEnforcement` passes the policy rule to `runRegisteredPracticeCheck`.
5. `required-test-evidence` returns `not_applicable:no-violation` when the policy rule does not declare required test evidence.
6. When policy declares evidence, only observed or verified `test` / `runtime-check` evidence can satisfy the gate.
7. Commands are matched through `test-command:<command>` or `test-command-passed:<command>` subjects.
8. Test subjects are matched through `test-evidence:<subject>`, `test-result:<subject>`, or `test:<subject>` subjects.
9. Missing commands or subjects fail with stable violation subjects such as `test-command:bun test packages/api-contract.test.ts` and `test-evidence:schema.public-api`.

## P3 Decision

The invariant is that complete enforcement must be explicit, deterministic, and repo-owned. A practice asset can say that test evidence may be required, but the hard gate only becomes active when repo policy names the required command or subject.

The tradeoff is that this checker does not discover the right test automatically. That avoids converting broad API-contract relevance into a hard blocker based on task text or generic symbols. The repo must name the exact test proof it wants to require.

At 10x repository size, the checker scales with policy-declared commands/subjects and matched evidence. The first pressure point is maintaining policy declarations for high-value APIs, not checker runtime.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/contracts/test/contracts.test.ts
bun test packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/core/practice-catalog/test/practice-catalog.test.ts
bun test packages/contracts/test/contracts.test.ts packages/core/practice-catalog/test/practice-catalog.test.ts packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --test-name-pattern "complete_task applies repo opt-in deterministic practice enforcement"
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
bun run verify
```

Observed readbacks:

- Contracts focused suite: 114 pass / 0 fail / 400 expects.
- Practice-engine focused suite: 14 pass / 0 fail / 69 expects.
- Practice-catalog focused suite passed after updating the built-in manifest digest.
- Combined contracts + catalog + engine focused suites: 135 pass / 0 fail / 488 expects.
- Runtime complete-task focused test: 1 pass / 0 fail / 8 expects.
- `bun run typecheck`: pass.
- `node scripts/sprint-status-check.mjs`: pass.
- `git diff --check`: pass.
- Full verification: `bun run verify` passed with 603 tests / 0 fail / 3601 expects. The verify chain also passed packaged CLI smoke, privacy route audit, GitHub API contract audit, privacy/security manifest readback, acceptance ledger, sprint status check, and representative eval.

## Gate Evidence

- `required-test-evidence` is registered in the deterministic checker registry.
- `api.contract-before-implementation` is repo opt-in complete-capable.
- Missing policy `testEvidence` returns `not_applicable` rather than hard-failing.
- Task text, symbol evidence, and heuristic-only evidence cannot satisfy or trigger the hard gate.
- Policy-declared test commands and subjects pass only with observed or verified test/runtime-check evidence.
