# Implementation Notes: ar4-integrated-product-readback

> **Status**: Completed
> **Plan**: plans/plan-20260712-0411-ar4-integrated-product-readback.md
> **Contract**: tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md
> **Review**: tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md
> **Last Updated**: 2026-07-12 05:00
> **Lifecycle**: notes

## Design Decisions

- Kept AR4 acceptance-first and changed product code only for three reproduced ship
  blockers found in the real visible browser.
- Kept semantic navigation server-owned: the compiler emits the view-root breadcrumb;
  the browser only applies typed URL actions.
- Made expiry session-owned. The timer closes existing SSE clients, and its delay is
  computed from the absolute expiry after the listener is ready.
- Registered the existing capability module through `capability-config`; no generated
  model or architecture document was deleted.

## Deviations From Plan Or Spec

- Exact dual-SSE refetch qualification was verified by automated inline-runtime and
  daemon tests; visible-browser acceptance covered connected and expiry-disconnected
  states. This preserves deterministic event assertions while retaining real product
  acceptance for the user-visible freshness surface.
- `bun run verify` was executed directly because adding it after the 404-test focused
  matrix exceeds repo-harness's 120-second aggregate contract-helper timeout. The
  strict contract machine-checks the durable zero-failure PASS record instead of
  pretending the timeout is a product failure.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Shrink SVG below readable minimum | Reject | Keep a 640 px topology canvas with local scrolling |
| Browser-infer breadcrumb parent | Reject | Projection compiler owns semantic context |
| Reject only new requests after expiry | Reject | Existing SSE clients must also lose authority |
| Add V1/legacy aliases | Reject | Atomic V2 cutover is complete and explicit |

## Open Questions

- None.

## Evidence Links

- Durable readback: `docs/verification/ar4-product-readback.json`
- Human readback: `docs/verification/ar4-product-readback.md`
- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Screenshots: `/Users/ancienttwo/.gstack/projects/arch-context/designs/explorer-ar4-20260712/`

## Promotion Candidates

- None. The three findings were product-specific acceptance defects, not yet a repeated
  cross-task pattern.
