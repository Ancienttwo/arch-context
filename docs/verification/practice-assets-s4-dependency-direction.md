# Practice Assets S4 Dependency Direction

This slice closes S4-09 for the deterministic complete-stage checker registry. It registers `dependency-direction` without widening the runtime contract or treating every import edge as a layer violation.

## P1 Map

- Practice asset: `packages/core/practice-catalog/assets/practices/modularity.respect-dependency-direction.yaml` declares `checkId: dependency-direction` and `requiresDeclaredProfile: true`.
- Complete checker registry: `packages/core/practice-engine/src/check-registry.ts` owns deterministic checker registration and check-result construction.
- Enforcement flow: `packages/core/practice-engine/src/enforcement.ts` selects repo opt-in complete rules and passes the current match plus optional previous checkpoint match into the registered checker.
- Evidence contract: `PracticeMatchV1.evidence` is the only checker input surface. The current policy and practice-profile schemas do not carry a layer graph, so hard failures require explicit profile-derived violation subjects rather than raw imports.
- Tests: `packages/core/practice-engine/test/practice-engine.test.ts` covers the complete gate semantics.

Out of scope: adding a new layer-graph schema, changing policy-file shape, or implementing a profile resolver that derives violation subjects from repository files.

## P2 Trace

Concrete complete-gate path:

1. Repo policy opts `modularity.respect-dependency-direction` into `complete` with `checkIds: ["dependency-direction"]`.
2. `evaluatePracticeEnforcement` finds the current `PracticeMatchV1` and previous checkpoint match for the same practice.
3. `runRegisteredPracticeCheck` dispatches to `dependencyDirection`.
4. The checker scans non-heuristic `architecture-model` and `import-edge` evidence only when the subject has an explicit violation prefix such as `declared-layer-violation:`, `boundary-violation:`, or `dependency-direction-violation:`.
5. Plain import-edge subjects such as `symbol.ui->symbol.domain` return `not_applicable:no-violation`; they can explain recommendation relevance but cannot fail complete.
6. With explicit violation subjects and a baseline, only subjects absent from the previous checkpoint fail the gate. Existing subjects pass; missing baseline returns `not_applicable:no-baseline`.

## P3 Decision

The invariant is that complete enforcement remains deterministic and profile-led. The existing `PracticeMatchV1` surface can carry evidence subjects but not a full layer graph, so this slice makes the hard-fail contract narrow: a profile resolver must mark violation subjects explicitly before the checker can block.

The tradeoff is conservative enforcement. Some real dependency-direction problems remain advisory until a profile resolver emits explicit violation evidence, but the gate cannot accidentally convert every ordinary import into a complete-stage failure.

At 10x repository size, the checker scales with the evidence list size and performs set subtraction against the previous checkpoint. The first likely pressure point remains upstream: producing precise profile-derived violation evidence from repo model files.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/core/practice-engine/test/practice-engine.test.ts
bun test packages/surfaces/cli/test/cli.test.ts --test-name-pattern "CLI exposes repo and landscape commands without changing single-repo defaults"
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
bun run verify
```

Observed readback:

- Practice-engine focused suite: 10 pass / 0 fail / 42 expects.
- CLI repo/landscape focused test: 1 pass / 0 fail / 12 expects.
- `bun run typecheck`: pass.
- `node scripts/sprint-status-check.mjs`: `STRUCTURE AND EVIDENCE CLAIMS OK`.
- `git diff --check`: pass.
- `bun run verify`: 599 pass / 0 fail / 3572 expects; packaged CLI smoke, privacy/security manifests, acceptance ledger, sprint status check, and representative eval all passed.

## Gate Evidence

- `dependency-direction` is registered in the deterministic checker registry.
- Ordinary import edges are not complete-stage violations without explicit profile-derived violation markers.
- Explicit layer/boundary violation subjects fail only when newly introduced after the checkpoint baseline.
- Missing baseline returns `not_applicable:no-baseline`, preserving the existing historical-debt boundary.
