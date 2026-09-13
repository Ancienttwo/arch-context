> **Archived**: 2026-09-10 20:36
> **Related Plan**: plans/archive/plan-20260910-2016-release-closeout-0-5-10.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260910-2036
> **Archive Projection V1**: `plans/plan-20260910-2016-release-closeout-0-5-10.md` => `plans/archive/plan-20260910-2016-release-closeout-0-5-10.md`
> **Archive Projection V1**: `tasks/notes/20260910-2016-release-closeout-0-5-10.notes.md` => `tasks/archive/notes-20260910-2036-release-closeout-0-5-10.md`
> **Archive Projection V1**: `tasks/contracts/20260910-2016-release-closeout-0-5-10.contract.md` => `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md`
> **Archive Projection V1**: `tasks/reviews/20260910-2016-release-closeout-0-5-10.review.md` => `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md`

# Release closeout decisions

> **Plan**: plans/archive/plan-20260910-2016-release-closeout-0-5-10.md
> **Contract**: tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md

One injected daemon per case preserves the CLI-to-runtime path while removing repeated SQLite startup. Projection still uses a real Git HEAD and worktree digest; docs lockfile semantics require only a real initialized model directory. No timeout or behavior assertion changes.

Windows CI 34467186132 is the actual failure evidence. The local before/after runs both preserve 26 assertions; timing samples only establish reduced local work, not a Windows timing guarantee. Exact-head Required CI remains mandatory.

The official schema migration receipt binds published dc4fcc3d and retains all task IDs. Seven completing leases were removed only after canonical main reported [x]. The two deferred publication rows retain their original statuses and text.

## Publication record closeout

> **Substantive Change SHA256**: `sha256:4e7185c29306c3becc7d63f978fc03b370539987694c84877633b243186d4b48`

CI 34476248680 passed all ten jobs for source candidate d11624db. Final semantic acceptance uses the owner-authorized user waiver and the passing prepared verification. The subsequent closeout only archives workflow files, refreshes the derived current-status file, and records these actual results; the CLI fixture and migrated sprint bytes are unchanged. Required CI still applies to the resulting documentation commit before merge.
