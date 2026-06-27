# AL8 Fixture Gates and Repository Budgets Readback

Date: 2026-06-26

## Scope

This closes AL8-15 and AL8-16: complete-enforcement practices must declare positive, near-negative, mixed-change and baseline fixtures, and repository-local recommendation scheduler frequency/budget configuration is loaded from `.archcontext/policies/practices.yaml` with safe defaults.

## P1 Map

The authority boundary stays local. Practice fixture readiness lives on `PracticeAssetV1.enforcement.fixtureGate`; repo-local scheduler configuration lives on `PracticeEnforcementPolicyV1.recommendations`; complete enforcement is still evaluated by `@archcontext/core/practice-engine`; recommendation budget decisions are deterministic in `@archcontext/core/recommendation-engine`.

## P2 Traced Path

```text
.archcontext/policies/practices.yaml
  -> loadPracticeEnforcementPolicy()
  -> policy.recommendations
  -> planRecommendationRun({ schedulerPolicy })
  -> schedulerBudget readback + capped L3 investigation eligibility

PracticeAssetV1.enforcement.fixtureGate
  -> loadPracticeCatalog()
  -> evaluatePracticeEnforcement()
  -> fixture-gate-missing when complete policy targets an ungated practice
```

## P3 Decision

This keeps advisory/repo opt-in semantics intact. Fixture gates do not make a practice complete-gating by themselves; they are a prerequisite before an explicit repo policy can promote the deterministic check. Scheduler budgets only constrain local recommendation volume and L3 eligibility; they do not add a new daemon, database or mutation path.

## Gates

| Gate | Status |
|---|---|
| AL8-15 | pass |
| AL8-16 | pass |

## Readback

- Complete-eligible practices: 8
- Fixture-gate ready practices: 8
- Missing fixture paths: 0
- Missing gate reason: fixture-gate-missing
- Scheduler recommendations emitted: 2
- Scheduler omitted candidates: 1
- L3 eligible after budget: 1

## Verification

```bash
bun run record:al8:fixture-budgets
bun run readback:al8:fixture-budgets
bun test scripts/architecture-ledger-al8-fixture-budgets-readback.test.ts
bun test packages/core/practice-catalog/test/practice-catalog.test.ts packages/core/practice-engine/test/practice-engine.test.ts packages/core/recommendation-engine/test/recommendation-engine.test.ts packages/contracts/test/contracts.test.ts
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
```

Readback status: verified
