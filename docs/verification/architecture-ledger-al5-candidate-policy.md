# AL5 Candidate Delta Policy Verification

Date: 2026-06-26

## Scope

This note verifies AL5-10: candidate architecture deltas are classified before ChangeSet promotion as `auto-accept`, `require-checkpoint`, `require-proof` or `require-human-approval`.

The module defines a deterministic policy evaluation contract and core evaluator. It does not write ledger events, apply ChangeSets, update `.archcontext/` projections or reject complete-stage review results.

## P1 Map

Components involved:

- Contract type: `ArchitectureCandidateDeltaPolicyEvaluationV1` in `packages/contracts/src/ledger.ts`.
- Runtime schema: `schemas/runtime/architecture-candidate-delta-policy.schema.json`.
- Policy evaluator: `evaluateArchitectureCandidateDeltaPolicy` in `packages/core/policy-engine/src/index.ts`.
- Tests: `packages/core/policy-engine/test/policy-engine.test.ts` and `packages/contracts/test/contracts.test.ts`.
- Sprint authority: `plans/sprints/archctx-architecture-ledger-sprint-checklist.md`.

Out of scope:

- Converting accepted candidates into ChangeSets.
- Review-engine rejection of unsupported deletion, owner change or boundary relaxation claims.
- Baseline attribution for pre-existing issues.
- Any ledger append or projection mutation.

## P2 Trace

Concrete path verified:

1. `ArchitectureCandidateDelta/v1` provides candidate changes, evidence items, mapping ambiguity count and delta digest.
2. `evaluateArchitectureCandidateDeltaPolicy` reads each candidate change.
3. The evaluator derives deterministic reason codes from confidence, evidence coverage, state dimension, target kind and change kind.
4. Reason codes map to one action:
   - high-confidence complete checkpoint evidence: `auto-accept`
   - medium confidence, partial evidence or migration-state progress: `require-checkpoint`
   - low confidence, mapping ambiguity or missing evidence: `require-proof`
   - target-state removals, relation removals, constraint relaxations or owner authority changes: `require-human-approval`
5. The evaluator returns `ArchitectureCandidateDeltaPolicyEvaluation/v1` with stable decision digests and an evaluation digest.

Final side effect: deterministic policy output only. No architecture authority changes.

## P3 Decision

The existing AL5 pipeline intentionally keeps candidate deltas heuristic and context-only. AL5-10 adds a policy boundary before AL5-11 can create ChangeSet proposals, so downstream code does not need to infer approval posture from free-text summaries or target IDs.

The tradeoff is conservative: medium-confidence or partial-evidence changes require a checkpoint even when they look benign. That keeps the next stage safe because `auto-accept` only means eligible for later proposal conversion, not direct ledger mutation.

## Verification

Commands run:

```bash
bun test packages/core/policy-engine/test/policy-engine.test.ts --timeout 90000
bun test packages/contracts/test/contracts.test.ts --timeout 90000
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al5-candidate-policy-verify-state-XXXXXX) bun run verify
```

Observed result:

- Policy-engine focused tests: 3 pass, 0 fail, 22 expect calls.
- Contract/schema tests: 141 pass, 0 fail, 482 expect calls.
- TypeScript typecheck: pass.
- Sprint status check: pass.
- Whitespace check: pass.
- Full verify: `VERIFY_EXIT=0`; 750 pass, 0 fail, 4536 expect calls; packaged CLI smoke, privacy/security readbacks, acceptance ledgers, sprint-status check and representative eval passed.
