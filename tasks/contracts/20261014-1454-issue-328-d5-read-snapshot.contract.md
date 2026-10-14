# Task Contract: issue-328-d5-read-snapshot

> **Status**: Active
> **Plan**: plans/plan-20261014-1454-issue-328-d5-read-snapshot.md
> **Task Profile**: code-change
> **Owner**: D5 sole implementation writer
> **Capability ID**: capability-architecture-context
> **Review File**: tasks/reviews/20261014-1454-issue-328-d5-read-snapshot.review.md
> **Notes File**: tasks/notes/20261014-1454-issue-328-d5-read-snapshot.notes.md

## Goal and Scope

Share native model/Git file discovery only within one debt/anchors invocation. Preserve existing
producers, canonical scanner, ownership/citation/report/digest/coverage semantics and no-write
reads. No persistent cache, D6/D7, scanner/parser rewrite, business model edits, merge or release.
Coordinator chooses/finalizes the frozen performance workload before timing; independent
regressions remain authorized. Explicit implementation authorization is the source delegation.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20261014-1454-issue-328-d5-read-snapshot.md
  - tasks/contracts/20261014-1454-issue-328-d5-read-snapshot.contract.md
  - tasks/reviews/20261014-1454-issue-328-d5-read-snapshot.review.md
  - tasks/notes/20261014-1454-issue-328-d5-read-snapshot.notes.md
  - packages/local-runtime/runtime-daemon/src/architecture-debt.ts
  - packages/local-runtime/runtime-daemon/src/docs-anchors.ts
  - packages/local-runtime/runtime-daemon/test/architecture-debt-read-inputs.test.ts
  - packages/local-runtime/runtime-daemon/test/fixtures/architecture-debt-read-inputs/
  - packages/surfaces/cli/test/architecture-debt.test.ts
  - packages/surfaces/cli/test/docs-anchors.test.ts
  - scripts/architecture-debt-read-benchmark.ts
  - scripts/architecture-debt-benchmark-inputs.ts
  - scripts/architecture-debt-benchmark-inputs.test.ts
  - docs/runbooks/architecture-debt-read-benchmark.md
  - docs/researches/20261014-issue-328-d5-read-snapshot.md
  - docs/verification/issue-328-d5-read-snapshot-benchmark.json
  - docs/verification/issue-328-d5-read-snapshot-evidence/
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "d5-focused",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify exact report/digest/coverage and no-write behavior through existing debt/anchor/complete/code-facts producers and canonical prose scanner; typecheck and package boundaries protect the internal refactor.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD"
        ]
      },
      "command": "bun run typecheck && node scripts/package-boundary-audit.mjs && bun test --timeout 180000 packages/surfaces/cli/test/architecture-debt.test.ts packages/surfaces/cli/test/docs-anchors.test.ts packages/local-runtime/runtime-daemon/test/architecture-debt-read-inputs.test.ts packages/local-runtime/runtime-daemon/test/complete-architecture-debt.test.ts packages/local-runtime/runtime-daemon/test/architecture-debt-code-facts.test.ts packages/core/projection-engine/test/prose-anchors.test.ts scripts/architecture-debt-benchmark-inputs.test.ts scripts/governance-verify-workflow.test.ts"
    },
    {
      "id": "d5-governance",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify the real benchmark runbook ownership surface and the unchanged full Governance Verify contract after the hosted CI ownership failure.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD"
        ]
      },
      "command": "bun run verify:governance"
    }
  ]
}
```

## Acceptance and Stop Conditions

Do not change evidence semantics to meet a time budget. Keep every agreed cold sample,
including the first; a sample>=3000ms is a failure, not a rounded pass. Full debt is separate.
Stop/tell coordinator about an unexplained report/digest/coverage difference, a no-write
violation, conflicting D5 writer, or a baseline/setup blocker. Parent owns acceptance and merge.

## Rollback

Revert this internal composition-only refactor; no persistent state migration.

