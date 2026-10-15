# Task Contract: #328 final recovery metadata and engine floors

> **Status**: Active
> **Task Profile**: code-change
> **Plan**: plans/plan-20261015-1535-issue-328-final-recovery-floors.md
> **Owner**: delegated Codex single writer
> **Capability ID**: capability-architecture-context
> **Review File**: tasks/reviews/20261015-1535-issue-328-final-recovery-floors.review.md
> **Notes File**: tasks/notes/20261015-1535-issue-328-final-recovery-floors.notes.md

## Goal and Scope

Implement the explicitly approved bounded D6/C2 plus D7 plan. The machine scope file is the closed allowlist. Eight production source paths, one schema, two product documents and seven tests are admitted. No new resolver, cross-repo migration, command, dependency, lifecycle refactor or B/#358 work. Ordinary recovery stays complete; historical over-budget metadata is explicitly committed/manual-only without automatic restore or replay. New commits are gated on the final expanded metadata before business writes. Manifest floors apply at render and actual write, including delayed/pre-rendered and implicit rebuild paths.

## Allowed Paths

```yaml
allowed_paths:
  - packages/contracts/src/projection-recovery.ts
  - packages/contracts/src/failure.ts
  - packages/contracts/src/projection-manifest.ts
  - packages/contracts/src/index.ts
  - packages/core/projection-engine/src/index.ts
  - packages/core/changeset-engine/src/index.ts
  - packages/local-runtime/runtime-daemon/src/projection-service.ts
  - packages/local-runtime/runtime-daemon/src/changeset-authority.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/contracts/test/projection-recovery.test.ts
  - packages/contracts/test/projection-manifest-floors.test.ts
  - packages/core/projection-engine/test/manifest-merge.test.ts
  - packages/core/changeset-engine/test/projection-manifest-floors.test.ts
  - packages/local-runtime/runtime-daemon/test/projection-recovery-budget.test.ts
  - packages/surfaces/cli/test/projection-protocol-lifecycle.test.ts
  - schemas/runtime/projection-manifest.schema.json
  - docs/spec.md
  - docs/runbooks/crash-recovery.md
  - plans/plan-20261015-1535-issue-328-final-recovery-floors.md
  - tasks/contracts/20261015-1535-issue-328-final-recovery-floors.contract.md
  - tasks/notes/20261015-1535-issue-328-final-recovery-floors.notes.md
  - tasks/notes/20261015-1535-issue-328-final-recovery-floors.scope.json
  - tasks/reviews/20261015-1535-issue-328-final-recovery-floors.review.md
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "final-contracts-core-runtime",
      "command": "bun test --timeout 60000 packages/contracts/test/contracts.test.ts packages/core/projection-engine/test packages/contracts/test/projection-recovery.test.ts packages/contracts/test/projection-manifest-floors.test.ts packages/core/changeset-engine/test/projection-manifest-floors.test.ts packages/local-runtime/runtime-daemon/test/projection-recovery-budget.test.ts packages/surfaces/cli/test/projection-protocol-lifecycle.test.ts packages/contracts/test/failure-envelope.test.ts packages/contracts/test/public-operation-failures.test.ts packages/core/changeset-engine/test/changeset-engine.test.ts packages/core/changeset-engine/test/manifest-update.test.ts packages/core/changeset-engine/test/root-contract-write.test.ts packages/local-runtime/runtime-daemon/test/projection-apply.test.ts packages/local-runtime/runtime-daemon/test/rpc-client.test.ts"
    },
    {
      "id": "type-boundary",
      "command": "bun run typecheck && node scripts/package-boundary-audit.mjs"
    },
    {
      "id": "production-audit",
      "command": "node scripts/production-mock-reachability-audit.mjs"
    },
    {
      "id": "packaged",
      "command": "node scripts/packaged-cli-smoke.mjs"
    }
  ]
}
```

## Acceptance and rollback

Dedicated committed details <=262144 compact UTF-8 JSON bytes; complete lookupKey/applyId retained, no critical ID truncation; preserve catalog attributes and default C1 budgets. Over-limit new receipts stop before journal/file/ledger/receipt business writes, without claiming zero session/snapshot writes. Legacy receipts and pending delivery stay original; existing source client inspect/readback must work. Floors preserve absent-field bytes and refuse future manifest at all render/write entries. The coordinator subsequently permits local commit and branch-only ordinary push before C1 merge when workflow inspection proves no full matrix trigger; no PR until accepted-main alignment. Roll back only task-owned source/test/docs; no persistent state mutation.
