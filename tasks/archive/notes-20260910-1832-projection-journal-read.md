> **Archived**: 2026-09-10 18:32
> **Related Plan**: plans/archive/plan-20260910-1639-projection-journal-read.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260910-1832
> **Archive Projection V1**: `plans/plan-20260910-1639-projection-journal-read.md` => `plans/archive/plan-20260910-1639-projection-journal-read.md`
> **Archive Projection V1**: `tasks/notes/20260910-1639-projection-journal-read.notes.md` => `tasks/archive/notes-20260910-1832-projection-journal-read.md`
> **Archive Projection V1**: `tasks/contracts/20260910-1639-projection-journal-read.contract.md` => `tasks/archive/contract-20260910-1832-projection-journal-read.md`
> **Archive Projection V1**: `tasks/reviews/20260910-1639-projection-journal-read.review.md` => `tasks/archive/review-20260910-1832-projection-journal-read.md`

# projection-journal-read decisions

The fix removes journal-read session initialization instead of broadening digest ignores, which preserves generic source identity semantics and all write guards. Durable evidence and consumer boundary are recorded in docs/researches/20260910-projection-journal-read.md. No public release is authorized.
