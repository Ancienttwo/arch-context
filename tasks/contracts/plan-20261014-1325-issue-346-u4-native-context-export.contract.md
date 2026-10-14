# Task Contract: issue-346-u4-native-context-export

> **Status**: Active
> **Plan**: plans/plan-20261014-1325-issue-346-u4-native-context-export.md
> **Task Profile**: code-change
> **Owner**: U4 sole implementation writer
> **Capability ID**: capability-architecture-context
> **Last Updated**: 2026-10-14
> **Review File**: tasks/reviews/plan-20261014-1325-issue-346-u4-native-context-export.review.md
> **Notes File**: tasks/notes/plan-20261014-1325-issue-346-u4-native-context-export.notes.md

## Goal and Scope

Implement the reviewed #349 native export design against main 5e144af06c56a9d564d8a06356b732ded7f7fb22. Return complete canonical native model and lossless human inputs via fixed Git blobs or one verified worktree read window, explicit missing contracts, repo-harness/v1 profile and typed fail-closed errors. Preserve existing read/write adapters and parser values.

Exclude RPC schema/version metadata, #328 D5–D7, model/generated-document writes, deployment, publication, issue closure and merge. CLI main.ts write seat was explicitly released by the integration coordinator. Feature-trio files are excluded until the RPC writer's overlap is resolved and this contract is amended.

## Stop Conditions

- Do not widen scope or change shared parser semantics beyond duplicate-key rejection.
- Report unsupported frozen corpus constructs/value mismatches as coverage blockers.
- Report verification or permission blockers with exact evidence; do not substitute an archive for a PR.

## Workflow Inventory

- Review: tasks/reviews/plan-20261014-1325-issue-346-u4-native-context-export.review.md
- Notes: tasks/notes/plan-20261014-1325-issue-346-u4-native-context-export.notes.md
- Checks: .ai/harness/checks/latest.json; runs under .ai/harness/runs/
- Active plan and worktree owner are local ignored execution markers.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20261014-1325-issue-346-u4-native-context-export.md
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
  - packages/core/architecture-domain/src/index.ts
  - packages/core/architecture-domain/test/domain.test.ts
  - packages/surfaces/cli/src/native-context.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/native-context.test.ts
  - scripts/packaged-cli-smoke.mjs
  - docs/spec.md
  - docs/runbooks/native-context-export.md
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "u4-focused",
      "kind": "package_test",
      "cwd": ".",
      "phase": "development",
      "cost": "bounded",
      "evidence_policy": "executed",
      "necessity": "New reader, schemas, IO/scanner/parser/CLI regression and corpus value parity",
      "inputs": {
        "env": {}
      },
      "command": "bun test --timeout 60000 packages/contracts/test/native-context.test.ts packages/local-runtime/git-adapter/test/blob-reader.test.ts packages/local-runtime/model-store-yaml/test/native-context.test.ts packages/core/projection-engine/test/document-regions.test.ts packages/core/architecture-domain/test/domain.test.ts packages/surfaces/cli/test/native-context.test.ts"
    },
    {
      "id": "u4-verify",
      "kind": "command",
      "cwd": ".",
      "phase": "acceptance",
      "cost": "full",
      "evidence_policy": "executed",
      "necessity": "Reviewed plan requires aggregate repository, packaging and regression acceptance after final integration",
      "inputs": {
        "env": {}
      },
      "command": "bun run verify"
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
