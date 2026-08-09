# Implementation Notes: projection-accepted-change-protocol

> **Status**: Active
> **Plan**: plans/plan-20260810-0228-projection-accepted-change-protocol.md
> **Contract**: tasks/contracts/20260810-0228-projection-accepted-change-protocol.contract.md
> **Review**: tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md
> **Last Updated**: 2026-08-10 02:35
> **Lifecycle**: notes

## Design Decisions

- Keep protocol identity at `archcontext.projection-request/v1`; `acceptedChange` is an additive optional field with the existing `AcceptedArchitectureChangeReferenceV1` shape.
- Validate acceptance at all three boundaries: JSON schema, contract invariants, and CLI raw-input parsing. Invalid or partial input fails closed.
- Forward the same accepted reference through initial projection and adoption fixed-point rebuilds so classification and receipt identity cannot diverge.
- Align the patch release at `0.4.1` across the root product, five internal workspaces, contracts fixtures, practice catalog, action/workflow pins, and install runbooks.
- Preserve the Node contract `>=24 <26`; verification ran with Node `24.19.0` because the host default Node `26.5.0` is intentionally outside the supported range.

## Deviations From Plan Or Spec

- Publication is a post-merge delivery action. This work package prepares and verifies the exact 0.4.1 source candidate; npm publication happens only from merged `main`.
- `plan-to-todo` replaced the originally captured contract with a generic scaffold. The contract was restored to the approved goal, explicit paths, and real exit criteria before further scope expansion.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Add ProjectionRequestV2 | Reject | The accepted reference is additive and does not change existing request semantics. |
| Infer acceptance from changed paths | Reject | Acceptance is human authority and must remain explicit, typed, and receipt-bound. |
| Run archctx under repo-harness Node | Reject | The two products may have different Node engines; the caller must select a runtime satisfying the provider's range. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- `bun run typecheck`: pass.
- Focused contracts suite: 176 pass, 0 fail.
- Focused stable-protocol and major-change projection tests: pass, including unresolved `human-action-required`, accepted `refresh-required`, partial input rejection, and non-canonical input rejection.
- `bun run verify` with Node 24.19.0: pass; 1218 tests pass, 0 fail, Mermaid verification covers 3 diagrams, and all downstream audits/readbacks/evals pass.
- User explicitly instructed to skip Claude review; the frozen contract permits a typed `user_waiver`, which will be bound to the exact candidate subject before merge.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
