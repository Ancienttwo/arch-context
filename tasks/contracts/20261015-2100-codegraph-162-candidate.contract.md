# Task Contract: CodeGraph 1.6.2 candidate

> **Status**: Active
> **Task Profile**: code-change
> **Plan**: plans/plan-20261015-2100-codegraph-162-candidate.md
> **Owner**: delegated Codex sole writer
> **Review File**: tasks/reviews/20261015-2100-codegraph-162-candidate.review.md
> **Notes File**: tasks/notes/20261015-2100-codegraph-162-candidate.notes.md

## Goal and Scope

Implement the expressly approved isolated upstream1.6.2 candidate for #358 after impact inventory, following the plan and closed path allowlist. Publish one Draft PR. Do not claim proven root cause, close358 or touch protected worktrees, budgets, exit semantics, telemetry flags, bundle runtime/launcher, CI topology or release surfaces beyond the exact dependency assertion.

## Allowed Paths

```yaml
allowed_paths:
  - docs/architecture/changelog.md
  - docs/architecture/decisions/index.md
  - docs/architecture/diagrams/architecture.likec4
  - docs/architecture/diagrams/architecture.mmd
  - docs/architecture/diagrams/architecture.structurizr.json
  - docs/architecture/index.md
  - docs/architecture/modules/architecture/context.md
  - docs/architecture/.projection-manifest.json
  - bun.lock
  - docs/verification/architecture-ledger-al9-complete-task-provenance-readback.json
  - docs/verification/architecture-ledger-al9-complete-task-provenance.md
  - docs/verification/architecture-ledger-al9-doc-projections-readback.json
  - docs/verification/architecture-ledger-al9-doc-projections.md
  - package.json
  - packages/contracts/fixtures/invalid/projection-result-applied-incomplete-coverage.json
  - packages/contracts/fixtures/valid/flow-selector-check.json
  - packages/contracts/fixtures/valid/product-version-manifest.json
  - packages/contracts/fixtures/valid/projection-manifest.json
  - packages/contracts/fixtures/valid/projection-result.json
  - packages/contracts/src/product-version.ts
  - packages/contracts/src/projection.ts
  - packages/contracts/test/contracts.test.ts
  - packages/core/projection-engine/test/agent-context.test.ts
  - packages/core/projection-engine/test/capability-isolation.test.ts
  - packages/core/projection-engine/test/component-sections.test.ts
  - packages/core/projection-engine/test/entity-summary.test.ts
  - packages/core/projection-engine/test/manifest-merge.test.ts
  - packages/core/projection-engine/test/orphan-disposition.test.ts
  - packages/core/projection-engine/test/output-ownership.test.ts
  - packages/core/projection-engine/test/projection-freshness.test.ts
  - packages/core/projection-engine/test/refactor-baseline.test.ts
  - packages/core/projection-engine/test/skeleton-language.test.ts
  - packages/core/review-engine/test/architecture-debt.test.ts
  - packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts
  - packages/local-runtime/codegraph-adapter/test/fixtures/refactor-baseline/projection-handshake.json
  - packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts
  - packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts
  - packages/local-runtime/package.json
  - packages/local-runtime/runtime-daemon/test/accepted-committed-change.test.ts
  - packages/local-runtime/runtime-daemon/test/projection-target-changes.test.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/cli/test/local-product-e2e.test.ts
  - packages/surfaces/renderer/test/renderer.test.ts
  - plans/plan-20261015-2100-codegraph-162-candidate.md
  - schemas/runtime/projection-apply-readback.schema.json
  - schemas/runtime/projection-apply-recovery.schema.json
  - schemas/runtime/projection-result.schema.json
  - scripts/architecture-ledger-al9-complete-task-provenance-readback.ts
  - scripts/architecture-ledger-al9-doc-projections-readback.ts
  - scripts/codegraph-selector-node-integration.mjs
  - scripts/fg6-npm-release-dry-run.test.ts
  - scripts/fg6-npm-release-dry-run.ts
  - scripts/verify-architecture-mermaid.test.ts
  - tasks/contracts/20261015-2100-codegraph-162-candidate.contract.md
  - tasks/notes/20261015-2100-codegraph-162-candidate.notes.md
  - tasks/notes/20261015-2100-codegraph-162-candidate.scope.json
  - tasks/reviews/20261015-2100-codegraph-162-candidate.review.md

```

## Verification Plan

```json
{"protocol":1,"checks":[{"id":"contracts-adapter-projection-consumers","command":"bun test --timeout 60000 <complete affected files recorded in notes>"},{"id":"original-crlf","command":"bun test --timeout 60000 packages/surfaces/cli/test/projection-change-classification.test.ts"},{"id":"selector-node","command":"bun run test:codegraph-selector-node"},{"id":"types","command":"bun run typecheck"},{"id":"packaged-cli","command":"node scripts/packaged-cli-smoke.mjs"}]}
```

## Change Assessment

Exact dependency identity changes shared protocol/fixture stamps and may change upstream parsing and shutdown. Current schemas and digest-bound receipts must agree; historical measurements must stay attributable. Whole affected files, original CRLF fixture, actual changed-file sync and official bundle/runtime measurements provide bounded local evidence. Windows original failure remains a hosted validation requirement.
