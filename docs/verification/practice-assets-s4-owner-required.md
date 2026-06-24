# Practice Assets S4 Owner Required

This slice closes S4-10 for the deterministic checker registry. It registers `owner-required` and makes ownership enforcement depend on explicit governed component/resource evidence rather than broad keyword or symbol matches.

## P1 Map

- Practice asset: `packages/core/practice-catalog/assets/practices/ownership.explicit-lifecycle-owner.yaml` declares `checkId: owner-required`.
- Checker registry: `packages/core/practice-engine/src/check-registry.ts` owns deterministic checker dispatch and check-result subjects.
- Owner registry: `packages/core/practice-engine/src/enforcement.ts` reads daemon-owned `.archcontext/model/nodes/**` ownership declarations and now records governed subject ownership alongside the owner allowlist used by waivers.
- Runtime integration: `packages/local-runtime/runtime-daemon/src/index.ts` passes the owner registry into complete-stage practice enforcement.
- Catalog manifest: `packages/core/practice-catalog/assets/catalog.yaml` is updated because the ownership asset is now repo opt-in complete-capable.
- Tests: `packages/core/practice-engine/test/practice-engine.test.ts` covers checker behavior and registry subject extraction.

Out of scope: adding a new governance schema flag, scanning all historical model nodes without a matching practice evidence subject, or accepting caller-provided owner attestations through CLI/MCP.

## P2 Trace

Concrete complete-gate path:

1. Repo policy opts `ownership.explicit-lifecycle-owner` into `complete` with `checkIds: ["owner-required"]`.
2. Runtime daemon builds `ownerRegistry` from local model node files and passes it to `evaluatePracticeEnforcement`.
3. `runRegisteredPracticeCheck` dispatches to `ownerRequired`.
4. The checker selects only non-heuristic `architecture-model` / `diff` evidence with explicit governed prefixes such as `governed:component.checkout`, or direct model subjects that exist in the owner registry.
5. Plain symbol evidence such as `symbol.componentCheckout` returns `not_applicable:no-violation`.
6. For governed subjects, owner proof comes from model-derived lifecycle owners or explicit `lifecycle-owner:<subject>=<owner>` evidence, but the owner identity must resolve in the daemon-owned registry.
7. The checker passes only when each governed subject has exactly one lifecycle owner and that owner is known to the daemon-owned registry. Missing, split, unknown, or self-attested ownership fails with the governed subject as the violation subject.

## P3 Decision

The invariant is that complete enforcement must be deterministic and model-owned. The checker does not infer ownership from task text, file names, or generic symbols. It also does not treat every model node as a current violation; a practice match must explicitly identify the governed subject being inspected.

The tradeoff is conservative scope. A real owner gap is enforceable once the matcher or profile resolver emits governed subject evidence. Until then, generic ownership signals can still recommend the practice but cannot hard-fail complete.

At 10x repository size, the checker scales with matched evidence and the owner registry subject map. The first pressure point is upstream evidence production, not checker complexity.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/core/practice-catalog/test/practice-catalog.test.ts packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --test-name-pattern "complete_task applies repo opt-in deterministic practice enforcement"
bun run typecheck
git diff --check
bun run verify
```

Observed readbacks:

- Practice-engine focused suite: 11 pass / 0 fail / 51 expects.
- Practice catalog + practice engine focused suites: 18 pass / 0 fail / 72 expects.
- Runtime complete-task focused test: 1 pass / 0 fail / 8 expects.
- `bun run typecheck`: pass.
- `git diff --check`: pass.
- Full verification: `bun run verify` passed with 600 tests / 0 fail / 3581 expects. The verify chain also passed packaged CLI smoke, privacy route audit, GitHub API contract audit, privacy/security manifest readback, acceptance ledger, sprint status check, and representative eval.

## Gate Evidence

- `owner-required` is registered in the deterministic checker registry.
- `ownership.explicit-lifecycle-owner` is repo opt-in complete-capable.
- Plain symbol evidence is advisory/checkpoint relevance only and does not hard-fail complete.
- Explicit governed subjects pass only with exactly one known lifecycle owner.
- Missing, split, unknown, or self-attested owners fail with stable violation subjects.
