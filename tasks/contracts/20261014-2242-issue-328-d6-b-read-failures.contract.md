# Task Contract: issue-328-d6-b-read-failures

> **Status**: Active
> **Plan**: plans/plan-20261014-2242-issue-328-d6-b-read-failures.md
> **Task Profile**: code-change
> **Owner**: D6-B sole implementation writer, delegated Codex thread
> **Capability ID**: capability-architecture-context
> **Review File**: tasks/reviews/20261014-2242-issue-328-d6-b-read-failures.review.md
> **Notes File**: tasks/notes/20261014-2242-issue-328-d6-b-read-failures.notes.md

## Goal and Scope

Implement only docs anchors and flows check direct/CLI failure exits from frozen 550ae58b.
The plan's frozen failure/compatibility table and delivery boundary are authoritative. This is
local preparation while #356 finishes CI, not a stacked or duplicate delivery of A. Preserve all
success/value APIs, D5 discovery and existing CodeGraph behavior; do not edit A's checkout.
Coordinator-directed amendment: use one anchors entrypoint/adapter for standalone and debt calls.
Unknown nested anchors failures may use actual producer stage docs-anchors as an expected B change.
Preserve known code/action/reason/retryability, success reports/digests/coverage and discovery;
close once and never replace the primary producer refusal with cleanup failure. No debt-only
legacy branch, new error family or global writer legacy edit.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20261014-2242-issue-328-d6-b-read-failures.md
  - tasks/contracts/20261014-2242-issue-328-d6-b-read-failures.contract.md
  - tasks/notes/20261014-2242-issue-328-d6-b-read-failures.notes.md
  - tasks/reviews/20261014-2242-issue-328-d6-b-read-failures.review.md
  - packages/contracts/src/failure.ts
  - packages/local-runtime/runtime-daemon/src/producer-failure.ts
  - packages/local-runtime/runtime-daemon/src/architecture-debt.ts
  - packages/local-runtime/runtime-daemon/src/docs-anchors.ts
  - packages/local-runtime/runtime-daemon/src/flow-selector-check.ts
  - packages/surfaces/cli/src/main.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/local-runtime/runtime-daemon/test/read-failure-boundaries.test.ts
  - packages/surfaces/cli/test/docs-anchors.test.ts
  - packages/surfaces/cli/test/failure-envelope.test.ts
  - packages/surfaces/cli/test/cli.test.ts
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "d6-b-affected",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify two stateless reader failure boundaries, existing strict metadata/privacy, D5 discovery and A producer compatibility.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun run typecheck && node scripts/package-boundary-audit.mjs && bun test --timeout 180000 packages/contracts/test/failure-envelope.test.ts packages/local-runtime/runtime-daemon/test/read-failure-boundaries.test.ts packages/local-runtime/runtime-daemon/test/architecture-debt-read-inputs.test.ts packages/local-runtime/runtime-daemon/test/complete-architecture-debt.test.ts packages/surfaces/cli/test/docs-anchors.test.ts packages/surfaces/cli/test/architecture-debt.test.ts packages/surfaces/cli/test/failure-envelope.test.ts"
    },
    {
      "id": "d6-b-flow-success",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Preserve real CodeGraph flow report/proof, process parity and no runtime state, alongside existing CLI integration/preflight.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun test --timeout 180000 packages/surfaces/cli/test/cli.test.ts --test-name-pattern 'CLI flows check reports each selector proof status|CLI delegates init and context to the runtime|one argument check runs before every handler'"
    },
    {
      "id": "d6-b-packaged",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify the bundled Node CLI still builds and preserves byte-bound output.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "node scripts/packaged-cli-smoke.mjs"
    }
  ]
}
```

## Acceptance and Stop Conditions

Strict known/unknown/mutated metadata and cleanup failures must pass direct and selected CLI
regressions without secret output. Preserve success/coverage/probe/reader-close semantics.
Stop on an A repair, competing writer or required excluded-file edit. No push/PR until A merges
and the coordinator freezes the accepted-main integration route. B does not complete D6/#328.

## Rollback

Revert only the B stages/adapter extraction/two reader/CLI/test slice. No state or model migration.
