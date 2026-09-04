# Implementation Notes: projection-adoption-accepted-change-fixed-point

> **Status**: Complete
> **Plan**: plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md
> **Contract**: tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md
> **Review**: tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md
> **Last Updated**: 2026-09-04 21:13
> **Lifecycle**: notes

## Design Decisions

- Treat ownership adoption plus semantic acceptance as one projection transaction. The approved input projection consumes `acceptedChange`; every post-adoption fixed-point rebuild omits it because the approval is single-use.
- Preserve the provider's durable apply identity and recovery protocol for `mode=adopt`; a successful protocol adoption is not merely a docs-adoption receipt.

## Deviations From Plan Or Spec

- The release CLI suite exposed an existing embedded-runtime lifetime bug in `book` and the newly async `projection` path: `runCliUnchecked` returned their promises without awaiting them, so its `finally` stopped the daemon mid-command. The same owning CLI file now awaits both commands; existing Book coverage and the new adoption regression guard the two paths.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Re-run the classifier with `acceptedChange` after adoption | Reject | It consumes the same approval twice and correctly fails closed. |
| Adopt first and apply semantic change in a second transaction | Reject | It creates a partial state and breaks the consumer's single approved operation. |
| One daemon transaction with a no-accepted-change fixed point | Use | It preserves exact approval binding, atomicity, receipt recovery, and existing authority boundaries. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Registry release: `docs/verification/archctx-0.5.6-release.json`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
