# Plan: Agent-context provider: ADR-0043 capability handover contract, agent-context projection, resolve surface

> **Status**: Executing
> **Created**: 20260705-1543
> **Slug**: agent-context-provider
> **Planning Source**: waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: repo-harness capability-filing handover Stage 1 (recon-corrected 2026-07-05)
> **Artifact Level**: work-package
> **Promotion Reason**: merge_boundary
> **Verification Boundary**: bun run typecheck + bun test + bun run test:contracts + node scripts/package-boundary-audit.mjs; full bun run verify pre-PR
> **Rollback Surface**: Revert branch codex/agent-context-provider; no data migration.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260705-1543-agent-context-provider.contract.md`
> **Task Review**: `tasks/reviews/20260705-1543-agent-context-provider.review.md`
> **Implementation Notes**: `tasks/notes/20260705-1543-agent-context-provider.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from waza-think planning output.
- Source ref: repo-harness capability-filing handover Stage 1 (recon-corrected 2026-07-05)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260705-1543-agent-context-provider.md`
- Sprint contract: `tasks/contracts/20260705-1543-agent-context-provider.contract.md`
- Sprint review: `tasks/reviews/20260705-1543-agent-context-provider.review.md`
- Implementation notes: `tasks/notes/20260705-1543-agent-context-provider.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260705-1543-agent-context-provider.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260705-1543-agent-context-provider.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260705-1543-agent-context-provider.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260705-1543-agent-context-provider.contract.md`
- Review file: `tasks/reviews/20260705-1543-agent-context-provider.review.md`
- Implementation notes file: `tasks/notes/20260705-1543-agent-context-provider.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260705-1543-agent-context-provider.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260705-1543-agent-context-provider.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert branch codex/agent-context-provider; no data migration.
- **Verification boundary**: bun run typecheck + bun test + bun run test:contracts + node scripts/package-boundary-audit.mjs; full bun run verify pre-PR
- **Review/acceptance boundary**: `tasks/reviews/20260705-1543-agent-context-provider.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: merge_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260705-1543-agent-context-provider.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260705-1543-agent-context-provider.contract.md`, `tasks/reviews/20260705-1543-agent-context-provider.review.md`, and `tasks/notes/20260705-1543-agent-context-provider.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260705-1543-agent-context-provider.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert branch codex/agent-context-provider; no data migration.

## Captured Planning Output

## Context

repo-harness 的 capability filing(`.ai/context/capabilities.json` + 7 個 consumer)移交給 ArchContext;跨 repo 總方案見 repo-harness `docs/researches/20260705-archcontext-capability-filing-handover.md`。本 plan 是 arch-context 側 Stage 1。

Recon 事實(2026-07-05,file:line):
- M0 已全綠凍結:`plans/sprints/archctx-sprint.md:75,113-140`(23/23 + Exit Gates 全 ☑),凍結證據 `docs/verification/m0-contracts-gate.md`。
- node/v1 **已有**路徑歸屬:`source.include/exclude/entrypoints` glob(`schemas/repo/architecture-node.schema.json`;PRD §17.7:2166-2238 有意設計)——無需新欄位。
- 頂層 schema `additionalProperties: false`;升級規則「新欄位必須 optional 或住 `extensions`」(`docs/runbooks/schema-upgrade-guide.md:1-6`)。
- targetType 硬編三處:`schemas/runtime/projection-target.schema.json:13`、`packages/core/projection-engine/src/index.ts:388-434`、`packages/local-runtime/model-store-yaml/src/index.ts:39-115`。
- CLI 目前無任何 path→node 解析面(`packages/surfaces/cli/src/main.ts:426` 命令清單)。
- PRD/spec 無 repo-harness 整合章節——本 plan + ADR-0043 是該跨產品契約的第一份文件;ADR 下一號為 0043。
- stableId regex(`schemas/repo/architecture-node.schema.json:10`)已容納 `capability.<domain>.<name>`,ID 統一零 schema 改動。

## Scope / Non-scope

In scope:
1. `docs/adr/ADR-0043-agent-context-provider.md`(沿統一 ADR 模板):
   - stableId 即 agentic-runtime 的 capability ID,命名慣例 `capability.<domain>.<name>`。
   - `source.include`(glob)為路徑歸屬事實源;解析 tie-break:`source.exclude` 先裁 → 最具體(最長字面前綴)include 勝出 → 同分歧義 **reject**(對齊 manifest `ownership.ambiguousOwnership: "reject"` 與 repo-harness「same-length ambiguity fails」)。
   - `extensions.lspProfile: string`、`extensions.verification: string[]` 慣例(按升級規則走 extensions;adapter 普及後再議升頂層)。
   - `agent-context` projection 語義:per-capability 塊、marker-owned generated region、human 區保留。
2. `agent-context` projection targetType(三處同步):
   - `schemas/runtime/projection-target.schema.json` enum 加 `"agent-context"`。
   - `packages/core/projection-engine/src/index.ts` target 構造函數加 agent-context 目標(scope: entity / entityKind: capability)。
   - `packages/local-runtime/model-store-yaml/src/index.ts` default manifest 加對應 placementRule。
   - pathTemplate 需要能定位 capability 的主源目錄(如新模板變數 `{primarySourceDir}`,取 `source.include[0]` 的目錄根);**實作者先讀 renderer 的變數展開代碼再定變數名與實作位置**——本 plan 唯一的開放實作細節。
   - 產出:`<primarySourceDir>/CLAUDE.md` 與 `<primarySourceDir>/AGENTS.md` 中的 `BEGIN/END ARCHCONTEXT AGENT CONTEXT` marker 塊(id/name/summary/source/extensions 摘要)。
3. `archctx resolve --path <p>` 新 subcommand(薄):讀 model nodes → 按 ADR tie-break 匹配 → `JsonEnvelope` 輸出 `{stableId, kind, name, source, extensions}`;退出碼 0=匹配、1=無匹配、2=歧義。tie-break 語義只在這裡實作一次,repo-harness Stage 0 adapter 之後直接調它,避免兩邊漂移。
4. 測試:contracts schema enum 斷言;projection-engine agent-context target 構造 + marker 渲染;resolve 匹配/exclude/歧義/無匹配 4 型;fixtures 更新。

Non-scope:
- repo-harness 側 Stage 0 adapter(另一 repo 的 plan)。
- MCP `prepare_task` 輸出擴充(Stage 2 縫合時另開)。
- PRD §29.3 Q1(node kind enum 開放性)不觸碰。
- PRD §17.7:2235 的寫入時 overlap-exclusivity validator(resolve 的 query 時 reject 已部分覆蓋;寫入時驗證另開)。
- 遷移 repo-harness 的 6 個 capability(Stage 2)。

## Approach

### Strategy
零 schema bump:路徑歸屬用既有 `source`,新屬性走 `extensions`,ID 用既有 regex。新增面只有 projection targetType(三處硬編點同步)與一個薄 CLI 解析命令;跨產品語義全部收進 ADR-0043,tie-break 單點實作在 resolve。

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| extensions 慣例 + 既有 source(本案) | 零 schema bump;完全符合升級規則 | extensions 無 schema 驗證 | 採用 |
| schema v2 加頂層欄位 | 強驗證 | 違反 additive 規則,動員全 adapter | 拒絕 |
| 只寫 ADR 不做 resolve CLI | 更小 | repo-harness 只能自行實作 glob 語義,兩實作漂移 | 拒絕(tie-break 必須單點) |

## Detailed Design

### File Changes
| File | Action | Description |
|------|--------|-------------|
| `docs/adr/ADR-0043-agent-context-provider.md` | add | 跨產品契約(上述四點) |
| `schemas/runtime/projection-target.schema.json` | modify | targetType enum 加 `agent-context` |
| `packages/core/projection-engine/src/index.ts` | modify | agent-context target 構造;必要時 pathTemplate 變數展開擴充 |
| `packages/local-runtime/model-store-yaml/src/index.ts` | modify | default manifest 加 agent-context placementRule |
| `packages/surfaces/cli/src/main.ts`(+必要的 core 輔助) | modify | `resolve` subcommand,envelope 輸出,退出碼語義 |
| `packages/contracts/test/contracts.test.ts`、projection-engine/resolve 相關 tests、fixtures | modify/add | 上述測試四組 |

### 關鍵語義
- resolve 是唯一 tie-break 實作點;歧義 reject 是特性,不是錯誤處理的兜底。
- agent-context 塊只寫 marker 區,human 區保留,歸屬不明 reject——沿 projection 既有 ownership 模型,不新造。

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| renderer 不支援新模板變數 | 中 | 中 | 實作前先讀 renderer 展開代碼;必要時在 projection-engine 擴充變數表 |
| full `verify` 鏈過重(privacy audits/readbacks) | 低 | 低 | 本地跑 targeted 驗證;full verify 留 pre-PR/CI |
| extensions 無驗證導致髒數據 | 低 | 低 | ADR 記載慣例;resolve 容錯讀取並在輸出標注缺欄位 |

## Promotion Gate
- **Merge/PR unit**: 是,單一 PR to main。
- **Rollback surface**: revert branch `codex/agent-context-provider`;無資料遷移。
- **Verification boundary**: `bun run typecheck` + `bun test` + `bun run test:contracts` + `node scripts/package-boundary-audit.mjs`;full `bun run verify` 於 PR 前。
- **Review/acceptance boundary**: review 檔 recommend pass。
- **High-risk surface**: projection 三處硬編點同步;新公共 CLI 面(additive,符合 PRD §24.5 v1 穩定規則)。
- **Why not checklist row**: merge_boundary——跨產品契約 + ADR + 4 個 package 面 + 新 CLI 面,獨立回退與驗證邊界。

## Evidence Contract
- **State/progress path**: 本 plan `## Task Breakdown` + `tasks/contracts/<stem>.contract.md`。
- **Verification evidence**: 上列 targeted 命令輸出;full verify 留 PR 前。
- **Evaluator rubric**: contract exit_criteria 通過 + review recommend pass。
- **Stop condition**: Task Breakdown 全勾 + targeted 驗證全綠。
- **Rollback surface**: revert 分支;無資料遷移。

## Task Breakdown
- [x] `docs/adr/ADR-0043-agent-context-provider.md`(stableId 慣例、source=路徑歸屬、tie-break、extensions 慣例、agent-context 語義)
- [x] projection targetType 三處同步(schema enum、projection-engine builder、default manifest)+ pathTemplate 變數(先讀 renderer 再定名)
- [x] `archctx resolve --path` subcommand(envelope、退出碼 0/1/2、exclude→最具體→歧義 reject)
- [x] 測試四組(schema enum、target 構造+渲染、resolve 4 型、fixtures)
- [x] targeted 驗證:`bun run typecheck`、`bun test`、`bun run test:contracts`、`node scripts/package-boundary-audit.mjs`

## Verification
```bash
bun run typecheck
bun test
bun run test:contracts
node scripts/package-boundary-audit.mjs
# 手測:archctx resolve --path <已宣告 include 的路徑> → envelope 含 stableId;
#      對歧義 fixture → 退出碼 2;對未宣告路徑 → 退出碼 1。
# PR 前:bun run verify(完整鏈)
```

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] `docs/adr/ADR-0043-agent-context-provider.md`(stableId 慣例、source=路徑歸屬、tie-break、extensions 慣例、agent-context 語義)
- [x] projection targetType 三處同步(schema enum、projection-engine builder、default manifest)+ pathTemplate 變數(先讀 renderer 再定名)
- [x] `archctx resolve --path` subcommand(envelope、退出碼 0/1/2、exclude→最具體→歧義 reject)
- [x] 測試四組(schema enum、target 構造+渲染、resolve 4 型、fixtures)
- [x] targeted 驗證:`bun run typecheck`、`bun test`、`bun run test:contracts`、`node scripts/package-boundary-audit.mjs`
