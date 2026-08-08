# Implementation Notes: axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption

> **Status**: Done
> **Plan**: plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md
> **Contract**: tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md
> **Review**: tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md
> **Last Updated**: 2026-08-08 17:00
> **Lifecycle**: notes

## Design Decisions

- `layout.ts` is the only repo-harness target authority. Renderer links, exact reads,
  recursive orphan discovery, agent-context targets, and projection-owned paths consume it.
- A marker-free mixed file is a typed `projection-adoption-required` rejection. Ordinary
  `docs apply` returns before `planUpdate`, so the writer sees zero operations.
- Adoption is preview-bound to the current worktree digest and a canonical plan ID. The approved
  lane proves a two-render fixed point before submitting one existing `render_projection`
  ChangeSet; it does not introduce a second filesystem writer.
- `runCliUnchecked` now awaits async docs/agent-context handlers before its `finally` closes the
  embedded daemon. The previous un-awaited return could stop `archctxd` between `planUpdate` and
  `applyUpdate` and was reproduced by the adoption integration test.
- External Claude first review found two P1 regressions: empty legacy `localContracts` were no
  longer filtered and a dotted literal directory before a glob was mistaken for a filename. Both
  were fixed with direct regression tests. Its preview-mismatch and non-entity adoption P2 test
  gaps were also closed before re-review.

## Deviations From Plan Or Spec

- The plan expected a dedicated local-runtime test edit. The CLI integration test exercises the
  real daemon `planUpdate`/`applyUpdate` ChangeSet path, while the existing local-runtime suite
  already covers stale worktree, HEAD/model preimages, rollback, and agent-context idempotence;
  duplicating those lower-level tests was unnecessary.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Reuse normal append-on-missing-marker | Rejected | It silently claims brownfield ownership. |
| Write adoption files directly | Rejected | It bypasses ChangeSet preimages, journal and rollback. |
| Apply first render's manifest | Rejected | Its whole-file projection digest describes the pre-adoption appended candidate and requires a second write. |
| Re-render adopted bytes to a fixed point | Selected | The first approved apply writes the canonical manifest and makes the next apply a true noop. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Targeted verification: `209 pass, 0 fail, 1935 expect()` across the contract's seven test files.
- Mermaid verification: `3 diagram(s)`, pinned `@mermaid-js/mermaid-cli@11.16.0`.
- Full verification: `bun run verify` passed with `1184 pass, 0 fail, 7162 expect()` plus
  package boundary, production mock reachability, packaged CLI, privacy/security readbacks,
  acceptance ledgers, Sprint status, Explorer budgets, and representative eval `PASS`.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
