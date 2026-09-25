# Developer Review run lifecycle extraction — issue #164

Baseline: `39e9dff81bb3d2edfb52ef902e922b737434d446` (#208 merged).

## P1 — ownership

The daemon facade previously owned both temporary review worktree lifecycle and review/signing computation. The lifecycle has a narrower dependency set: a running-state guard, the daemon clock, Git worktree operations, daemon-owned state paths and strict manifest decoding. `developer-review-run.ts` now owns that lifecycle, its DTOs, lock and ownership helpers. The facade composes one service with the existing guard and clock, delegates the six public lifecycle methods, and re-exports their types. RPC wire contracts remain unchanged.

## P2 — trace

`startDeveloperReviewRun` checks daemon state, resolves the repository, creates a marked temporary root, claims the exclusive lock and writes the preparing manifest before preparing the detached Git worktree. A successful run records its ownership metadata; failure invokes the same guarded cleanup. Cleanup still re-derives and validates every deletion target against the persisted manifest, lock and run owner marker. Recovery scans only the daemon-owned state directory and retains active PIDs unless forced.

The six method implementations, lifecycle helpers and DTOs moved verbatim. Nine existing tests moved verbatim into `developer-review-run.test.ts`; shared repository/path fixtures moved into the existing fixture module. RPC start/sign/cleanup/recovery and signing tests remain external integration coverage through the public daemon facade. The codec imports the moved DTOs as types only.

## P3 — constraints

No ChangeSet, SQLite or signer ownership changes. The service receives the existing guard and clock; it creates no additional store or process authority. State paths, JSON formats, error strings, cleanup ordering, PID checks and filesystem modes remain unchanged. The self-model component and relations were updated through daemon ChangeSet. Review digest computation, review-session persistence and signing remain in the facade for a later slice; #164 remains open.

At 10x concurrent runs, Git subprocesses and filesystem work remain the cost. This move adds no queue, cache or parallel work and makes no throughput claim.

## Verification

Typecheck and all nine moved tests pass (116 assertions). A text comparison against the pinned baseline proves all six implementations, lifecycle helpers, DTOs and test bodies are unchanged. Runtime import comparison confirms the same 34 public exports. Full `bun run verify` on the pinned baseline passes with 2009 tests and zero failures, including all configured gates. The self-model validates with no errors.
