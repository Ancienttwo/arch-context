# Implementation Notes: axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer

> **Status**: Active
> **Plan**: plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md
> **Contract**: tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md
> **Review**: tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md
> **Last Updated**: 2026-08-08 19:43
> **Lifecycle**: notes

## Design Decisions

- The projection manifest stores a canonical per-capability semantic baseline; it is a
  generated read model and never becomes a second semantic authority.
- Automatic refresh requires an exact accepted ChangeSet/event reference. A semantic
  delta without that reference, or an unprovable P1/P2, emits only
  `human-action-required`.
- Set-valued model fields are canonicalized before hashing, so YAML ordering does not
  produce a major-change signal. Ordered flow steps/outcomes remain order-sensitive.
- Signal identity excludes bodies/diffs/prompts and is derived only from typed identity,
  reason/node sets and digest sets; projection receipt back-references remain non-circular.

## Deviations From Plan Or Spec

- None recorded.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Infer major changes from source/LOC | Rejected | Cannot distinguish functional semantics from refactor and would violate the fail-closed source-of-truth rule. |
| Emit refresh from any model diff | Rejected | An unaccepted model delta is only a candidate; it cannot publish new semantic truth. |
| Persist semantic state in a separate mutable registry | Rejected | The generated manifest already provides the required accepted-baseline read model without introducing dual authority. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Focused verification: 271 tests passed across contracts, projection engine and CLI.
- Full verification: `bun run verify`; 1210 tests passed and every package/privacy/
  Mermaid/eval gate completed successfully.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
