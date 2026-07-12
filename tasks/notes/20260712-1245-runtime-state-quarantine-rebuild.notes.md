# Implementation Notes: runtime-state-quarantine-rebuild

> **Status**: Complete
> **Plan**: plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md
> **Contract**: tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md
> **Review**: tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md
> **Last Updated**: 2026-07-12 13:28
> **Lifecycle**: notes

## Design Decisions

- Recovery remains an explicit pre-daemon command. Ordinary startup never quarantines state automatically.
- The target must be the canonical default partition and must fail either structural inspection or a full startup migration/backfill probe executed on a private disposable copy.
- Dry-run and write share a stable confirmation digest that excludes harness/session telemetry; the daemon rebuild receives a fresh complete worktree digest in the same write invocation.
- The target fingerprint excludes mutable SHM coordination bytes, while quarantine still copies and hashes SHM for evidence.
- The CLI returns a bounded rebuild summary and digest instead of duplicating the full rebuild result.

## Deviations From Plan Or Spec

- The host database carried the current migration ID but still failed startup backfill authority checks. Recovery classification therefore expanded from only `target-incomplete` to the narrower `target-startup-failed` state proven on a disposable copy.
- The first successful host write produced a large rebuild response. Output was bounded before closeout; the durable receipt was already metadata-only.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Automatic startup quarantine | Reject | Would convert migration faults into implicit destructive behavior. |
| Row salvage or compatibility reader | Reject | SQLite is not authority and old semantics must not be re-derived. |
| Include SHM in optimistic-lock fingerprint | Reject | Read-only SQLite opens may rewrite SHM after the daemon stops. |
| Return full rebuild envelope | Reject | Unbounded output grows with repository state and duplicates data. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Host readback: `docs/verification/runtime-state-recovery-readback.json`
- Human readback: `docs/verification/runtime-state-recovery-readback.md`

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
