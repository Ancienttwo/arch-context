# Runtime Hook Queue Runbook

> Status: AL4 operational runbook
> Sprint: `plans/sprints/archctx-architecture-ledger-sprint-checklist.md`

This runbook covers the bounded local hook queue used by `archctx hook enqueue`.
The queue is operational runtime state. Ledger writes still belong to ChangeSet
or daemon-owned append paths.

## Queue Policy

- Hook enqueue is fail-open and local-only by default. It must not call network
  providers or LLMs.
- `archctx hook enqueue` passes `--max-queued-jobs` and `--priority` to the
  daemon. If omitted, the daemon uses a bounded hook queue cap of 32 and
  priority 0.
- Queue cap is enforced in `SqliteLocalStore.enqueueRuntimeAgentJob`. A new low
  priority job cannot evict higher-priority queued work. If there is no safe
  queued job to evict, the enqueue is rejected with
  `reasonCode: backpressure-queue-cap`.
- Worker concurrency is enforced by `jobsClaim`. The default per-repository
  running concurrency is 1, excluding expired leases.
- Stale queued or running jobs are expired before newer git-hook work is
  enqueued when their head or worktree digest no longer matches the current
  cursor.

## Shell Compatibility

- Hook wrappers must be POSIX `sh` compatible. Do not use Bash arrays, process
  substitution, `[[ ... ]]`, or shell-specific `source`.
- Treat `archctx hook enqueue` as best effort. Do not let an ArchContext runtime
  outage block the user's original hook.
- Pass changed paths with repeated `--path` flags when the host provides them.
- Keep stdout/stderr short. The hook output envelope already redacts raw paths
  into `changedPathDigest` and does not store source or diff bodies.

## Hook Chaining

When another tool already owns `.git/hooks/post-commit`, preserve it and add
ArchContext as a first step:

```sh
#!/bin/sh
set +e

archctx hook enqueue --event post-commit --source commit --max-queued-jobs 32 --priority 0 >/dev/null 2>&1

if [ -x ".git/hooks/post-commit.local" ]; then
  ".git/hooks/post-commit.local" "$@"
  exit $?
fi

exit 0
```

Use the same pattern for `pre-commit`, changing only the event/source pair:

```sh
archctx hook enqueue --event pre-commit --source staged >/dev/null 2>&1
```

For central hook hosts, do not write repo-local hooks from ArchContext. Use the
adapter contract and keep the existing host owner as the installer:

```bash
archctx hooks status --host codex --format json
archctx hooks doctor --host codex --format json
```

## Recovery

If another tool overwrites the hook:

1. Move the overwritten script to `.git/hooks/<hook>.local` if it is still
   available from shell history, backup, or the owning tool.
2. Reinstall the small POSIX wrapper above.
3. Verify the central adapter contract:

```bash
archctx hooks doctor --host codex --format json
```

If the runtime daemon is unavailable, the hook should still return success with
`schemaVersion: archcontext.hook-enqueue-fail-open/v1`:

```bash
archctx hook enqueue --event post-edit --path src/app.ts --format json
```

If the queue is saturated, inspect local state before retrying:

```bash
archctx jobs stats --format json
archctx jobs list --status queued,running,expired --format json
```

If stale jobs are present after branch switches, cancel them explicitly:

```bash
archctx jobs cancel <job-id> --status expired --reason stale-branch-switch
```

## Verification

Minimum AL4 checks:

```bash
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
bun test packages/surfaces/cli/test/cli.test.ts
```

Expected evidence:

- Hook enqueue envelopes contain `egress: none` and `network: forbidden`.
- `jobs stats` reports queue depth, running depth, coalesced job count, and the
  last local failure reason.
- The 100-change stress fixture leaves one active queued job and records all
  superseded jobs as terminal queue rows.
