# Task Contract: #328 D6-C1 public failures

> **Status**: Active
> **Task Profile**: code-change
> **Plan**: plans/plan-20261015-0054-issue-328-d6-c1-public-failures.md
> **Owner**: delegated Codex C1 sole writer
> **Capability ID**: capability-architecture-context
> **Review File**: tasks/reviews/20261015-0054-issue-328-d6-c1-public-failures.review.md
> **Notes File**: tasks/notes/20261015-0054-issue-328-d6-c1-public-failures.notes.md

## Goal and Scope

The coordinator authorized C1 freeze, implementation, affected checks, independent review, normal
push and Draft PR from current main 31bbc3bbd5714a84776ec1c419c44e2d5db79603, without unmerged B. Exact
59-boundary/24-source inventory and per-reason facts: tasks/notes/20261015-0054-issue-328-d6-c1-public-failures.scope.json. Existing code/action authority
and success side effects are fixed. Ten explicit C2 recovery escape exceptions and six lifecycle
symbols are held; do not implement their normalization.

## Allowed Paths

```yaml
allowed_paths:
  - packages/contracts/src/failure.ts
  - packages/contracts/src/native-context.ts
  - packages/core/practice-catalog/src/index.ts
  - packages/local-runtime/model-store-yaml/src/native-context.ts
  - packages/local-runtime/runtime-daemon/src/capability-dependencies.ts
  - packages/local-runtime/runtime-daemon/src/projection-service.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/src/practice-checkpoint.ts
  - packages/local-runtime/runtime-daemon/src/external-documentation.ts
  - packages/local-runtime/runtime-daemon/src/landscape.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection-service.ts
  - packages/local-runtime/runtime-daemon/src/explorer-server.ts
  - packages/local-runtime/runtime-daemon/src/changeset-authority.ts
  - packages/local-runtime/runtime-daemon/src/ledger-admin.ts
  - packages/local-runtime/runtime-daemon/src/architecture-book.ts
  - packages/local-runtime/runtime-daemon/src/recommendations.ts
  - packages/local-runtime/runtime-daemon/src/refactor-scan.ts
  - packages/local-runtime/runtime-daemon/src/refactor-decisions.ts
  - packages/local-runtime/runtime-daemon/src/agent-jobs.ts
  - packages/local-runtime/runtime-daemon/src/audit.ts
  - packages/local-runtime/runtime-daemon/src/audit-consent.ts
  - packages/local-runtime/runtime-daemon/src/public-operation-failure.ts
  - packages/surfaces/cli/src/native-context.ts
  - packages/surfaces/cli/src/hook-fast.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/contracts/test/native-context.test.ts
  - packages/contracts/test/public-operation-failures.test.ts
  - packages/local-runtime/runtime-daemon/test/public-operation-failures.test.ts
  - packages/local-runtime/runtime-daemon/test/ownership-read-surfaces.test.ts
  - packages/local-runtime/runtime-daemon/test/undeclared-dependencies.test.ts
  - packages/local-runtime/runtime-daemon/test/projection-freshness-scope.test.ts
  - packages/local-runtime/runtime-daemon/test/landscape.test.ts
  - packages/local-runtime/runtime-daemon/test/external-documentation.test.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/explorer-server.test.ts
  - packages/local-runtime/runtime-daemon/test/explorer-session.test.ts
  - packages/local-runtime/runtime-daemon/test/ledger-admin.test.ts
  - packages/local-runtime/runtime-daemon/test/accepted-committed-change.test.ts
  - packages/local-runtime/runtime-daemon/test/agent-jobs.test.ts
  - packages/local-runtime/runtime-daemon/test/audit.test.ts
  - packages/local-runtime/runtime-daemon/test/recommendations.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-scan-import-limit.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-decisions.test.ts
  - packages/local-runtime/model-store-yaml/test/native-context.test.ts
  - packages/local-runtime/git-adapter/test/blob-reader.test.ts
  - packages/surfaces/cli/test/failure-envelope.test.ts
  - packages/surfaces/cli/test/native-context.test.ts
  - packages/surfaces/cli/test/public-operation-failures.test.ts
  - packages/surfaces/cli/test/hook-helper-parity.test.ts
  - packages/surfaces/cli/test/hook-state-paths.test.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/core/practice-catalog/test/practice-catalog.test.ts
  - plans/plan-20261015-0054-issue-328-d6-c1-public-failures.md
  - tasks/contracts/20261015-0054-issue-328-d6-c1-public-failures.contract.md
  - tasks/notes/20261015-0054-issue-328-d6-c1-public-failures.notes.md
  - tasks/reviews/20261015-0054-issue-328-d6-c1-public-failures.review.md
  - tasks/notes/20261015-0054-issue-328-d6-c1-public-failures.scope.json
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "c1-type-boundary",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify selected operation adapters keep contracts and package direction.",
      "command": "bun run typecheck && node scripts/package-boundary-audit.mjs",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      }
    },
    {
      "id": "c1-affected",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Selected local operation, native, state, privacy, binding and lifecycle regressions.",
      "command": "bun test --timeout 180000 packages/contracts/test/failure-envelope.test.ts packages/contracts/test/native-context.test.ts packages/contracts/test/public-operation-failures.test.ts packages/local-runtime/runtime-daemon/test/public-operation-failures.test.ts packages/local-runtime/runtime-daemon/test/ownership-read-surfaces.test.ts packages/local-runtime/runtime-daemon/test/undeclared-dependencies.test.ts packages/local-runtime/runtime-daemon/test/projection-freshness-scope.test.ts packages/local-runtime/runtime-daemon/test/landscape.test.ts packages/local-runtime/runtime-daemon/test/external-documentation.test.ts packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts packages/local-runtime/runtime-daemon/test/explorer-server.test.ts packages/local-runtime/runtime-daemon/test/explorer-session.test.ts packages/local-runtime/runtime-daemon/test/ledger-admin.test.ts packages/local-runtime/runtime-daemon/test/accepted-committed-change.test.ts packages/local-runtime/runtime-daemon/test/agent-jobs.test.ts packages/local-runtime/runtime-daemon/test/audit.test.ts packages/local-runtime/runtime-daemon/test/recommendations.test.ts packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts packages/local-runtime/runtime-daemon/test/refactor-scan-import-limit.test.ts packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts packages/local-runtime/runtime-daemon/test/refactor-decisions.test.ts packages/local-runtime/model-store-yaml/test/native-context.test.ts packages/local-runtime/git-adapter/test/blob-reader.test.ts packages/surfaces/cli/test/failure-envelope.test.ts packages/surfaces/cli/test/native-context.test.ts packages/surfaces/cli/test/public-operation-failures.test.ts packages/surfaces/cli/test/hook-helper-parity.test.ts packages/surfaces/cli/test/hook-state-paths.test.ts packages/core/practice-catalog/test/practice-catalog.test.ts",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      }
    },
    {
      "id": "c1-packaged",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify native and selected CLI code still bundles and runs.",
      "command": "node scripts/packaged-cli-smoke.mjs",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      }
    },
    {
      "id": "c1-cli-selected",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Existing selected CLI dispatch and native/local refusals preserve adapter behavior.",
      "command": "bun test --timeout 180000 packages/surfaces/cli/test/cli.test.ts --test-name-pattern \"CLI (refactor|exposes repo|plans YAML|rebuilds ledger|Book|rollback|audit)|projection freshness|CLI deps\"",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      }
    },
    {
      "id": "c1-runtime-selected",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Existing production constructor and held lifecycle/recovery regressions preserve ownership and success behavior.",
      "command": "bun test --timeout 180000 packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --test-name-pattern \"prepare seeds|init, validate, sync, context|production composition root|runtime default clock|startup that leaves|startup leaves|ledger read mode|ledger-authoritative runtime read surfaces|ledger-authoritative validate\"",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      }
    }
  ]
}
```

## Acceptance and Stop Conditions

Known producer code/reason/action/severity/retryability and complete approved facts survive;
unknown only becomes safe W1. Preserve accessor/prototype/compound guards and details plus
entire compact/rendered failure envelope <=8KiB. Native diagnostics omit whole items with counts.
Raw success signatures/classes remain compatible. No writer/recovery/receipt/RPC wire edits;
stop at newly encountered shared C2 boundaries, preserve work, and report exact missing coverage.
No self-merge/release/#328 closure/repo-harness/#354 changes.

## Rollback

Revert C1 code/policy/test changes only; no state migration or persisted data edits.
