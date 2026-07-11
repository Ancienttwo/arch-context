> **Archived**: 2026-07-12 03:30
> **Related Plan**: plans/archive/plan-20260712-0317-ar1-navigation-live-freshness.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260712-0330

# Implementation Notes: ar1-navigation-live-freshness

> **Status**: Complete
> **Plan**: plans/plan-20260712-0317-ar1-navigation-live-freshness.md
> **Contract**: tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md
> **Review**: tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md
> **Last Updated**: 2026-07-12 03:17
> **Lifecycle**: notes

## Design Decisions

- Semantic navigation mutates one cloned current URL. It preserves every unrelated
  parameter; group toggle removes only the selected repeated value or appends it once.
- Focus navigation atomically sets `focus` and `level=detail`; the overview breadcrumb
  removes only focus and sets `level=overview`.
- Visual fit/zoom/pan stays in the single SVG viewport transform and never changes URL,
  compiler inputs, or authority state.
- `authority-changed` is unconditional because its payload has no projection/view
  digest. `projection-invalidated` requires the current view-definition digest and a
  different nonempty projection digest. Both share one debounce timer.
- Error/malformed/missing/expired authentication closes the EventSource, cancels a
  pending reload, and exposes disconnected state. There is no retry or ambient auth.
- The daemon owns the exact response CSP. No meta-CSP or second HTML path exists.

## Deviations From Plan Or Spec

- None recorded.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Client framework/jsdom | Rejected | Dependency and second runtime unnecessary |
| Automatic EventSource retry | Rejected | Can imply freshness and create reload loops |
| Compatibility navigation helpers | Rejected | One URL contract is authoritative |
| Inline runtime + fake DOM harness | Selected | Self-contained and fully deterministic |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Readback: `docs/verification/explorer-ar1-navigation-freshness-readback.{json,md}`.
- Final focused matrix: 115 pass / 0 fail before final contract rerun; typecheck and
  `verify:explorer` PASS.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
