# Task Contract: agent-context-provider

> **Status**: Active
> **Plan**: plans/plan-20260705-1543-agent-context-provider.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-05 15:44
> **Review File**: `tasks/reviews/20260705-1543-agent-context-provider.review.md`
> **Notes File**: `tasks/notes/20260705-1543-agent-context-provider.notes.md`

## Goal

讓 ArchContext 成為 agentic runtime 的 capability-context provider:ADR-0043 固化跨產品契約(stableId=capability ID、`source.include` glob=路徑歸屬、tie-break=exclude 先裁→最具體 include 勝出→歧義 reject、`extensions.lspProfile`/`extensions.verification` 慣例);新增 `agent-context` projection targetType(三個硬編點同步);新增 `archctx resolve --path` 薄命令作為唯一 tie-break 實作點。實作以 plan `## Detailed Design` 為準。

## Scope

- In scope:
  - `docs/adr/ADR-0043-agent-context-provider.md`(統一 ADR 模板)
  - `schemas/runtime/projection-target.schema.json`:targetType enum 加 `agent-context`
  - `packages/core/projection-engine/src/index.ts`:agent-context target 構造;必要時 pathTemplate 變數展開擴充(先讀 renderer 現況再定名)
  - `packages/local-runtime/model-store-yaml/src/index.ts`:default projection manifest 加 agent-context placementRule
  - `packages/surfaces/cli/src/main.ts`(+必要 core 輔助):`resolve` subcommand,JsonEnvelope 輸出,退出碼 0=匹配/1=無匹配/2=歧義
  - 測試四組(schema enum、target 構造+marker 渲染、resolve 四型、fixtures)
- Out of scope:
  - repo-harness 側 Stage 0 adapter(另一 repo)
  - MCP `prepare_task` 輸出擴充(Stage 2)
  - node schema 頂層欄位變更 / schemaVersion bump(升級規則:走 extensions)
  - PRD §29.3 Q1 kind enum 開放性
  - PRD §17.7:2235 寫入時 overlap-exclusivity validator
  - 遷移 repo-harness 的 6 個 capability(Stage 2)
  - 任何 privacy/governance 面(GitHub App、cloud、tunnel)改動

## Workflow Inventory

- Source plan: `plans/plan-20260705-1543-agent-context-provider.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260705-1543-agent-context-provider.review.md`
- Notes file: `tasks/notes/20260705-1543-agent-context-provider.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/
  - tasks/contracts/20260705-1543-agent-context-provider.contract.md
  - tasks/reviews/20260705-1543-agent-context-provider.review.md
  - tasks/notes/20260705-1543-agent-context-provider.notes.md
  - docs/adr/ADR-0043-agent-context-provider.md
  - schemas/runtime/projection-target.schema.json
  - packages/core/projection-engine/
  - packages/local-runtime/model-store-yaml/
  - packages/surfaces/cli/
  - packages/contracts/test/
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    tool_calls: null
    wall_time_minutes: null
  permission_scope:
    mode: inherit_allowed_paths
    writable_paths: []
    network: inherited
  roles:
    parent:
      mode: narrate_and_gatekeep
      purpose: approval_checkpoint_owner
    explorer:
      mode: read_only
      purpose: codebase_research
    worker:
      mode: edit_within_allowed_paths
      purpose: implementation
    verifier:
      mode: read_only
      purpose: exit_criteria_review
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - docs/adr/ADR-0043-agent-context-provider.md
  artifacts_exist:
    - tasks/notes/20260705-1543-agent-context-provider.notes.md
  files_contain:
    - path: schemas/runtime/projection-target.schema.json
      pattern: "agent-context"
    - path: packages/core/projection-engine/src/index.ts
      pattern: "agent-context"
    - path: packages/local-runtime/model-store-yaml/src/index.ts
      pattern: "agent-context"
  tests_pass:
    - path: packages/contracts/test/contracts.test.ts
  commands_succeed:
    - bun run typecheck
    - bun run test:contracts
    - node scripts/package-boundary-audit.mjs
  qa_scores:
    - dimension: functionality
      min: 7
  manual_checks:
    - "Evaluator review file recommends pass"
```

## Acceptance Notes (Human Review)

- Functional behavior: `archctx resolve --path` 對已宣告 include 路徑回 envelope 含 stableId;歧義 fixture 退出碼 2;未宣告路徑退出碼 1。agent-context projection 對 capability node 產出 marker 塊,human 區保留。
- Edge cases: `source.exclude` 覆蓋 include;node 無 `source` 欄位(視為不擁有任何路徑,不參與匹配);extensions 缺欄位時 resolve 輸出照常、僅省略。
- Regression risks: targetType 三處硬編點漏改任何一處(schema/builder/default-manifest);pathTemplate 變數擴充影響既有 8 個 targetType 的渲染(以既有 projection 測試守住)。

## Rollback Point

- Commit / checkpoint: base `2729112`(main,"Record archctx Apache license release")
- Revert strategy: 刪除 branch `codex/agent-context-provider` 與 worktree;無資料遷移。
