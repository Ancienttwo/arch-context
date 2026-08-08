# Plan: archctx 接管 capability 文檔投影(handoff 20260808)

> **Status**: Executing
> **Created**: 20260808-0116
> **Slug**: archctx-capability-docs-projection
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: repo-harness:docs/researches/20260808-archctx-projection-handoff.md
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: bun run typecheck && bun test && bun run test:contracts && node scripts/package-boundary-audit.mjs; pre-PR full bun run verify
> **Rollback Surface**: per-package commits; projection output revertable by marker region
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md`
> **Task Review**: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md`
> **Implementation Notes**: `tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: repo-harness:docs/researches/20260808-archctx-projection-handoff.md
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-0116-archctx-capability-docs-projection.md`
- Sprint contract: `tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md`
- Sprint review: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md`
- Implementation notes: `tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-0116-archctx-capability-docs-projection.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-0116-archctx-capability-docs-projection.md`.

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
- Contract file: `tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md`
- Review file: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md`
- Implementation notes file: `tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-0116-archctx-capability-docs-projection.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: per-package commits; projection output revertable by marker region
- **Verification boundary**: bun run typecheck && bun test && bun run test:contracts && node scripts/package-boundary-audit.mjs; pre-PR full bun run verify
- **Review/acceptance boundary**: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-0116-archctx-capability-docs-projection.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md`, `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md`, and `tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-0116-archctx-capability-docs-projection.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: per-package commits; projection output revertable by marker region

## Captured Planning Output

# Plan: archctx 接管 capability 文檔投影(repo-harness handoff 20260808)

> **Status**: Approved
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary(handoff `docs/researches/20260808-archctx-projection-handoff.md` @ repo-harness + 用戶指令「拿去 arch-context 開工」)
> **Verification Boundary**: `bun run typecheck && bun test && bun run test:contracts && node scripts/package-boundary-audit.mjs`(targeted);pre-PR 跑 full `bun run verify`
> **Rollback Surface**: projection-engine / review-engine / CLI / daemon 各自獨立 commit;投影輸出檔可按 marker region 回滾,marker 外內容不受影響

## Agentic Routing
- Selected route: Fable orchestrator + deep-worker(projection-engine 核心)/ fast-worker(wiring、review 檢查)/ gatekeeper(驗收)
- Routing reason: 交付 1-3 動 marker/渲染核心語義,一次過要落對;交付 4-5 是接線與檢查邏輯
- Due diligence:
  - P1 map(explorer 勘察,file:line 佐證):
    - targetType schema:`packages/contracts/src/ledger.ts:117-126`(`entity-summary`、`agent-context` 已在 enum;`schemas/runtime/projection-target.schema.json:13` 同步)
    - 固定管線:`packages/core/projection-engine/src/index.ts:409-478` `architectureDocumentationTargetDrafts`(entity-summary 路徑 `docs/architecture/modules/{pathSegment(node.id)}.md`,:414);`:503-521` `renderTargetGeneratedBody` if/else 分發
    - marker 機制:`ARCHCONTEXT:generated` BEGIN/END(:114-115),`mergeGeneratedRegion` 冪等 splice(:621-631),drift reason codes(:633-726),marker 屬性帶 sourceDigest/rendererVersion/outputDigest
    - agent-context sibling pipeline:`renderAgentContextProjection`(:863-920)+ 專屬 marker 家族(:808-809, :952-991),ADR-0043 有意獨立;**CLI/daemon 零 caller(grep 實證)= 交付 4 唯一缺口是接線**
    - codegraph adapter:import 邊 `importEdgesFromQueryNodes`(`packages/local-runtime/codegraph-adapter/src/index.ts:454-467`,可靠);call trail `parseNodeTrail`(:499-524,best-effort,混 type references)
    - 寫入邊界:`applyArchitectureProjectionChangeSet`(`packages/local-runtime/runtime-daemon/src/index.ts:2528-2560`)→ `render_projection` ChangeOperation → `ChangeSetEngine.apply` atomic write(`changeset-engine/src/index.ts:209-211, 598-602`)
    - review 面:`stale-context` finding(`review-engine/src/index.ts:95-97`,HEAD-mismatch 語義)、`projection-drift`(:178-186,digest 語義);finding id 是自由字串,無 schema enum 約束
    - 本 repo 唯一 live node `capability.architecture-context` 無 `source.include/entrypoints`
  - P2 trace(既有投影全路徑):CLI `archctx docs plan|preview|apply`(`packages/surfaces/cli/src/main.ts:950-995`)→ daemon → `renderArchitectureDocumentationProjection`(projection-engine :125-216,input=model+decisions,無 git ref)→ targets+files+manifest+drift → `applyArchitectureProjectionChangeSet` → ChangeSet plan/approve/apply → atomicWriteFile。壓力點:renderEntitySummary 輸出遠薄於 handoff §2 契約;render input 無 commit 概念;P1/P2 圖無生成器;agent-context plan 無 caller。
  - P3 decision rationale:見 Approach。

## Approach
### Strategy
1. **不新增 targetType**。交付 1 = `entity-summary` 渲染升級到 handoff §2 機器區形狀(引言塊:狀態/`Verified against: <branch>@<commit>`/Capability ID/Matched Prefixes + §1 P1 地圖骨架:模組表、規模信號、依賴邊界)。沿用既有 target/marker/drift 機制,是最小一致改動。
2. **機器區用既有 per-target marker region**。機器區(標題+引言+§1[+§2])成連續前綴,單 region 起步;P2 圖若需人工覆寫區再拆第二 region。marker 外 byte-for-byte 保留由 `mergeGeneratedRegion` splice 語義保證,補測試釘死。
3. **P1 flowchart 邊只用 import 邊**(codegraph 高可信);call trail best-effort 不進 P1 邊。No-Fallback:取不到真值就省略該邊並在圖註標明,不合成。
4. **P2 sequenceDiagram**:entrypoint call path 生成候選;daemon/codegraph 不可用 → fail-closed 明確報錯,不退化空模板。
5. **freshness 兩半**:(a) render input 新增必填 git ref(branch+commit),投影引言輸出 `Verified against`——fail-closed,不做 optional 回退;(b) review-engine 新增 projection-freshness 檢查(投影 Verified against commit 之後 `source.include` 命中檔案有變更 → 報警),finding id 沿用 `stale-context`(handoff 契約明文 `review.failOn: stale-context`),detail 區分觸發源,不改現有 HEAD-mismatch 語義。
6. **agent-context 接線**:CLI 子命令(鏡像 `docs plan|preview|apply` 形狀)+ daemon 方法複用 `render_projection` ChangeOperation 邊界;絕不繞過 ChangeSet 直寫。
7. **stableId 映射**約定寫進遷移對接面:`verification-evals-checks ↔ capability.verification.evals-checks`(mapping 表屬 repo-harness Stage 2 script,本側只保證 stableId 形態相容)。

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| 新增獨立 capability-summary targetType | 與舊 entity-summary 隔離 | 重複管線、雙 marker、違反最小改動 | 否 |
| 升級既有 entity-summary 渲染 | 沿用 target/marker/drift/manifest 全套 | 舊輸出形狀改變(僅機器區內) | **採用** |
| freshness 新 finding id | 語義乾淨 | 違反 handoff 契約明文 failOn: stale-context | 否,沿用 stale-context |
| P1 邊納入 call trail | 邊更豐富 | best-effort 混 type references,違反「不許猜」 | 否,僅 import 邊 |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `.gitignore` | edit | managed block 外加 repo-local 反向規則(init 模板錯配:`.archcontext/` 是本 repo Git-visible 真值) |
| `packages/core/projection-engine/src/index.ts` | edit | render input 加 git ref;renderEntitySummary 升級 §2 契約形狀;P1 flowchart / P2 sequenceDiagram 生成器 |
| `packages/local-runtime/codegraph-adapter/src/index.ts` | edit(如需) | 暴露 P1/P2 需要的 import-graph / call-path 查詢面 |
| `packages/local-runtime/runtime-daemon/src/index.ts` | edit | git ref 注入 render input;agent-context apply 方法(複用 render_projection) |
| `packages/surfaces/cli/src/main.ts` | edit | agent-context 子命令;docs 子命令傳 git ref |
| `packages/core/review-engine/src/index.ts` | edit | projection-freshness 檢查(stale-context finding) |
| `packages/core/projection-engine/test/**`、相關 test | edit/add | 冪等、byte-for-byte、fail-closed、freshness 測試 |
| `.archcontext/model/nodes/capability.architecture-context.yaml` | via ChangeSet | 補 source.include/entrypoints 供 live 驗收(不手編繞過 mutation 規則) |

### Data Flow
node YAML(source.include/entrypoints)+ codegraph(import 邊/call path)+ git ref → render(targets → marker-merged files)→ ChangeSet render_projection → atomic write `docs/architecture/modules/{stableId}.md`;review-engine 對比 Verified against commit vs source.include 檔案變更 → stale-context finding → `review.failOn` 報警。

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| marker 外內容被誤動(驗收硬條件) | 低 | 高 | byte-for-byte 斷言測試;gatekeeper 對 diff 驗收 |
| render input 加必填 git ref 破壞既有 caller/測試 | 中 | 中 | typecheck 全量掃 caller;測試同步改 |
| codegraph trail 品質(type refs 混入) | 中 | 中 | P1 只用 import 邊;P2 標半自動+人工覆寫區 |
| repo-harness 側驗收依賴其 nodes 未遷 | 高 | 低 | 本側以 fixture+本 repo live node 驗收;跨 repo 樣例驗收另約 |

## Promotion Gate
- **Merge/PR unit**: 單一 work-package PR(交付 1-5 + init 修復),commits 按交付切
- **Rollback surface**: 見 header
- **Verification boundary**: 見 header
- **Review/acceptance boundary**: gatekeeper 對照 handoff §3 驗收標準審 diff + 跑 targeted 驗證;冪等驗收=連續兩次投影零 diff
- **High-risk surface**: projection-engine marker 語義、daemon ChangeSet 邊界
- **Why not checklist row**: 五項交付跨 4 個 package、含跨 repo 契約,獨立 work-package

## Evidence Contract
- **State/progress path**: 本計劃 Task Breakdown + `.ai/harness/checks/latest.json`
- **Verification evidence**: targeted 驗證命令輸出;冪等雙跑 diff 為空;byte-for-byte 測試
- **Evaluator rubric**: handoff §3 各交付驗收標準
- **Stop condition**: 五項交付驗收通過或碰到 BLOCKED(如 codegraph 環境缺失)上抛
- **Rollback surface**: 見 header

## Task Breakdown
- [ ] T0:`.gitignore` repo-local override(init 錯配修復)
- [ ] T1:render input git ref plumbing + entity-summary 升級 §2 契約形狀(引言塊 + §1 骨架)+ 冪等/byte-for-byte 測試(交付 1 + 交付 5a)
- [ ] T2:P1 flowchart 生成(import 邊,No-Fallback)(交付 2)
- [ ] T3:P2 sequenceDiagram 半自動生成(fail-closed)(交付 3)
- [ ] T4:agent-context 接線(CLI + daemon + ChangeSet 邊界)(交付 4)
- [ ] T5:review-engine projection-freshness 檢查(stale-context finding)(交付 5b)
- [ ] T6:live 驗收:本 repo node 補 source(走 ChangeSet)、實跑投影、冪等驗證;gatekeeper 過閘

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] T0:`.gitignore` repo-local override(init 錯配修復)
- [ ] T1:render input git ref plumbing + entity-summary 升級 §2 契約形狀(引言塊 + §1 骨架)+ 冪等/byte-for-byte 測試(交付 1 + 交付 5a)
- [ ] T2:P1 flowchart 生成(import 邊,No-Fallback)(交付 2)
- [ ] T3:P2 sequenceDiagram 半自動生成(fail-closed)(交付 3)
- [ ] T4:agent-context 接線(CLI + daemon + ChangeSet 邊界)(交付 4)
- [ ] T5:review-engine projection-freshness 檢查(stale-context finding)(交付 5b)
- [ ] T6:live 驗收:本 repo node 補 source(走 ChangeSet)、實跑投影、冪等驗證;gatekeeper 過閘
