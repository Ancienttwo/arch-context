# Architecture Ledger AL6 Orchestrator Foundation Verification

Date: 2026-06-26

## Scope

This artifact covers AL6-01 through AL6-04: provider-neutral investigation runner contract, core job state machine, spawn budgets, and safe default spawn policy.

It does not cover provider adapters, context bundle assembly from live ledger queries, output entity/evidence validation, timeout/retry fallback, CLI commands, or stale HEAD cancellation. Those remain AL6-05 and later.

## Verified Changes

- `packages/contracts/src/ports.ts`
  - Added `InvestigationRunnerPort`, `InvestigationRunnerInput`, and `InvestigationContextBundle`.
  - The port is provider-neutral: it names a generic runner capability surface and does not call Claude or Codex APIs.
  - Runner capabilities require `canMutateRepository: false`.
- `packages/contracts/src/ledger.ts` and `schemas/runtime/agent-job.schema.json`
  - Extended `AgentJob/v1.budget` with optional `maxRunsPerDay`.
  - Kept `directMutationAllowed` pinned to `false`.
- `packages/core/agent-orchestrator/src/index.ts`
  - Added `DEFAULT_AGENT_ORCHESTRATION_POLICY` with `maxRunsPerTask: 1`, `maxAutomaticRunsForLowRisk: 0`, and `adapterEnabled: false`.
  - Added `evaluateInvestigationSpawn` with deterministic analysis, risk, uncertainty, equivalent-job, task budget, repository daily budget, total daily budget, cooldown, and adapter-enabled gates.
  - Added `AGENT_JOB_STATE_TRANSITIONS`, `canTransitionAgentJobStatus`, and `transitionAgentJobStatus`.
  - Added `createInvestigationAgentJob`, `investigationContextBundle`, and `runInvestigationThroughPort`.
- `packages/core/agent-orchestrator/test/agent-orchestrator.test.ts`
  - Covers low-risk automatic zero-spawn default.
  - Covers default one-spawn-per-task budget rejection.
  - Covers repository and total daily budget rejection.
  - Covers equivalent active/completed job deduplication.
  - Covers queued/running/succeeded state transitions and impossible terminal transitions.
  - Covers provider-neutral fake runner execution and direct-mutation report rejection.

## Acceptance Mapping

| Sprint item | Evidence |
|---|---|
| AL6-01 | `InvestigationRunnerPort` accepts a generic runner and bounded context bundle; no Claude/Codex-specific execution path is required. |
| AL6-02 | `AGENT_JOB_STATE_TRANSITIONS` models queued, running, succeeded, failed, cancelled, superseded, and expired transitions. |
| AL6-03 | `evaluateInvestigationSpawn` enforces per-task, per-repository-per-day, and total daily budgets before job creation. |
| AL6-04 | `DEFAULT_AGENT_ORCHESTRATION_POLICY` caps task spawns at one and denies automatic low-risk spawns. |
| AL6-EG1 | Low-risk automatic spawn test returns no job eligibility. |
| AL6-EG2 | Task budget test rejects a second default spawn. |
| AL6-EG3 | Job/report contracts and runner port reject direct mutation. |
| AL6-EG5 | Fake runner test proves domain behavior does not require a concrete provider adapter. |

## Verification Commands

```bash
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000
bun test packages/contracts/test/contracts.test.ts --timeout 90000
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts packages/contracts/test/contracts.test.ts --timeout 90000
bun run typecheck
node scripts/package-boundary-audit.mjs
```

All commands passed locally on 2026-06-26.
