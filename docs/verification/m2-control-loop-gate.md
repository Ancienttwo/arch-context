# M2 Architecture Control Loop Gate

Date: 2026-06-19

## Scope

M2 proves ArchContext is not search-only. It implements the prepare/checkpoint/complete control loop, architecture pressure signals, refactor confidence, proof-required posture, intervention proposal, compatibility contract policy, ChangeSet apply/rollback, and generated projection reconciliation.

## Evidence

- Context compiler: `packages/context-compiler/src/index.ts`.
- Pressure engine: `packages/pressure-engine/src/index.ts`.
- Refactor decision: `packages/refactor-decision/src/index.ts`.
- Policy engine: `packages/policy-engine/src/index.ts`.
- ChangeSet engine: `packages/changeset-engine/src/index.ts`.
- Reconcile engine: `packages/reconcile-engine/src/index.ts`.
- Review engine: `packages/review-engine/src/index.ts`.
- Application orchestration: `packages/application/src/index.ts`.

## Verified Path

```text
prepare_task
  -> budgeted task context
  -> pressure signals with evidence kind
  -> confidence calculation
  -> posture decision
  -> proof point or intervention proposal

plan/update
  -> ChangeSet preview
  -> approval
  -> allowlist + expected digest
  -> apply or full rollback
  -> generated projection rebuild

complete_task
  -> stale snapshot check
  -> compatibility contract review
  -> cleanup gate
  -> ReviewResult
```

## Verification

Command:

```bash
bun test
```

Observed result:

```text
47 pass
0 fail
```

## Eval Coverage

- `refactor-or-patch`: high pressure/high confidence returns `intervention`.
- `high-pressure-low-confidence`: returns `proof-required`.
- `target-vs-migration`: target state does not contain migration-only relations.
- `compatibility-debt`: small deterministic proxy fixture reaches the >= 85% target shape.
- ChangeSet fault injection rolls back touched files completely.
- Apply update refuses stale worktree digest before writing.

## Boundary

M2 is complete for the deterministic control-loop and ChangeSet safety surface. The `compatibility-debt` recall number comes from a small hand-built fixture in `packages/application/test/control-loop.test.ts`; it is not a representative product eval set and does not by itself close the PRD recall gate for production launch.
