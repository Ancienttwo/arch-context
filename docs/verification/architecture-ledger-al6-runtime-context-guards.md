# Architecture Ledger AL6 Runtime Context Guards Verification

Date: 2026-06-26

## Scope

This artifact covers AL6-05 and AL6-06: runtime queue guard planning, daemon enqueue integration, one-running-job claim default, stale HEAD/worktree cancellation metadata, and bounded investigation context assembly from ledger query results.

It does not cover typed investigation output schema validation, unknown entity or evidence-reference rejection, prompt-injection tests, concrete Claude/Codex adapters, timeout/retry fallback, or CLI commands. Those remain AL6-07 and later.

## Verified Changes

- `packages/core/agent-orchestrator/src/index.ts`
  - Added `buildInvestigationContextBundleFromLedgerQuery`.
  - The builder sorts and slices ledger entity, relation, constraint, evidence binding and candidate change refs with a bounded `maxItems` limit.
  - Evidence bindings and candidate changes cross into the runner context by IDs, not source text.
  - `investigationContextBundle` rejects raw repository payload keys and raw diff markers before returning a persistable context bundle.
  - Added `planRuntimeAgentQueueControls` with cooldown debounce, coalescing, queue cap, priority, one-running-job claim policy and stale HEAD/worktree cancellation metadata.
- `packages/local-runtime/runtime-daemon/src/index.ts`
  - `jobsEnqueueGitHook` now skips clean worktrees without queueing an agent job.
  - Git hook enqueue now builds `AgentJob/v1` through `createInvestigationAgentJob` instead of duplicating job construction inside the daemon.
  - Queued jobs persist `investigationContext` and `queuePlanDigest` under job extensions.
  - Context extensions include Git path metadata, code facts digest and analysis kind, but no source body or diff body.
  - `jobsClaim` keeps the daemon default of one running runtime-agent job per repository and passes that into the SQLite claim path.
- `packages/local-runtime/local-store-sqlite/src/index.ts`
  - The claim transaction counts currently running jobs for the repository and returns no job when the configured running-depth limit is reached.

## Acceptance Mapping

| Sprint item | Evidence |
|---|---|
| AL6-05 | `planRuntimeAgentQueueControls` defines cooldown, coalescing, queue cap, priority and stale cancellation metadata; daemon enqueue applies the plan; `jobsClaim` defaults to one running job per repository and SQLite enforces it transactionally. |
| AL6-06 | `buildInvestigationContextBundleFromLedgerQuery` builds bounded context from ledger refs and evidence/candidate IDs; raw source, diff, prompt and completion payloads are rejected before context persistence. |

## Verified Runtime Path

```text
Git worktree change
  -> ArchctxDaemon.jobsEnqueueGitHook
  -> git metadata digest + ledger state digest
  -> buildInvestigationContextBundleFromLedgerQuery
  -> createInvestigationAgentJob
  -> planRuntimeAgentQueueControls
  -> localStore.enqueueRuntimeAgentJob
  -> ArchctxDaemon.jobsClaim
  -> localStore.claimRuntimeAgentJob transaction with maxRunningJobs = 1
```

The side effect is a single queued or claimed `AgentJob/v1` with bounded context and stable digests. The job remains advisory and cannot directly mutate ledger, YAML or docs.

## Verification Commands

```bash
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000
bun test --timeout 90000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
```

All commands passed locally on 2026-06-26.
