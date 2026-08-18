> **Archived**: 2026-08-18 16:13
> **Related Plan**: plans/archive/plan-20260818-1224-daemon-projection-symbol-collision.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260818-1613

# Implementation Notes: daemon-projection-symbol-collision

> **Status**: Active
> **Plan**: plans/plan-20260818-1224-daemon-projection-symbol-collision.md
> **Contract**: tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md
> **Review**: tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md
> **Last Updated**: 2026-08-18 12:47
> **Lifecycle**: notes

## Design Decisions

- Deleted the two private delegates rather than renaming them. Each was a one-line forward with a
  single caller, no override and no test seam, so the indirection bought nothing while costing the
  symbol that shadowed the real function. Renaming would have left a name a future edit could
  collide with again.
- Fixed `completeTaskProjectionFreshness` in the same pass. It has the identical shape and the
  identical collision; fixing only the instance the selector complained about would have left the
  other to resurface the moment anyone declared it.
- Restored the flow's daemon step only after the collision was gone and the selector was observed
  to resolve. The contract's stop condition forbade adjusting the declaration to make the diagram
  appear, and the order of operations is what kept that honest.

## Deviations From Plan Or Spec

- The plan's verification boundary assumed the contract worktree could run `archctx docs plan`
  directly. It could not: a linked worktree carries no `node_modules` and no `.codegraph` index.
  Both were built as environment setup (`bun install --frozen-lockfile`, `codegraph init .`) before
  any evidence was read. Without the index the selector reports `selector-evidence-missing`, which
  is a different failure from `selector-evidence-unmatched` and would have been easy to misread as
  the fix not working.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Delete the private delegates | Chosen | Removes the collision at its source; two fewer symbols |
| Rename the private delegates | Rejected | Preserves indirection that carries no behaviour; the name can collide again |
| Rename the module-level functions | Rejected | Those are the ones the model declares; renaming churns the declaration |
| Drop the daemon step permanently | Rejected | The daemon trigger is a real architectural fact |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Contract verification: `[ContractVerify] total=8 failed=0 status=Fulfilled`
- P2 proof: `docs/architecture/modules/capability-architecture-context.md` reports
  `Proof: proven (sha256:6b20327d…); selectors 2/2`, and the sequence diagram now carries both the
  operator-run and daemon-measured trigger messages.
- `bun test` in this worktree reports 1225 pass / 0 fail across 148 files, against 1235 across 150
  on `main`. The difference is entirely `_ref/netviz/tests/{line-geometry,snapping}.test.ts` —
  gitignored external reference material that a linked worktree does not carry. Not a regression.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Candidate for `tasks/lessons.md`: a duplicated symbol name silently redirects CodeGraph selector
  evidence to the wrong definition, and the projection reports it as `selector-evidence-unmatched`
  — which reads like a wrong declaration rather than an ambiguous codebase. Hold until a second
  occurrence; one instance is not yet a pattern.
- Candidate for `tasks/lessons.md`: a contract worktree needs `bun install` and `codegraph init`
  before any architecture evidence it produces means anything. Hold until this bites a second time.
