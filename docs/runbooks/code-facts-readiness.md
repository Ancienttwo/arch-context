# Code facts readiness

`archctx doctor --json` reads the CodeGraph version and repository status.
It does not sync or rebuild the index.
The default runtime provider uses the same package-local CodeGraph binary.

`complete`, `prepare` and `projection run` check compatibility before CodeGraph sync.
A read-only `CodeFactsPort.assertCanSync` hook checks them before a runtime session
is stored, even when prepare requests no symbols. The hook is optional for older ports.
Pending source changes alone may use the existing one incremental sync.
The index must remain compatible after that sync. Pending source changes alone
do not cause failure, even if they remain after sync. There is no automatic retry.
A cached snapshot does not bypass this check.
`projection run` checks a present index the same way before its snapshot reads.
An absent index keeps its existing `AC_CODE_FACTS_UNAVAILABLE` contract.
CLI and MCP `checkpoint` check a present index before they read debt.
Pending edits do not block stateless or practice checkpoints.
Without an index, checkpoint keeps its partial ownership and anchor report.
It still lists the checks deferred to complete.

## Reading facts while an index build runs

`codegraph init`, `index` and `sync` hold `.codegraph/codegraph.lock` (the writer's PID) for
the whole build. Readiness does not run `codegraph status` while that lock names a live process:
in CodeGraph 1.6.2 `status` opens the live database read-write, replays crash recovery, and
recreates the secondary indexes and FTS triggers a bulk build deliberately dropped. Those writes
take SQLite write locks and fail the running build with `database is locked`.

While a build holds the lock, `doctor` reports `not-ready` with the `index-incomplete` issue and
`null` index fields (`indexState`, `pendingRefs`, `pendingChanges`, `reindexRecommended`), because a
mid-build reading is a guess. The `--version` probe still runs; it does not open the database.
Wait for the build to finish, then inspect again. A stale lock (its PID is gone) or a malformed
lock does not suppress the probe.

## Public failure contract

An index with a version, project, initialization, index-state, extraction, or worktree issue returns:

- Code: `AC_CODE_FACTS_NOT_READY`.
- Reason: `code-facts-not-ready`.
- Severity: `error`.
- Retryable: `false`.
- Details: `issues`, with the same code/message pairs as `doctor.codeFacts.issues`.

Each issue has exactly `code` and `message`.
The registered messages are fixed. They contain no paths or raw process output.
The details allow at most 32 issues and retain the public 8192-byte budget.
Invalid diagnostics are refused through the existing failure-metadata boundary.

| Action | Operator step |
| --- | --- |
| `codegraph-index` | Run `codegraph index` in the repository with the required CodeGraph version. |
| `install-compatible-codegraph` | Repair the CodeGraph installation to the version shown by `doctor.codeFacts.requiredVersion`. Inspect doctor again before rebuilding. |

No command retries or rebuilds an incompatible index automatically.
Repair an incompatible binary before following a reindex recommendation.
Doctor sets `reindexRecommended: true` for version, extraction, project, worktree,
initialization, or index-state issues. Pending source changes alone remain visible
as freshness issues. They do not make an index unusable by task commands.

The existing `AC_CODE_FACTS_UNAVAILABLE` code still covers a missing index when
code facts are required. A failed status probe uses the same code with reason
`code-facts-unavailable`, action `inspect-diagnostics`, and `retryable: false`.
It does not copy the process error into the public response.

`AC_UNCLASSIFIED_FAILURE` keeps its code, reason, action, and details shape.
Its message now names `archctx doctor --json` as the inspection command.
