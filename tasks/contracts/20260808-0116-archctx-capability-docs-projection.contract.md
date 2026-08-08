# Task Contract: archctx-capability-docs-projection

> **Status**: Fulfilled
> **Plan**: plans/plan-20260808-0116-archctx-capability-docs-projection.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 01:16
> **Review File**: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md`
> **Notes File**: `tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md`

## Goal

實現 repo-harness handoff(`docs/researches/20260808-archctx-projection-handoff.md` @ repo-harness)§3 的五項 arch-context 側交付:capability 模組文檔機器投影(entity-summary 渲染升級到 §2 契約機器區形狀 + `Verified against` 引言)、P1 flowchart 生成(僅真實 import 邊)、P2 sequenceDiagram 半自動生成(fail-closed)、agent-context targetType 接線(CLI+daemon+ChangeSet)、projection freshness 檢查(`stale-context` finding)。驗收硬條件:marker 外 byte-for-byte 保留、連續兩次投影冪等。

## Scope

- In scope:
  - `.gitignore` repo-local override(init 模板把 `.archcontext/` 錯列 ignore 的修復)
  - projection-engine:render input git ref、entity-summary 渲染升級、P1/P2 圖生成器與測試
  - codegraph-adapter:P1/P2 所需 import-graph / call-path 查詢面
  - runtime-daemon / CLI:git ref 注入、agent-context 投影接線(走 `render_projection` ChangeOperation)
  - review-engine:projection-freshness 檢查
  - live 驗收:本 repo node 經 ChangeSet 補 `source.include/entrypoints`,實跑投影
- Out of scope:
  - repo-harness 側 Stage 2(capability_source 開關、drift 卡片改薄、freshness 委派、capabilities.json→nodes 遷移 script)
  - P3/歷史/Backlog 區段的任何內容生成
  - capabilities.json ↔ nodes 雙向同步
  - 新增 targetType、schema enum 變更

## Workflow Inventory

- Source plan: `plans/plan-20260808-0116-archctx-capability-docs-projection.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md`
- Notes file: `tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - .gitignore
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md
  - tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md
  - tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md
  - packages/core/projection-engine/
  - packages/core/review-engine/
  - packages/local-runtime/codegraph-adapter/
  - packages/local-runtime/runtime-daemon/
  - packages/surfaces/cli/
  - .archcontext/model/
  - docs/architecture/
  - packages/surfaces/renderer/
  - scripts/architecture-ledger-al9-doc-projections-readback.ts
  - scripts/architecture-ledger-al9-doc-projections-readback.test.ts
  - scripts/architecture-ledger-al9-complete-task-provenance-readback.ts
  - packages/core/policy-engine/
  - packages/core/changeset-engine/
  - schemas/runtime/changeset.schema.json
```

<!-- 2026-08-08 scope widening 3(orchestrator 裁決):render_agent_context op kind 是 Q1 裁決的必然後果,發佈的 changeset schema enum 必須與 TS union 一致(20260705 handover 的 schemaVersion fail-closed 原則)。單行 enum 追加。 -->

<!-- 2026-08-08 scope widening(orchestrator 裁決):verifiedAgainst 必填後的 caller 機械補參數波及上列 4 個路徑;scripts/architecture-ledger-al9-* 本在 Acceptance Notes 回歸面內,renderer 測試是同形狀 caller。無語義改動。 -->

<!-- 2026-08-08 scope widening 2(orchestrator 裁決,依 deep-reasoner Q1/Q2 裁決):agent-context 接線需要 ChangeSet 寫入白名單的 operation-kind 限定放寬(policy-engine)與新 op kind + scope hook(changeset-engine)。新增下列兩路徑。 -->

## Evidence Requirements

```yaml
evidence_requirements:
  # 本 work-package 不消費 harness profile benchmark matrix。
  benchmark: not_applicable
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
    - packages/core/projection-engine/src/index.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md
  tests_pass:
    - path: packages/core/projection-engine/test/entity-summary.test.ts
    - path: packages/core/projection-engine/test/projection-freshness.test.ts
    - path: packages/core/review-engine/test/review-engine.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/core/projection-engine packages/core/review-engine packages/local-runtime/codegraph-adapter
    - bun run test:contracts
    - node scripts/package-boundary-audit.mjs
  qa_scores:
    - dimension: functionality
      min: 7
  manual_checks:
    - "Evaluator review file recommends pass"
    - "連續兩次投影零 diff(冪等);marker 外 byte-for-byte 保留(測試斷言 + gatekeeper diff 驗收)"
    - "P1 flowchart 邊全部可溯源到 codegraph import 邊;無啟發式合成邊"
    - "codegraph 不可用時 P2 生成 fail-closed 報錯(非空模板)"
```

## Acceptance Notes (Human Review)

- Functional behavior: handoff §3 五項交付各自的驗收標準(見 plan);投影輸出符合 handoff §2 機器/人工分區表
- Edge cases: node 無 source.include(跳過圖生成並標註,不猜);repo 無 relations;既有文檔無 marker(mixed 追加);marker 被手改(drift 偵測)
- Regression risks: render input 加必填 git ref 影響既有 caller;entity-summary 輸出形狀改變影響既有 readback scripts(scripts/architecture-ledger-al9-*)
- 授權鏈:handoff 文檔(repo-harness 側已批)+ 用戶指令「拿去 arch-context 開工」;ship(commit/push/PR)另行請示

## Rollback Point

- Commit / checkpoint: worktree base `7415329`(main)
- Revert strategy: 按交付切 commit,逐項 revert;投影輸出檔按 marker region 回滾,人工區不受影響
