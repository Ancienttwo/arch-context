# Code facts readiness

`archctx doctor --json` reads the CodeGraph version and repository status.
It does not sync or rebuild the index.
The default runtime provider uses the same package-local CodeGraph binary.

`complete` and `prepare` check compatibility before CodeGraph sync.
A read-only `CodeFactsPort.assertCanSync` hook checks them before a runtime session
is stored, even when prepare requests no symbols. The hook is optional for older ports.
Pending source changes alone may use the existing one incremental sync.
The index must be ready after that sync. There is no retry when it remains not-ready.
A cached snapshot does not bypass this check.
CLI and MCP `checkpoint` check a present index before they read debt.
Without an index, checkpoint keeps its partial ownership and anchor report.
It still lists the checks deferred to complete.

## Public failure contract

A present index in state `not-ready` returns:

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
| `codegraph-sync` | Run `codegraph sync` in the repository for pending source changes. |
| `install-compatible-codegraph` | Repair the CodeGraph installation to the version shown by `doctor.codeFacts.requiredVersion`. Inspect doctor again before rebuilding. |

No command retries or rebuilds an incompatible index automatically.
Repair an incompatible binary before following a reindex recommendation.
Doctor sets `reindexRecommended: true` for version, extraction, project, worktree,
initialization, or index-state issues. Pending source changes alone need sync.

The existing `AC_CODE_FACTS_UNAVAILABLE` code still covers a missing index when
code facts are required. A failed status probe uses the same code with reason
`code-facts-unavailable`, action `inspect-diagnostics`, and `retryable: false`.
It does not copy the process error into the public response.

`AC_UNCLASSIFIED_FAILURE` keeps its code, reason, action, and details shape.
Its message now names `archctx doctor --json` as the inspection command.
