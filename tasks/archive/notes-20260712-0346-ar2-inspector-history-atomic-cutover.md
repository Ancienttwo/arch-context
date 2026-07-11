> **Archived**: 2026-07-12 03:46
> **Related Plan**: plans/archive/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260712-0346

# Implementation Notes: ar2-inspector-history-atomic-cutover

> **Status**: Complete
> **Plan**: plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md
> **Contract**: tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md
> **Review**: tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md
> **Last Updated**: 2026-07-12 03:32
> **Lifecycle**: notes

## Design Decisions

- `historyEvents` is required in the existing V2 contract; all typed callers, schema,
  fixtures, compiler, cache/RPC/CLI pass-through, and HTML moved atomically.
- History is derived only from manifest-bound `eventBacklinks`; there is no second
  database/event query and no raw event body.
- Duplicate event IDs with identical metadata merge unique sorted subject IDs.
  Conflicting title/rationale fails closed with `conflicting-event-backlink:<id>`.
- `historyEvents` contains all verified backlinks; `decisions` remains the strict
  title/rationale subset.
- `EXPLORER_INSPECTOR_CONTRACT_VERSION` enters every view-definition digest. Old cache
  rows are unreachable manifest misses, not migrated or accepted through compatibility.
- Projection delta evidence now includes decisions/history/change backlinks so history
  changes are observable.

## Deviations From Plan Or Spec

- None recorded.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Optional V2 field | Rejected | Would preserve two public shapes |
| Inspector-owned event query | Rejected | Breaks manifest/cursor authority |
| Cache row rewrite | Rejected | Disposable manifest cache should miss naturally |
| Required atomic V2 cutover | Selected | Pre-1.0 and one authoritative shape |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Readback: `docs/verification/explorer-ar2-inspector-history-readback.{json,md}`.
- Contract/compiler/daemon/store/HTML/CLI/typecheck/`verify:explorer` and privacy audit
  all pass; static search finds no optional history field or fallback query.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
