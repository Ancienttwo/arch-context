# AL6 CLI and Fixture Closeout Verification

Date: 2026-06-26

## Scope

This closes AL6-15 and AL6-16 for the architecture ledger sprint.

Implemented behavior:

- `archctx investigate` enqueues a bounded runtime agent job through the local runtime daemon.
- `archctx agents status` reads queue stats and active job records without creating work.
- `archctx agents budget` exposes the effective safe defaults for spawn and queue limits.
- Fake-provider fixtures cover malformed output and hallucinated target IDs.
- Runtime duplicate completion is rejected before terminal job output can be replaced.
- Existing stale completion, timeout fallback and provider metadata behavior remain covered.

Out of scope:

- AL7 Book retrieval commands.
- AL8 automatic investigation scheduling and recommendation feedback.
- Ledger-authoritative promotion.

## Architecture Boundary

CLI owns argument parsing and JSON envelope shape only.

`archctx investigate` maps CLI flags to `RuntimeAgentJobEnqueueGitInput` and delegates to `RuntimeDaemonClient.jobsEnqueueGitHook`. The daemon still owns Git cursor capture, bounded investigation context construction, queue policy, stale cancellation and persistence.

`archctx agents status` and `archctx agents budget` are read surfaces over `jobs.stats` and `jobs.list`. They do not claim, complete, retry or mutate jobs.

`@archcontext/core/agent-orchestrator` remains the provider-neutral domain boundary. Fake, Claude and Codex runners all pass through `InvestigationRunnerPort` and `runInvestigationThroughPort` validation.

`@archcontext/local-runtime/local-store-sqlite` and the daemon now preserve the queue invariant that only `running` jobs can be completed.

## Concrete Trace

CLI enqueue path:

```text
archctx investigate --runner-port claude --source staged
  -> runInvestigateCommand
  -> readCliGitChangeSource + readAgentRunnerPort
  -> RuntimeAgentJobEnqueueGitInput
  -> RuntimeDaemonClient.jobsEnqueueGitHook
  -> runtime queue record or fail-open daemon envelope
```

Status path:

```text
archctx agents status --status queued,running
  -> runAgentsCommand
  -> jobsStats + jobsList
  -> archcontext.agent-status/v1 envelope
```

Duplicate completion path:

```text
jobs.claim
  -> job status running
jobs.complete succeeded
  -> terminal job with outputDigest
jobs.complete succeeded again
  -> AC_PRECONDITION_FAILED at daemon boundary
  -> store-level runtime-agent-job-complete-requires-running guard
  -> original outputDigest remains unchanged
```

Fake-provider invalid output path:

```text
createFakeInvestigationRunner.reportFactory
  -> malformed object or hallucinated target ID
  -> runInvestigationThroughPort
  -> validateInvestigationReport
  -> investigation-report-invalid with stable reason code
```

## Design Rationale

The CLI commands intentionally stay thin. The daemon already owns the runtime queue and has the correct repository/worktree identity, CodeGraph digest, context-bundle and stale-cursor checks. Reimplementing any of that in the CLI would create a second control plane.

The duplicate completion guard belongs in both daemon and store layers. The daemon returns the stable JSON error code for callers; the store protects the persistence invariant even if a future caller bypasses the daemon method.

At 10x job volume, the first pressure point is operator visibility and queue/budget readback, not more runner logic. AL6 now has enough CLI surface to inspect and explicitly enqueue jobs; AL8 can later decide when automatic scheduling is allowed.

## Verification

Passed:

```bash
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000
bun test packages/surfaces/cli/test/cli.test.ts --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 90000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
bun test --timeout 90000
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al6-cli-fixtures-verify-state-XXXXXX) bun run verify
```

Readback:

- Focused tests passed: core 15, CLI 29, runtime daemon 43, SQLite store 28.
- Full test suite passed: 775 tests, 0 failures.
- Root verify passed, including packaged CLI smoke, privacy/readback gates, acceptance ledgers, sprint-status check and representative eval.
