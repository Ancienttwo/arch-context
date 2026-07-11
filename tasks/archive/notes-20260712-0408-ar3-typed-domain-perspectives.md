> **Archived**: 2026-07-12 04:08
> **Related Plan**: plans/archive/plan-20260712-0349-ar3-typed-domain-perspectives.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260712-0408

# Implementation Notes: ar3-typed-domain-perspectives

> **Status**: Completed
> **Plan**: plans/plan-20260712-0349-ar3-typed-domain-perspectives.md
> **Contract**: tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md
> **Review**: tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md
> **Last Updated**: 2026-07-12 04:01
> **Lifecycle**: notes

## Design Decisions

- Added one exported canonical five-view tuple and reused it in contract validation,
  daemon URL parsing, CLI validation, schemas, fixtures, and surface/package tests.
- Replaced subject-only view filtering with coherent `selectViewGraph` selection so
  relation admission cannot drift from selected subjects.
- Data-flow uses only exact typed `reads|writes|publishes|subscribes` relations.
- External integrations seeds only typed architecture entities whose kind is
  `external-system`; only direct adjacent relations and exact endpoints are returned.
- Added exact selection-policy discriminators to every view-definition digest. The
  cache lifecycle remains manifest miss only; no row mutation or migration exists.
- Typed subset overview totals are derived only from selected subjects so an empty
  view cannot fabricate groups from repository-wide kind totals.

## Deviations From Plan Or Spec

- None recorded.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Separate subject and relation filters | Rejected | Could admit unrelated induced edges between included external neighbors |
| Name/path/prose classifier | Rejected | Violates typed authority and creates a shadow semantic source |
| Coherent typed subgraph selector | Selected | Exact, deterministic, linear, and shared across overview/context/detail |
| Cache rewrite/migration | Rejected | View-definition digest gives a safe disposable manifest miss |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Readback: `docs/verification/ar3-domain-perspectives-readback.md`
- Machine evidence: `docs/verification/ar3-domain-perspectives-readback.json`
- Focused matrix: 325 pass / 0 fail.
- Contract verification: 14 pass / 0 fail, Fulfilled.
- Typecheck, `verify:explorer`, packaged CLI smoke, privacy route audit: PASS.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
