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
- `compatibility-debt`: unjustified compatibility recall is >= 85%.
- ChangeSet fault injection rolls back touched files completely.
- Apply update refuses stale worktree digest before writing.
