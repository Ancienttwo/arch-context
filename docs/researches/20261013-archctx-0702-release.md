# archctx / archctx-contracts 0.7.2

## Changes

Runtime:

- #318, #319: a CLI health check that timed out removed the connection file of a live, busy daemon. The daemon kept the store and the daemon lock, no client could reach it, and every later CLI call failed with `childExit=75`. A health timeout with a live pid now keeps the connection file. The CLI fails at once with the pid and a stop command (`kill -TERM <pid>`, or `taskkill /PID <pid>` on Windows). A refused connection or a bad health response still removes the file.
- #319: `archctx daemon status` reports `running: true, responding: false, pid` for a busy daemon. With no connection file, it reports `lockOwnerPid` when the daemon lock names a live process. A failed `daemon start` names that pid and the stop command.
- #319: the investigation transport ignores a broken stdin pipe (`EPIPE`) when the child exits before it reads all of stdin. Before, the error was unhandled and could stop the daemon. The exit of the child still classifies the run.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together, at the same version.

The contract schemas do not change. The new `daemon status` fields (`responding`, `pid`, `action`, `lockOwnerPid`) are optional, and no published schema covers that output.

A CLI command that meets a busy daemon now fails with `AC_RUNTIME_UNAVAILABLE` after the 5 s health timeout. Before, it removed the connection file and waited for a new daemon start that could not succeed. A wrapper that retries on that error code keeps working.

The committed projection format does not change. CodeGraph remains pinned to `@colbymchenry/codegraph` 1.6.1. The pinned Bun toolchain is 1.4.3.

## Verification

Filled in from the release-prep run.
