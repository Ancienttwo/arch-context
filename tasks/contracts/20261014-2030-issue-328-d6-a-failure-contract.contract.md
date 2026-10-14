# Task Contract: issue-328-d6-a-failure-contract

> **Status**: Active
> **Plan**: plans/plan-20261014-2030-issue-328-d6-a-failure-contract.md
> **Task Profile**: code-change
> **Owner**: D6-A sole implementation writer, delegated Codex thread
> **Capability ID**: capability-architecture-context
> **Review File**: tasks/reviews/20261014-2030-issue-328-d6-a-failure-contract.review.md
> **Notes File**: tasks/notes/20261014-2030-issue-328-d6-a-failure-contract.notes.md

## Goal and Scope

Implement only the selected failure contract frozen by the coordinator in the plan. W1/W2/W6
and the producer/reason allowlist in that plan are authoritative. Preserve success values,
report/digest/coverage, complete negative judgments, hook fail-open and writer/read semantics.
No RPC wire, D7, upgrade, projection/state, scanner or D5 edits. This slice does not close D6/#328.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20261014-2030-issue-328-d6-a-failure-contract.md
  - tasks/contracts/20261014-2030-issue-328-d6-a-failure-contract.contract.md
  - tasks/notes/20261014-2030-issue-328-d6-a-failure-contract.notes.md
  - tasks/reviews/20261014-2030-issue-328-d6-a-failure-contract.review.md
  - packages/contracts/src/schema.ts
  - packages/contracts/src/failure.ts
  - packages/contracts/src/index.ts
  - packages/local-runtime/runtime-daemon/src/architecture-debt.ts
  - packages/local-runtime/runtime-daemon/src/practice-checkpoint.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/mcp-local/src/index.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/contracts/test/contracts.test.ts
  - packages/local-runtime/runtime-daemon/test/complete-architecture-debt.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/test/failure-envelope.test.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/cli/test/architecture-debt.test.ts
  - packages/surfaces/mcp-local/test/mcp-local.test.ts
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "d6-a-focused",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify selected failures, byte budgets, privacy and success/read-write parity through real producers and adapters.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun run typecheck && node scripts/package-boundary-audit.mjs && bun test --timeout 180000 packages/contracts/test/failure-envelope.test.ts packages/contracts/test/contracts.test.ts packages/local-runtime/runtime-daemon/test/complete-architecture-debt.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/failure-envelope.test.ts packages/surfaces/cli/test/architecture-debt.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts packages/local-runtime/runtime-daemon/test/architecture-debt-read-inputs.test.ts packages/surfaces/mcp-local/test/mcp-wire.test.ts packages/surfaces/mcp-local/test/client-boundary.test.ts"
    },
    {
      "id": "d6-a-cli-compat",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Retain successful CLI integration and runtime-free preflight while replacing obsolete raw-message echo assertions with strict refusal metadata and exact empty details.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun test --timeout 60000 packages/surfaces/cli/test/cli.test.ts --test-name-pattern 'CLI delegates init and context to the runtime|one argument check runs before every handler'"
    },
    {
      "id": "d6-a-packaged",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Exercise the installed/bundled CLI entry after the selected public error contract change.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "node scripts/packaged-cli-smoke.mjs"
    },
    {
      "id": "d6-a-governance",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Run final governance without weakening budgets; hosted Verify matrix remains separate acceptance evidence.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun run verify:governance"
    }
  ]
}
```

## Acceptance and Stop Conditions

All selected failure branches must satisfy tested code/action/reason/details, byte budgets and
privacy while preserving success/authority. No guessed causes, retries, scope expansion or
silently discarded recovery binding. Stop on another writer or a necessary excluded-file edit.
New-HEAD hosted matrix and coordinator independent acceptance are separate; no self-merge.

## Rollback

Revert this failure-composition/metadata/test slice only; no model/DB/schema data migration.
