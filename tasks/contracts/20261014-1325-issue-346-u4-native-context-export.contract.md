# Task Contract: issue-346-u4-native-context-export

> **Status**: Active
> **Plan**: plans/plan-20261014-1325-issue-346-u4-native-context-export.md
> **Task Profile**: code-change
> **Owner**: U4 sole implementation writer
> **Capability ID**: capability-architecture-context
> **Last Updated**: 2026-10-14
> **Review File**: tasks/reviews/20261014-1325-issue-346-u4-native-context-export.review.md
> **Notes File**: tasks/notes/20261014-1325-issue-346-u4-native-context-export.notes.md

## Goal and Scope

Implement the reviewed #349 native export design against main 5e144af06c56a9d564d8a06356b732ded7f7fb22. Return complete canonical native model and lossless human inputs via fixed Git blobs or one verified worktree read window, explicit missing contracts, repo-harness/v1 profile and typed fail-closed errors. Preserve existing read/write adapters and parser values.

Exclude RPC schema/version metadata, #328 D5–D7, model/generated-document writes, deployment, publication, issue closure and merge. CLI main.ts write seat was explicitly released by the integration coordinator. RPC #350 is merged. The native feature-trio addition is authorized; retain current renderer/RPC metadata and add only the new alphabetically ordered feature.

## Stop Conditions

- Do not widen scope or change shared parser semantics beyond duplicate-key rejection.
- Report unsupported frozen corpus constructs/value mismatches as coverage blockers.
- Report verification or permission blockers with exact evidence; do not substitute an archive for a PR.

## Workflow Inventory

- Review: tasks/reviews/20261014-1325-issue-346-u4-native-context-export.review.md
- Notes: tasks/notes/20261014-1325-issue-346-u4-native-context-export.notes.md
- Checks: .ai/harness/checks/latest.json; runs under .ai/harness/runs/
- Active plan and worktree owner are local ignored execution markers.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20261014-1325-issue-346-u4-native-context-export.md
  - tasks/contracts/20261014-1325-issue-346-u4-native-context-export.contract.md
  - tasks/reviews/20261014-1325-issue-346-u4-native-context-export.review.md
  - tasks/notes/20261014-1325-issue-346-u4-native-context-export.notes.md
  - tasks/contracts/plan-20261014-1325-issue-346-u4-native-context-export.contract.md
  - tasks/reviews/plan-20261014-1325-issue-346-u4-native-context-export.review.md
  - tasks/notes/plan-20261014-1325-issue-346-u4-native-context-export.notes.md
  - packages/contracts/src/native-context.ts
  - packages/contracts/src/index.ts
  - packages/contracts/test/native-context.test.ts
  - packages/contracts/test/contracts.test.ts
  - packages/contracts/test/publishability.test.ts
  - packages/contracts/fixtures/valid/native-context-export.json
  - packages/contracts/fixtures/invalid/native-context-*.json
  - schemas/runtime/native-context-export.schema.json
  - packages/local-runtime/git-adapter/src/blob-reader.ts
  - packages/local-runtime/codegraph-adapter/src/index.ts
  - packages/local-runtime/git-adapter/src/index.ts
  - packages/local-runtime/git-adapter/test/blob-reader.test.ts
  - packages/local-runtime/model-store-yaml/src/native-context.ts
  - packages/local-runtime/model-store-yaml/src/index.ts
  - packages/local-runtime/model-store-yaml/test/native-context.test.ts
  - packages/local-runtime/model-store-yaml/test/fixtures/native-context/
  - packages/core/projection-engine/src/document-regions.ts
  - packages/core/projection-engine/src/source-globs.ts
  - packages/core/projection-engine/src/layout.ts
  - packages/core/projection-engine/src/index.ts
  - packages/core/projection-engine/src/prose-anchors.ts
  - packages/core/projection-engine/test/document-regions.test.ts
  - packages/core/projection-engine/test/layout.test.ts
  - packages/core/projection-engine/test/prose-anchors.test.ts
  - packages/core/projection-engine/test/output-ownership.test.ts
  - packages/core/architecture-domain/src/index.ts
  - packages/core/architecture-domain/test/domain.test.ts
  - packages/surfaces/cli/src/native-context.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/native-context.test.ts
  - scripts/packaged-cli-smoke.mjs
  - packages/contracts/src/projection.ts
  - packages/contracts/fixtures/valid/archctx-capabilities.json
  - schemas/runtime/archctx-capabilities.schema.json
  - docs/spec.md
  - docs/runbooks/native-context-export.md
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "u4-verify",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "expensive",
      "evidence_policy": "baseline_with_delta",
      "necessity": "Retain the passing aggregate at 4f68c76a; the bounded deltas normalize BOM for Markdown block predicates and resolve/copy native smoke dependencies with their platform bindings. Current scanner/reader/CLI/typecheck/isolated Node bundle checks cover these changes; hosted Windows Node lanes validate the platform staging repair.",
      "inputs": {
        "env": [
          "npm_config_cache"
        ]
      },
      "command": "bun run verify",
      "baseline": {
        "run_file": ".ai/harness/runs/verification-vx-2212fb60798d4045856b.json",
        "execution_id": "vx-2212fb60798d4045856b"
      },
      "delta_checks": [
        "u4-current-delta"
      ]
    },
    {
      "id": "u4-current-delta",
      "kind": "command",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify BOM block boundaries, shared adapters and frozen corpus; the isolated Node bundle must resolve installed native dependencies from their owning package and copy explicit platform bindings without workspace module links or ambient Node preload/module paths.",
      "inputs": {
        "env": []
      },
      "command": "bun run typecheck && bun test --timeout 60000 packages/core/projection-engine packages/local-runtime/model-store-yaml/test/native-context.test.ts packages/surfaces/cli/test/native-context.test.ts && node scripts/packaged-cli-smoke.mjs --native-only"
    }
  ]
}
```

## Acceptance Notes

Focused checks establish new behavior during development. Final aggregate verification includes the reviewed plan's package/schema, shared-adapter, corpus and packaged smoke requirements. Independent acceptance remains with the integration coordinator; no self-issued acceptance receipt or merge is authorized.

## Rollback

Revert additive reader/contracts and bounded shared extractions; no stored model/runtime migration occurs.

## Integration scope amendment

The existing contracts.test.ts fixture-to-schema registry and inventory assertion require the new native-context-export entry when the public fixture is added. This bounded shared-test registration is allowed; RPC/version fixture logic remains untouched.

Packaged native smoke found that the CodeGraph adapter eagerly requires its optional-for-native SDK during CLI module evaluation. Delay only that installed-package load until an actual SDK operation; preserve CodeGraph query behavior. The three plan-prefixed workflow paths are allowed only for migration to the harness's canonical timestamp stem.
