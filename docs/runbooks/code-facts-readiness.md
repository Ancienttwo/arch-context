# Code facts readiness

`archctx doctor --json` reads the loaded CodeGraph bundle version and the index through
an in-process read-only session ([ADR-0058](../adr/ADR-0058-codegraph-reads-in-process-read-only.md)).
It does not start a CodeGraph process, sync or rebuild the index. The same pinned
package supplies the SDK reader and the CLI used for index builds.

`complete`, `prepare` and `projection run` check compatibility before CodeGraph sync.
A read-only `CodeFactsPort.assertCanSync` hook checks them before a runtime session
is stored, even when prepare requests no symbols.
Pending source changes alone may use the existing one incremental sync.
The index must remain compatible after that sync. Projection reads also require fresh
code facts and check freshness again after reading; changes during the read fail closed.
There is no automatic retry. Each operation opens and closes its own read-only session;
there is no cached index snapshot.
`projection run` reads compatibility and code facts through these sessions.
An absent index keeps its existing `AC_CODE_FACTS_UNAVAILABLE` contract.
CLI and MCP `checkpoint` check a present index before they read debt.
Pending edits do not block stateless or practice checkpoints.
Without an index, checkpoint keeps its partial ownership and anchor report.
It still lists the checks deferred to complete.

## Reading facts while an index build runs

`codegraph init`, `index` and `sync` hold `.codegraph/codegraph.lock` (the writer's PID) for
the whole build. Readiness does not open the index while that lock names a live process.
Once the lock is released, the session opens it read-only, without migrations, repair
or WAL maintenance. The permitted provider side effects are SQLite WAL/SHM sidecar
creation and rewriting `.codegraph/.gitignore` when missing or different (ADR-0058 Decision 4).

While a build holds the lock, `doctor` reports `not-ready` with the `index-incomplete` issue and
`null` index fields (`indexState`, `pendingRefs`, `pendingChanges`, `reindexRecommended`), because a
mid-build reading is a guess. The loaded bundle manifest still supplies the provider version
without opening the database or spawning a version command. Wait for the build to finish,
then inspect again. A stale lock (its PID is gone) or a malformed lock does not suppress
the read-only inspection.

## Public failure contract

An index with a version, project-path, index-state or extraction issue returns:

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
Doctor sets `reindexRecommended: true` for version, extraction, project-path or
index-state issues. Pending source changes alone remain visible as freshness issues.
They do not block a pre-sync compatibility check. A live build or an index revision
that changes during the read is retryable, unless the loaded provider also has the wrong
version; its index fields remain unknown.

The existing `AC_CODE_FACTS_UNAVAILABLE` code still covers a missing index when
code facts are required. Failure to load the provider uses the same code with reason
`code-facts-unavailable`; failure to open or read the index uses `index-open-failed`.
The doctor's internal readiness diagnostic for a provider load failure is
`codegraph-unavailable`; consumers of CLI/MCP failure envelopes match the public reason above.
Both use action `inspect-diagnostics` and `retryable: false`. Raw provider errors are
not copied into the public response.

`AC_UNCLASSIFIED_FAILURE` keeps its code, reason, action, and details shape.
Its message now names `archctx doctor --json` as the inspection command.
