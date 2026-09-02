# PRD: Refactor Instrumentation, Module Statistics and Resolution Ledger

> **Status**: Approved
> **Slug**: refactor-intelligence-resolution-ledger
> **Created**: 2026-09-02
> **Updated**: 2026-09-02
> **Source Spec**: `docs/spec.md`
> **Source Research**: `docs/researches/20260902-restructure.md`（雙倉權威邊界方案，本 PRD 只落 Program A，並修正其定位）
> **Related ADRs**: ADR-0011（intervention model）、ADR-0025（proof-required）、ADR-0040（hybrid ledger）、ADR-0041（native local audit）、ADR-0045（authority-separated data engine）
> **Tier**: standard
> **Target Release**: `archctx@0.5.0`（scan + record，全部 contract 一次凍結）→ `archctx@0.5.1`（verify runtime）
> **Downstream Consumer**: `Ancienttwo/repo-harness` Refactor Mode（Program B，不在本倉範圍）
> **Document Language**: 繁體中文

> **核心結論：ArchContext 是 Agent 在代碼架構上的儀器、證據閘門與賬本，不是重構決策者。它量測結構事實、對 Agent 提出的變更做確定性判級（動幾個 node、是否改宣告模型、證據是否完整）、記錄提案並在事後重新量測驗證。是否重構、目標架構長什麼樣，由 Agent 層（repo-harness 派發的 coding agent 與人）決定。ArchContext 唯一的否決權是事實閘門：Agent 不能把量測為跨模組的變更宣稱成單模組，不能在證據缺失時跳過 proof-required。**

---

## AI Quick-Read Card

- Problem: ArchContext 已有 CodeGraph adapter、scale signal、import edge、pressure engine、posture 判定、recommendation fingerprint/dedup 與 lifecycle，但沒有 first-class、版本化、fail-closed 的「量測 → 對提案判級 → 記錄 → 事後驗證」協議；下游 repo-harness 若自己補統計器與判級器，就會出現第二套事實來源。
- Users: coding agent 與 repo-harness Refactor Mode（機器消費者，透過 CLI 用儀器）；本地開發者（人讀 `book` 投影）。
- Platform: 現有 `archctx` CLI → daemon RPC → SQLite ledger；Bun workspaces；CodeGraph `1.5.0` exact pin。
- P0 surface: `archctx refactor scan|record`（0.5.0）與 `refactor verify`（0.5.1）；`RefactorRequestV1`、`RefactorProposalV1`、`ModuleStatisticsSnapshotV1`、`RefactorAssessmentV1`、`RecommendationV3`、`RefactorResolutionEvidenceV1` 六個 contract 在 0.5.0 一次凍結；capability feature 分兩批。
- Core metric: 同 model / 同 HEAD / 同 CodeGraph index 下兩次 `scan` 輸出 byte-identical；證據不足時 scale 必為 `insufficient_evidence` 或 `model_adoption_required`，永不猜 module。
- Hard constraint: ArchContext 不生成目標架構、不替 Agent 決定是否重構；遵守 ADR-0040 mutation contract；`.archcontext/` 仍是 Git 可見架構真相；ledger 不存 raw source / raw diff / CodeGraph 全量輸出；`docs/architecture` 仍只輸出 1–2–5 量級 bucket。
- Key risk: 模型粒度決定判級粒度。本倉自己的 model 只有一個 capability 與一個 child component，capability include `packages/**/src/**`，dogfooding 前必須先細化模型；且 SCC / fan-in / 入邊索引今天完全不存在，是淨新工作。
- Unknowns: `paths:` scope 部分無 owner 的處置；v2→v3 遷移後 `ledger rebuild` replay 一致性；CodeGraph 在大倉的 `truncated` 頻率。
- Acceptance scenarios: 見 §Acceptance Scenarios S1–S7（含三個 negative）。
- Suggested next step: 以本 PRD 為 Source PRD 建 Sprint，第一行是 RF0 characterization freeze；RF0 落地前不動 pressure engine 與 refactor-decision 的任何行為。

---

## 0. 方案審核結論

本節記錄對 `docs/researches/20260902-restructure.md` 的採納、修正與裁切。修正條目均已對照現行代碼核實（含一輪獨立第二軌審核）。

### 0.1 定位修正（最重要）

方案把 ArchContext 寫成「唯一 route 權威，自己生成重構建議與目標架構」。這與 `docs/spec.md` 的產品定義不符：spec 說 ArchContext 是「嵌入 Agentic Coding Runtime 的软件架构控制循环」，在任務前編譯上下文、在開發中檢測結構壓力、在 Agent 想直接重構而證據不足時進入 Proof Required。它是圍繞 Agent 的儀器與閘門，不是自主架構師。現行 `createInterventionProposal()` 用 placeholder 自造 `module.target-owner`（`packages/core/refactor-decision/src/index.ts:64-83`），正是確定性層越界做 Agent 層工作的症狀。

本 PRD 的分工：

```text
ArchContext（儀器 + 閘門 + 賬本）
  量測：footprint、ownership、import graph、cycle、evidence completeness
  判級：對 Agent 提出的 RefactorProposal 做確定性 scale 分類
  觀察：只輸出可確定性偵測的 structural observation（cycle、unowned path、ownership 歧義…）
  賬本：記錄 proposal / observation / verification，維護 lifecycle 與 dedup
  驗證：事後重新量測，判 resolved / not_improved / regressed

Agent 層（repo-harness + Claude / Codex / GPT Pro + 人）
  決定：是否重構、何時重構、目標架構是什麼
  撰寫：RefactorProposal（scope、target delta、expected outcomes、kill list）
  執行：Plan / Contract / Worktree / PR / merge
  接受：accept / reject / defer recommendation
```

一句話規則改為：**ArchContext 回答「這個變更實際動到什麼、證據夠不夠、改完是否真的改善」；Agent 層回答「要不要改、改成什麼樣、誰來改」。** ArchContext 對 Agent 的唯一否決是事實閘門：不能把量測為 `cross_module` / `architecture` 的提案宣稱為 `module`，不能在 `insufficient_evidence` 時繼續。

由此帶來的結構性改動：

- 方案的 `route` 改名 `scale`，語義從「該走哪條 workflow」收窄為「這個提案實際的結構規模」；`no_action` 移除（那是 Agent 的決定，ArchContext 只報告「無 structural observation」）。
- `RefactorRequestV1` 新增可選 `proposal`（Agent 撰寫的 typed 提案）；無 proposal 的 `scan` 只做量測與 observation，`scale = null`。
- ArchContext 自產的 recommendation 只有 `structural_observation` 類（確定性偵測）；Agent 撰寫的提案以 `refactor_proposal` 類記錄。方案裡「模組 A 與 B 重複實作 serializer」這種語義判斷屬 Agent 層，ArchContext 只負責把該提案判級為 `cross_module` 並在事後驗證兩份實作是否只剩一份。
- `ArchitectureInterventionPayloadV1` 不再由 ArchContext 生成，改為 Agent 撰寫的 `targetDelta`，ArchContext 只驗證其 ID 是否解析到 `.archcontext` node / relation 或已觀察 symbol；任一 `unresolved` → `insufficient_evidence`。
- `createInterventionProposal()` 與 `prepareTask()` 的互動式預設值保留給既有 SOP，`refactor` 路徑不呼叫它們；是否退役另開任務。

### 0.2 採納

- 雙倉分界：脫離 repo-harness 也對其他倉庫有用的量測與判級能力放 ArchContext；涉及 Task / Plan / Contract / Lease / Agent / PR / Campaign 的留在 repo-harness。
- 判級順序「先看證據完整性與 ownership，再看 major change，最後才看 node 數與 LOC」。
- 三個 verb 而非平行命令族；狀態轉換與查詢全部復用現有 `recommendations` 與 `book`。
- `unknown remains unknown`：`refactor scan` 絕不使用 `prepareTask()` 的 `callerCoverage ?? 0.8` / `testsAvailable ?? true` / `rollbackAvailable ?? true` 預設值（`packages/core/application/src/index.ts:68-72`）。
- 「PR merged ≠ resolved」：`resolved` 只能由事後重新量測的 `afterSnapshot` 決定。
- 回歸不改寫歷史：舊 recommendation 保持 `resolved`，新記錄以 `regressesFrom` 關聯。
- 發布順序：上游先凍結 contract 並發布，repo-harness 再更新 exact pin；版本或 feature 不匹配直接 fail closed，不允許 repo-harness 本地 fallback。

### 0.3 對現狀事實的修正

1. **權威措辭必須對齊 ADR-0040。** daemon 預設 rollout mode 是 `yaml`，SQLite ledger 是 operational runtime state，authority matrix 明寫它「不得在 ledger-authoritative 晉級前成為唯一可恢復副本」。本 PRD：相對 repo-harness，ArchContext ledger 是 refactor proposal / observation 狀態的唯一寫入者；相對 `.archcontext/`，它是 Observed / Proposed / Verified 類事實，不覆寫 Declared 事實。
2. **`recommendations resolve --evidence-digest` 目前不存在。** 現行 flags 只有 `--id --reason --actor --actor-kind --source --expected-worktree-digest --agent-job-id --now`（`packages/surfaces/cli/src/main.ts:891-907`）；`--evidence-digest` 只屬於 `practices waive`（`:1926`）。本 PRD 新增：對 `category ∈ {structural_observation, refactor_proposal}` 執行 `resolve` 時 `--evidence-digest` 必填，且必須指向 disposition 為 `resolved` 的 `RefactorResolutionEvidenceV1`；否則 `AC_REFACTOR_EVIDENCE_REQUIRED`。`practice` 類行為不變。
3. **`RecommendationV3` 不能丟掉 v2 的權威欄位。** 方案草案沒有 `enforcement`、`confidence`、`uncertainty`、`explanation`、`practiceId?`（`packages/contracts/src/ledger.ts:617-633`）；`enforcement` 是 checkpoint / complete 閘門依據，刪掉等於廢掉 ADR-0025 通道；`RecommendationFeedbackV1.previousStatus/nextStatus` 型別寫死為 `RecommendationV2["status"]`（`:642-643`）。本 PRD 定義 v3 = v2 嚴格超集，新增 required `category`、`payload`、`subjectSelectorId`、`relations`；status union 抽為共用 `RecommendationStatus`。已核實 repo-harness 不讀 archctx recommendation，v3 沒有外部讀者。
4. **fingerprint / dedup 已經存在。** `recommendationFingerprint()`、`previousActiveByFingerprint`、`duplicate-active-fingerprint` suppression 與 cooldown 在 `packages/core/recommendation-engine/src/index.ts`（`:272-285`、`:415-445`）。真實缺口：fingerprint 輸入含 `practiceId`（非 practice 類沒有）；沒有 `supersedes` / `regressesFrom` 關聯。RF3 縮到這兩項加 v3 遷移。
5. **`subjectSelector` 不要重造。** `ArchitectureSubjectSelectorV1`（`ledger.ts:365-382`）kind 枚舉是方案五種的超集；ownership 歧義已有 `ArchitectureDeltaMappingAmbiguityV1`（`:440-449`）。v3 用 `subjectSelectorId` 引用。
6. **`refactor scan` 需要合法的 event source 與 run 語義。** `ArchitectureEventSource` 閉合枚舉（`ledger.ts:20-31`）無 refactor 項；`recommendations` 表 FK 到 `recommendation_runs` 與 `architecture_events`（`packages/local-runtime/local-store-sqlite/src/index.ts:393-416`）；`RecommendationRunV1.catalogDigest` 對非 practice run 沒有定義。RF3 明列新增 `refactor_scan` source、run 建立與 `catalogDigest := 分類器規則集 digest`。
7. **SCC / fan-in / fan-out / cycle 全部不存在，import edge 只有出邊，truncation 是全局的。** `CapabilityImportGraph` 只按 `scope.has(pair.from)` 收出邊（`packages/local-runtime/codegraph-adapter/src/index.ts:1006-1010`）；`truncated` 是單一全局值複製進每個 node（`:1017,1029`）；全庫無 Tarjan / fanIn / fanOut，pressure engine 只有 2-node 雙向邊啟發式（`packages/core/pressure-engine/src/index.ts:189-195`）。本 PRD：snapshot 一律先算全倉圖（入邊由全部出邊推得），module-level SCC / cycleCount 為 P0，`instability` 與 `directionViolationCount` 為 P1 可 `null`；`graphTruncated` 從 per-module 移到 `codeFacts.truncated` 全局欄位。
8. **§4.1 的重疊規則會把本倉永久鎖進 proof_required。** `component.architecture-context.projection-renderer` 是 `capability.architecture-context` 的 child（`.archcontext/model/nodes/*.yaml` `parent:`），include 天然重疊。規則改為：只有非祖先 / 後代關係的 node 之間重疊才是歧義；祖先 / 後代重疊時檔案歸最深 node。
9. **精確 `lineCount` 在同一 HEAD 上不可重現。** `listScaleScanFiles` 只跳過 `.git` / `node_modules`，`countFileLines` 讀工作樹（`packages/core/projection-engine/src/index.ts:775,793-798`）；`loadCapabilitySourceFootprints` 對沒有 `source.include` 的 node 直接省略（`:759`）。RF1 改用 git-tracked 檔案集合（git-adapter 已有 `readTrackedTreeEntries`），node 無 `source.include` 顯式升為 reason code `node-footprint-undeclared`。
10. **major-change 詞彙表在 ArchContext，不在 repo-harness。** `ARCHITECTURE_MAJOR_CHANGE_REASON_CODES` 定義於 `packages/contracts/src/projection.ts:36-50`，13 個 code，含方案漏列的 `verified-flow-proof-changed`，不含方案新造的「migration target state changed」。`RefactorAssessmentV1.majorChangeReasons` 直接復用。
11. **`ArchitectureInterventionModel` 缺 ADR-0011 要求的 `trigger`、`falsifiers`、`completionCriteria`（`packages/core/architecture-domain/src/index.ts:108-118`），`createInterventionId()` 是任務文本 slug 會撞 ID（`:122-128`）。** 本 PRD 的 `ArchitectureTargetDeltaV1`（Agent 撰寫）補齊三欄、ID 改為 digest。
12. **MCP 不新增工具，且 spec 已漂移。** spec 寫「預設僅暴露 5 個」，實際 `LOCAL_MCP_TOOLS` 有 6 個（`packages/surfaces/mcp-local/src/index.ts:41-72`）。本 PRD 只做 CLI + daemon RPC；spec 漂移另開任務。
13. **三個 verb 今天沒有 RPC 落點，`capabilities` 不走 daemon。** dispatch 表在 `packages/local-runtime/runtime-daemon/src/index.ts:5630-5749`；`capabilities` 由 CLI 進程內計算（`main.ts:216-236`）。RF5 明列新增 RPC method。
14. **版本號是命名決定，不是握手必要。** repo-harness 精確相等比對版本、子集判定 feature（`repo-harness/src/core/architecture/projection.ts:12,204,208`）；本倉已是 `0.4.8`，該 `0.4.7` pin 現在就已過期。選 `0.5.0` 的唯一理由是 recommendation v2→v3 遷移重寫持久化記錄。
15. **`tests` 證據不能推斷。** node schema 沒有 tests selector。`tests.coverageStatus` 在 node 未宣告 `source.tests` 時固定 `unknown`；`testsObserved` 只影響 confidence。
16. **`callerCoverage` 寫死為量測值。** node 邊界上「解析到具體檔案的 inbound edge 數 ÷（已解析 + 未解析 + dynamic）」；index 缺失、`truncated = true` 或 `dynamicInvocation ∈ {known, unknown}` 時為 `null`。

### 0.4 裁掉或延後

- **`refactor verify` runtime 延到 `0.5.1`。** 它依賴 RF1 可重現 digest 與 RF3 關聯，兩者在 0.5.0 才落定；`RefactorResolutionEvidenceV1` contract 在 0.5.0 凍結，feature `refactor-resolution-v1` 到 0.5.1 才出現，repo-harness 以 feature 缺失 fail closed。
- `instability`、`directionViolationCount` 為 P1，0.5.0 可為 `null`。
- 方案的 `opportunities`（含 `duplicate-implementation`、`compatibility-path`）不做：語義判斷屬 Agent 層。ArchContext 只輸出確定性 `observations`。
- 「generated refactor ledger / document projection」延後到 ledger-authoritative 晉級評估；且 `privacy-route-audit` 掃 `packages/surfaces/renderer`（`scripts/privacy-route-audit.mjs:6-26`）。
- 方案 §7.3 的看板狀態屬 repo-harness 聯合投影，不進 ArchContext contract。
- GPT Pro candidate alias、Issue authoring bundle、Cutover Closure、`RefactorProgramV1`、`RefactorExecutionBindingV1` 全部是 Program B 範圍。

---

## Problem

### Product Direction

- Hard Constraints:
  - ArchContext 不生成目標架構、不撰寫重構提案、不替 Agent 決定是否重構。所有 `refactor_proposal` 必須帶 `authoredBy` actor（agent / human），`source ≠ system`。
  - 模組身份只來自 `.archcontext` node 的 `source.include − source.exclude`、declared entrypoints 與 declared relations；不得由目錄結構推斷。祖先 / 後代重疊歸最深 node；非祖先 / 後代重疊為歧義。
  - footprint 以 git-tracked 檔案為集合。
  - 所有 ledger 寫入經 daemon-owned transactional event append（ADR-0040）；`refactor scan` 預設唯讀。
  - ledger artifact 只存 selector、digest、計數、reason code 與 repo-relative path。
  - `docs/architecture` 投影繼續只輸出 1–2–5 量級 bucket（`scaleMagnitudeBucketLabel`，`projection-engine/src/index.ts:814`）。
  - scale 判定順序固定：證據完整性 → ownership 唯一性 → target delta 是否含 major change → 提案觸及 node 數。任一 essential evidence 為 unknown → `insufficient_evidence`；model 缺失、path 無 owner、node 無 `source.include` → `model_adoption_required`。
  - `architecture` scale 只能由 proposal 的 `targetDelta` 對照宣告模型算出的 `majorChangeReasons` 非空觸發；task text heuristic 不影響 scale（heuristic-only 上限 25 分保留，`pressure-engine/src/index.ts:101-103`）。
  - `resolved` 只能由 `RefactorResolutionEvidenceV1.disposition = resolved` 驅動。
- Recommended Defaults:
  - `scan` 無 proposal 時做全倉量測與 observation；有 proposal 時再加 scale 判級。snapshot 一律算全倉圖，proposal scope 只影響 assessment。
  - `record` 寫入 proposal（若有）與 observation；`model_adoption_required` 只記 evidence item。
  - `verify` 對比 recommendation 綁定的 `baselineSnapshotDigest` 與當前 HEAD 的新 snapshot。
- Freedoms:
  - SCC 演算法、digest canonicalization、SQLite 表結構；`--scope` / `--proposal` 捷徑 flag。

### Feasibility Boundary

- Confirmed:
  - footprint 量測已存在但需改資料來源：`loadCapabilitySourceScaleSignals` / `loadCapabilitySourceFootprints`（`projection-engine/src/index.ts:733,756`）。
  - import edge 已存在但只有出邊、全局 truncated（`:245-253`；`codegraph-adapter/src/index.ts:524,547,1006-1029`）。
  - `CodeFactsPort` 提供 `getImpact` / `getCallers` / `getCallees` / `resolveEvidence`（`packages/contracts/src/ports.ts:123-132`）。
  - recommendation fingerprint / dedup / cooldown 已存在；9 個 status 與顯式 feedback 已存在（`ledger.ts:617-656`）。
  - `ArchitectureSubjectSelectorV1`、`ArchitectureDeltaMappingAmbiguityV1`、`EvidenceBinding/v1` 可復用。
  - 現有 major-change 偵測：`ARCHITECTURE_MAJOR_CHANGE_REASON_CODES` 與其校驗（`projection.ts:36-50,313`）可直接用於 `targetDelta` 對照。
  - CLI verb 現況：`prepare`、`checkpoint`、`recommendations`、`book`、`investigate`、`audit`、`capabilities`；無 `refactor`。
  - 下游 handshake 模式可直接復用（`repo-harness/src/core/architecture/projection.ts`、`src/effects/architecture/archctx-provider.ts`）。
- [UNKNOWN]:
  - `paths:<set>` 內部分 path 無 owner，是整體 `model_adoption_required` 還是只降級子集（暫定整體 fail closed）。
  - v2→v3 遷移後 `ledger rebuild` replay 是否與遷移前 digest 一致。
  - `targetDelta` 的最小表達形式：是否直接復用 projection accept 的 accepted-change 結構，還是新型別。
- [UNVERIFIED]:
  - CodeGraph `1.5.0` 在大型 monorepo 的 `truncated` 頻率。

---

## Users

### Primary Users

- User: coding agent（透過 repo-harness Refactor Mode 或直接用 CLI）
  - Need: 在動手前用 `refactor scan` 拿到「這個提案實際動幾個 node、有沒有改宣告模型、證據夠不夠」；改完後用 `verify` 證明結構真的改善。
  - Success signal: Agent 不需要自己數 LOC、畫 import graph 或猜 module 邊界；證據不足時儀器直接說缺什麼。
- User: repo-harness Refactor Mode（機器消費者）
  - Need: 以 exact-version CLI 拿到可校驗 digest 的 snapshot、assessment、recommendation 與 resolution evidence，把 scale 映射到 Work Package / Sprint / 人工審批。
  - Success signal: repo-harness 內零統計器、零 cycle detector、零 refactor score、零第二 ledger。

### Secondary Users

- User: 本地開發者
  - Need: `archctx book recommendations --open --explain` 看見 observation 與 proposal 的 scale、證據、解決狀態。
  - Success signal: `book` 能解釋為什麼是 `insufficient_evidence`（缺哪一項）。

---

## Success Criteria

| Metric | Target | Measurement Method | Degradation Threshold |
|---|---:|---|---:|
| Snapshot determinism | 100% | 同 model / HEAD / index 連跑兩次 `refactor scan --json`，比對 `snapshotDigest` 與完整 JSON bytes | < 100% 阻塞發布 |
| Footprint reproducibility | 100% | include glob 內放入未追蹤 `dist/` 檔案後重跑，`lineCount` 不變 | 任一變動阻塞 |
| Fail-closed scale | 100% | incomplete-evidence fixture（缺 index、truncated、非父子重疊、unowned path、undeclared include）全部得到 `insufficient_evidence` 或 `model_adoption_required` | 任一得到 module / cross_module / architecture 即阻塞 |
| No self-authored proposals | 100% | ledger 中 `category = refactor_proposal` 的記錄 `authoredBy.source ≠ system` | 任一違反阻塞 |
| Heuristic isolation | 100% | task-text-only fixture 的 assessment `scale` 與無 task text 時相同 | 同上 |
| Resolve gate（0.5.1） | 100% | 無 evidence、disposition ≠ resolved、HEAD 漂移三種情況下 `recommendations resolve` 必被拒絕 | 同上 |
| Docs churn | 0 | RF1 落地後 `archctx docs plan --json`，`docs/architecture` owned region 無 drift | > 0 即回退 |
| Recommendation dedup | 100% | 同一 `snapshotDigest` 連續 `record` 兩次，數量不變且第二次回 `duplicate-active-fingerprint` | 出現重複即阻塞 |
| v2→v3 migration replay | 100% | 遷移前後 `ledger rebuild` digest 對照一致 | 不一致阻塞 0.5.0 |

---

## Acceptance Scenarios

### S1 Agent 提案落在單一 node，被判為 module

- Given: fixture 倉有 3 個非父子 node；Agent 提交 proposal，scope 為 `capability.a` 內的 paths，無 `targetDelta`；index ready、`codeFacts.truncated = false`、無 unowned path。
- When: `archctx refactor scan --request-json '{"scope":{...},"proposal":{...}}'`
- Then: `assessment.scale = module`，`affectedNodeIds = ["capability.a"]`，`majorChangeReasons = []`。
- Machine-checkable evidence: `single-module.fixture` 斷言 scale 與 `assessmentDigest`。

### S2 Agent 提案跨兩個 node 但不改宣告模型，被判為 cross_module

- Given: Agent 判斷 `capability.a` 與 `capability.b` 各有一份 serializer 要收斂到 a；proposal scope 含兩個 node 的 paths，`targetDelta` 為空，`killList` 指向 b 內的 symbol selector。
- When: `refactor scan`。
- Then: `scale = cross_module`，`affectedNodeIds` 含 a、b，`majorChangeReasons = []`；ArchContext 不評價「是否重複」，只判規模。
- Machine-checkable evidence: `cross-module.fixture`；`payload.scale = cross_module`。

### S3 Agent 提案改變 owner，被判為 architecture

- Given: Agent 提交 `targetDelta`：新建 `capability.c` 作為唯一 lifecycle owner、刪除 a→b relation；所有 ID 解析成功。
- When: `refactor scan`。
- Then: `scale = architecture`，`majorChangeReasons ⊇ ["ownership-changed","relation-changed"]`，`targetDelta.unresolvedTargets = []`，`interventionId` 由 digest 派生。
- Machine-checkable evidence: `architecture-owner-change.fixture`；斷言 assessment 不含任何 ArchContext 自造的 target 字串。

### S4 事後驗證才能 resolved（0.5.1）

- Given: S1 的 proposal 已 `record`，`baselineSnapshotDigest = D0`；下游已合併 PR，當前 HEAD 為 H1。
- When: `archctx refactor verify --request-json '{"recommendationId":"...","expectedHeadSha":"H1"}'` 後 `archctx recommendations resolve --id ... --reason ... --evidence-digest <resolutionDigest>`。
- Then: verify 產出 `afterSnapshotDigest = D1`、`disposition = resolved`；resolve 成功並寫入 `RecommendationFeedbackV1`。
- Machine-checkable evidence: `book evidence <recommendationId>` 列出 resolution evidence；`book recommendations --open` 不再包含該 id。

### S5（negative）證據不足不得猜規模

- Given: 五個子案例：index 缺失；`truncated = true`；兩個非父子 node include 同一檔案；某 path 不屬任何 node；某 node 無 `source.include`。
- When: `refactor scan`（含 proposal）。
- Then (must NOT): `scale ∉ {module, cross_module, architecture}`；前三者 `insufficient_evidence`，後兩者 `model_adoption_required`，`scaleReasonCodes` 指出缺項。
- Machine-checkable evidence: `incomplete-evidence.fixture` 五子案例。

### S6（negative）merged 但未改善不得 resolved（0.5.1）

- Given: proposal 的 targetOutcome 為 `crossModuleCycleCount less_than 1`；after snapshot 仍為 1。
- When: `refactor verify` 後嘗試 `recommendations resolve --evidence-digest ...`。
- Then (must NOT): resolve 不得成功；`disposition = not_improved`，回 `AC_REFACTOR_EVIDENCE_REQUIRED`，status 保持 `accepted`。
- Machine-checkable evidence: `resolution-not-improved.fixture`。

### S7（negative）ArchContext 不得自造提案或目標架構

- Given: `scan` 無 proposal；observed graph 有一個跨 node cycle。
- When: `refactor scan` 後 `refactor record`。
- Then (must NOT): ledger 只新增一筆 `category = structural_observation`（kind `cycle`），不得出現任何 `category = refactor_proposal` 記錄，也不得出現 `targetDelta`；`assessment.scale = null`。
- Machine-checkable evidence: `observation-only.fixture`；`jq '[.recommendations[] | select(.category == "refactor_proposal")] | length == 0'`。

---

## Non-goals

- 不替 Agent 決定是否重構；不生成目標架構、kill list 或遷移計畫；不做語義層的「重複實作」「兼容層」判斷。
- 不在 ArchContext 內建立 Task、Plan、Contract、Lease、WorkEnvelope、PR、Issue 或 Campaign；不知道什麼是「main」。
- 不新增 MCP tool；不新增 `archctx refactor` 以外的命令族；不新增 GitHub Issue writer。
- 不把精確計數寫進 `docs/architecture`；不新增 Git 追蹤的 refactor 文檔投影。
- 不修改 `prepareTask()` / `createInterventionProposal()` 的既有 SOP 行為；只保證 `refactor` 路徑不呼叫它們。
- 不修 spec.md 的 MCP 工具數漂移（另開任務）。
- 不實作 repo-harness 側的 scale 映射、看板、GPT Pro alias。
- 不做跨倉庫統計。

---

## Module Behaviors (P0)

### RF0 — Characterization Freeze

- Purpose: 改動任何判定行為前，用 fixture 凍結現行 scale loader、import graph、CodeGraph handshake、pressure engine、`decidePosture`、recommendation-engine fingerprint / dedup、architecture ledger 與 recommendation lifecycle 的輸出。
- Hard Constraints: 不改變任何現有輸出；`evals/run.ts --check` 基線不變；`docs/architecture` bucket 輸出 byte 不變。
- Recommended Defaults: fixture 放對應 package 的 `test/fixtures/refactor-baseline/`；以 digest 斷言。
- Freedoms: 可拆多個 test 檔。
- Normal path: 新增 test → 全綠 → 作為 RF1–RF4 回歸護欄。
- Failure path 1: 發現現行行為不確定（工作樹生成物影響 lineCount）→ 記錄為 RF1 輸入，不在 RF0 修。
- Failure path 2: fixture 觸發 `privacy-route-audit` 字面掃描 → 用片段拼接 needle。
- States: Empty: 無 fixture；Ready: 全部綁 digest；Error: 任一 digest 漂移。
- Dependencies: 無。
- Open decisions: None

### RF1 — Module Statistics Snapshot

- Purpose: 產出 `ModuleStatisticsSnapshotV1`：每個 node 的精確 footprint、surfaces、dependencyGraph、tests、uncertainty，加 repositorySummary 與 deterministic digest。
- Hard Constraints:
  - 模組 = node；ownership 由 `source.include − exclude` 對 git-tracked 檔案集合決定；祖先 / 後代重疊歸最深 node；非祖先 / 後代重疊 → `ambiguousOwnership = true` 並計入 `multiplyOwnedFileCount`。
  - node 無 `source.include` → 該 node `footprintDeclared = false`，`repositorySummary.undeclaredFootprintNodeCount` 非零。
  - index 缺失不得回傳零值；`codeFacts.coverage = unknown`、`truncated = true`，dependencyGraph 全 `null`。
  - 全倉圖一次計算：出邊來自 codegraph-adapter，入邊由全部出邊反推；module-level SCC / cycleCount 為 P0；`instability`、`directionViolationCount` 為 P1 可 `null`。
  - `tests.coverageStatus` 在 node 無 `source.tests` selector 時固定 `unknown`；`callerCoverage` 依 §0.3 第 16 條計算。
  - 不寫入 raw source；path 一律 repo-relative POSIX；`snapshotDigest` 排除 timestamp。
- Recommended Defaults: 復用 `readTrackedTreeEntries`；SCC 用 Tarjan。
- Freedoms: SQLite 表結構；per-HEAD snapshot 快取。
- Normal path: `ensureReady` → 解析 model → tracked files ∩ selectors → footprint → 出邊 → 反推入邊 → module graph → SCC → snapshot + digest。
- Failure path 1: model 缺失 → `AC_MODEL_ADOPTION_REQUIRED`，不輸出 snapshot。
- Failure path 2: index 缺失 / truncated → snapshot 輸出但 `coverage ≠ complete`。
- States: Empty: 無 node；Loading: `ensureReady` 未完成；Ready: digest 已計算；Error: model 解析失敗。
- Dependencies: RF0。
- Open decisions: None

### RF2 — Assessment: Observations and Proposal Scale

- Purpose: 由 snapshot 產出確定性 `observations`；若 request 帶 `proposal`，再對其判 `scale`，輸出 `RefactorAssessmentV1`。
- Hard Constraints:
  - `observations` 只允許閉合、確定性的 kind：`cycle`、`ownership-ambiguous`、`unowned-paths`、`undeclared-footprint`、`evidence-gap`、`direction-violation`（P1）。每筆帶 `subjectSelectorId` 與 `signalIds`。不得輸出語義判斷類 kind。
  - `scale` 判定順序固定（見 Product Direction）；無 proposal 時 `scale = null`。
  - `majorChangeReasons` 由 proposal 的 `targetDelta` 對照宣告模型計算，型別 = `ArchitectureMajorChangeReasonCode`；`targetDelta` 為空則 `[]`。
  - `affectedNodeIds` 由 proposal scope 的 paths 對 ownership 解析得出；任一 path 無 owner → `model_adoption_required`（暫定）。
  - `targetDelta` 內任一 node / relation / symbol ID 無法解析到 `.archcontext` 或已觀察 symbol → `unresolvedTargets` 非空 → `scale = insufficient_evidence`，reason `target-unresolved`。
  - Essential evidence（決定 `scale` 的三項，缺一即 fail closed）：(1) proposal 相關的每個 node 都 `footprintDeclared = true`，否則 `model_adoption_required` + `node-footprint-undeclared`；(2) 每個 `scopePaths` 恰好解析到一個最深 owner，無 owner → `model_adoption_required` + `unowned-paths`，非祖先／後代競爭 → `insufficient_evidence` + `ownership-ambiguous`；(3) `codeFacts.coverage = complete`，`unknown` → `code-facts-missing`，`partial` → `code-facts-truncated`。`tests.callerCoverage`、`testsObserved`、`rollbackObserved` **不是** essential：v1 三者恆為 `null`（node/v2 無 `source.tests`；import edge 看不見 dynamic invocation；rollback 只有 Agent 文本），列為 essential 會讓所有提案都判 `insufficient_evidence`。`caller-coverage-unknown` 只進 `scaleReasonCodes` 與 `confidence`，不選分支；帶 proposal 的 assessment 在 v1 因此最高只到 `confidence.level = medium`。
  - `unresolvedTargets` 只由 `targetState.owners` 的 value、`removedConcepts` 條目與 `completionCriteria[].nodeId` 產生。`requiredRelations` 中未宣告的 relation 是「要新建」而非 unresolved；`killList` 在 `targetDelta` 之外，其 symbol / path selector 由 RF4 `verify` 解析，RF2 不解析（v1 `surfaces.observedEntrypoints` 恆為 `[]`）。
  - `majorChangeReasons` v1 只導出 `ownership-changed`、`relation-changed`、`node-removed`。`node-added` 不可導出（未解析的 node id 一律進 `unresolvedTargets`，否則打錯的 id 會 fail open）；`lifecycle-changed` 不可導出（`owners` 的 key 是自由文本 role label，node/v2 無宣告的 role→owner 映射）；`migrationState` 不貢獻任何 code。
  - RF2 不呼叫 `detectArchitecturePressure`：其 observed 判定對 path／symbol 字串做 regex，且 `multiple-lifecycle-owner` 會把 `task` 文本折進 observed signal。`pressure` 改由 RF2 自己的 observations 依 pressure-engine 的權重（25／15／5，上限 100）與門檻（60／30）計算；`request.task` 在 RF2 完全不被讀取，heuristic-isolation fixture 因此斷言完整 `assessmentDigest` 相等。
  - `RefactorProposalV1.scopePaths` 是 repo-relative 的**檔案**路徑清單（不接受目錄或 glob）；目錄或 glob 條目一律視為 unowned path → `model_adoption_required` + `unowned-paths`。Program B 送入 proposal 前必須展開成檔案。
  - `RefactorScaleReasonCode` 閉合枚舉，至少含：`code-facts-missing`、`code-facts-truncated`、`ownership-ambiguous`、`unowned-paths`、`node-footprint-undeclared`、`caller-coverage-unknown`、`target-unresolved`、`single-node-scope`、`multi-node-scope`、`major-change-detected`。
- Recommended Defaults: `evidence-gap` observation 在 `coverage ≠ complete` 時必出。
- Freedoms: observation 排序；reason code 補充項。
- Normal path: 讀 snapshot → observations → 若有 proposal：完整性 → ownership → targetDelta 對照 → node 數 → assessment + digest。
- Failure path 1: `coverage ≠ complete` 且有 proposal → `insufficient_evidence`，`unresolvedEvidence` 列缺項。
- Failure path 2: proposal scope node 不存在 → `AC_SCHEMA_INVALID`。
- States: Ready: 有 observations（與 scale）；Error: request 無效。
- Dependencies: RF1；`packages/core/pressure-engine`（僅取 observed signal）。
- Open decisions: `paths:` 子集降級策略；`targetDelta` 是否復用 accepted-change 結構（見 Known Unknowns）。

### RF3 — Recommendation V3 and Ledger Recording

- Purpose: 把 observations 與 Agent proposal 物化為 `RecommendationV3` 寫入 ledger；擴充既有 fingerprint 輸入、新增 `supersedes` / `regressesFrom`、完成 v2→v3 遷移。
- Hard Constraints:
  - `schemaVersion = archcontext.recommendation/v3`，欄位 = v2 全部欄位 + required `category ∈ {practice, structural_observation, refactor_proposal}`、`payload`、`subjectSelectorId`、`relations`；`RecommendationStatus` 抽為共用 union，`RecommendationFeedbackV1` 改引用。
  - `refactor_proposal` 必帶 `authoredBy: {kind, id, source}`，`source ∈ {cli, mcp, manual, subagent}`，不得為 `system` / `daemon`；`structural_observation` 的 `authoredBy.source = daemon`。
  - `enforcement`：`practice` 不變；`structural_observation` → `advisory`；`refactor_proposal` 依 scale：`architecture` → `complete`，其餘 → `checkpoint`。
  - fingerprint 輸入從 `practiceId` 泛化為 `category + subjectSelectorId + payload 穩定子集`；復用 `recommendationFingerprint()` 與既有 suppression。
  - `resolved` 不可改回 `open`；同 fingerprint 再出現 → 新記錄 + `relations.regressesFrom`。
  - 新增 `ArchitectureEventSource = "refactor_scan"`；每次 `record` 建一筆 `RecommendationRunV1`，`catalogDigest := 分類器規則集 digest`。
  - `record` 需 `--expected-worktree-digest` 與 assessment 綁定 HEAD 一致；漂移 → `AC_REFACTOR_STALE`。
  - v2 記錄處置：`ledger migrate` 一次性 v2→v3 升級（`category = practice`，`subjectSelectorId` 由既有 `subject` 建 selector）；升級後讀路徑只認 v3；相容窄口只在 migration 命令、有測試、移除路徑 `0.6.0`。
  - `recommendations resolve` 對 `structural_observation` / `refactor_proposal` 要求 `--evidence-digest`（0.5.0 加 flag 與檢查；0.5.1 前沒有合法 evidence，等於這兩類在 0.5.0 不可 resolve，符合 shadow 模式）。
- Recommended Defaults: `record` 寫 observations 與 proposal；`model_adoption_required` 只記 evidence item。
- Freedoms: 事件表命名；FTS。
- Normal path: `refactor record --assessment-digest --expected-worktree-digest` → daemon 取暫存 assessment → 建 run → dedup → append events → 回傳 id 列表。
- Failure path 1: assessment digest 找不到 → `AC_SCHEMA_INVALID`，提示重跑 scan。
- Failure path 2: HEAD 漂移 → `AC_REFACTOR_STALE`。
- States: Empty；Ready；Error。
- Dependencies: RF2；`ledger.ts`；`recommendation-engine`；`local-store-sqlite` migration。
- Open decisions: None

### RF4 — Before / After Resolution Verification（runtime 在 0.5.1）

- Purpose: 對 recommendation 重新量測，產出 `RefactorResolutionEvidenceV1`，評估 `targetOutcomes` 與 `killList`，給出 disposition。contract 在 0.5.0 凍結，runtime 與 feature `refactor-resolution-v1` 在 0.5.1。
- Hard Constraints:
  - `beforeSnapshotDigest` 必等於 recommendation 的 `baselineSnapshotDigest`；否則 `stale`。
  - `expectedHeadSha` 與當前 HEAD 不一致 → `AC_REFACTOR_STALE`。
  - disposition：全部 outcome 達成且 required kill-list 為 absent → `resolved`；部分 → `partially_resolved`；無一 → `not_improved`；任一反向惡化 → `regressed`；base 漂移 → `stale`。
  - `structural_observation` 的 outcome 由 ArchContext 依 kind 派生（如 `cycle` → `cycleCount less_than 1`）；`refactor_proposal` 的 outcome 來自 Agent 撰寫的 `targetOutcomes`，ArchContext 只評估。
  - evidence 經 `EvidenceBinding/v1` 綁定，屬 Verified 類；不存 raw diff；`executionEvidenceRefs` 只存 kind / locator / sha256。
  - after snapshot `coverage ≠ complete` → disposition 不得為 `resolved`。
- Recommended Defaults: `verify` 同時把新 snapshot 存為 ledger snapshot。
- Freedoms: outcome operator 擴充。
- Normal path: 讀 recommendation → 確認 HEAD → 跑 RF1 → 對比 → 寫 evidence → 回 `resolutionDigest`。
- Failure path 1: 已 `resolved` / `superseded` → 回既有 evidence。
- Failure path 2: coverage 不完整 → `partially_resolved` + `residuals`。
- States: Ready；Error。
- Dependencies: RF1、RF3。
- Open decisions: None

### RF5 — CLI, RPC, Capabilities and Release

- Purpose: 暴露 `archctx refactor scan|record`（0.5.0）與 `verify`（0.5.1），新增 daemon RPC，擴充 capabilities feature，完成發布與 npm readback。
- Hard Constraints:
  - CLI 只做參數解析與 envelope；verb 對應 RPC `refactorScan` / `refactorRecord` / `refactorVerify`，加入 dispatch 表（`runtime-daemon/src/index.ts:5630-5749`）與 `RuntimeRpcClient`；scan / verify 歸 `RUNTIME_RPC_LONG_METHODS`。
  - `ARCHCTX_FEATURES`（`projection.ts:58-64`）0.5.0 新增 `module-statistics-v1`、`refactor-assessment-v1`、`recommendation-v3`；0.5.1 新增 `refactor-resolution-v1`。
  - `help` 的 `commands` 與 `examples` 同步加入 `refactor`。
  - 版本號掃描：`rg '0\.4\.8'` 到空後才能 tag；`catalog.yaml` digest 重算；clean-room readback 重跑。
  - `record` / `verify` 各為單一 store transaction；RPC timeout 後不自動重放。
- Recommended Defaults: `scan --json` 輸出 `{ snapshot, assessment, proposedRecommendations }` 一個 envelope。
- Freedoms: `--scope` / `--proposal` 捷徑 flag。
- Normal path: `bun run verify` 全綠 → bump → publish → readback。
- Failure path 1: `packaged-cli-smoke` 未覆蓋 `refactor` → 補 smoke。
- Failure path 2: readback 發現 features 缺項 → 撤回 dist-tag。
- States: Ready: `capabilities --json` 含對應批次 feature。
- Dependencies: RF3（0.5.0）；RF4（0.5.1）。
- Open decisions: None

---

## Data Model

Fact class 對應（ADR-0040 authority matrix）：`ModuleStatisticsSnapshotV1` = Observed；`RefactorAssessmentV1` = Proposed（`requestId` 為 proposal ID，`assessmentDigest` 為 idempotency key）；`RecommendationV3` = Proposed，經顯式 feedback 推進 lifecycle，只能經 `EvidenceBinding/v1` 升級；`RefactorResolutionEvidenceV1` = Verified。所有 digest 為 `sha256:<64-hex>`。

```jsonc
{
  "version": "1",
  "entities": [
    {
      "id": "RefactorRequestV1",
      "owner": "caller (agent / repo-harness / human)",
      "fields": {
        "schemaVersion": "archcontext.refactor-request/v1",
        "scope": "{kind:'repository'} | {kind:'node',nodeId} | {kind:'paths',paths[]}",
        "proposal": "RefactorProposalV1?", // 無則只做量測與 observation
        "expectedHeadSha": "string?",
        "expectedWorktreeDigest": "string?",
        "task": "string?" // 僅供 advisory heuristic signal，不影響 scale
      }
    },
    {
      "id": "RefactorProposalV1",
      "owner": "agent / human (Proposed)",
      "fields": {
        "schemaVersion": "archcontext.refactor-proposal/v1",
        "authoredBy": "{kind: ArchitectureActorKind, id, source:'cli'|'mcp'|'manual'|'subagent'}",
        "intent": "string", // 一句話，不解析
        "scopePaths": "string[]", // repo-relative POSIX
        "targetDelta": "ArchitectureTargetDeltaV1?", // 有則可能觸發 architecture scale
        "targetOutcomes": "RefactorTargetOutcomeV1[]",
        "killList": "Array<{kind:'path'|'symbol'|'relation', selectorId, required}>",
        "proposalDigest": "string"
      }
    },
    {
      "id": "ArchitectureTargetDeltaV1",
      "owner": "agent / human (Proposed)",
      "fields": {
        "interventionId": "string", // intervention.<digestSuffix>
        "trigger": "string[]", // Agent 陳述的觸發理由，不解析
        "thesis": "string",
        "targetState": "{owners: Record<nodeId, nodeId>, requiredRelations: relationId[], removedConcepts: selectorId[]}",
        "migrationState": "{active, compatibilityContracts[], cleanupBy?, temporaryRelations[]}",
        "completionCriteria": "RefactorTargetOutcomeV1[]",
        "falsifiers": "string[]",
        "benefitLedger": "{benefits[], costs[], rollbackPoint}",
        "unresolvedTargets": "string[]" // 由 ArchContext 填寫；非空 → insufficient_evidence
      }
    },
    {
      "id": "ModuleStatisticsSnapshotV1",
      "owner": "archctx daemon (Observed)",
      "fields": {
        "schemaVersion": "archcontext.module-statistics/v1",
        "repository": "{repositoryId}",
        "worktree": "{workspaceId, branch, headSha, worktreeDigest}",
        "modelDigest": "string",
        "codeFacts": "{provider:'codegraph', version, binaryDigest, indexedWorktreeDigest|null, coverage:'complete'|'partial'|'unknown', truncated, edgeLimit, reasonCodes[]}",
        "modules": "ModuleStatisticsV1[]",
        "repositorySummary": "{moduleCount, undeclaredFootprintNodeCount, ownedFileCount, unownedFileCount, multiplyOwnedFileCount, crossModuleEdgeCount, crossModuleCycleCount, stronglyConnectedComponentCount, unresolvedImportCount, dynamicInvocationRiskCount}",
        "snapshotDigest": "string"
      }
    },
    {
      "id": "ModuleStatisticsV1",
      "owner": "archctx daemon (Observed)",
      "fields": {
        "nodeId": "string",
        "nodeDigest": "string",
        "parentNodeId": "string|null",
        "footprintDeclared": "boolean",
        "footprint": "{fileCount, lineCount, sourceFilesDigest, includePatterns[], excludePatterns[]}|null",
        "surfaces": "{declaredEntrypoints[], observedEntrypoints[], lifecycleOwners[], datastoreSubjects[]}",
        "dependencyGraph": "{internalEdgeCount, inboundModuleEdges, outboundModuleEdges, fanIn, fanOut, stronglyConnectedComponentId|null, cycleCount, instability|null /*P1*/, directionViolationCount|null /*P1*/}|null",
        "tests": "{testFileCount|null, observedTestEdges|null, callerCoverage|null, coverageStatus:'measured'|'partial'|'unknown'}",
        "uncertainty": "{unresolvedImports, dynamicInvocation:'none_observed'|'possible'|'known'|'unknown', ambiguousOwnership}",
        "moduleDigest": "string"
      }
    },
    {
      "id": "RefactorAssessmentV1",
      "owner": "archctx daemon (Proposed)",
      "fields": {
        "schemaVersion": "archcontext.refactor-assessment/v1",
        "requestId": "string",
        "statisticsSnapshotDigest": "string",
        "modelDigest": "string",
        "codeFactsDigest": "string",
        "requestedScope": "RefactorRequestV1.scope",
        "proposalDigest": "string|null",
        "observations": "Array<{kind:'cycle'|'ownership-ambiguous'|'unowned-paths'|'undeclared-footprint'|'evidence-gap'|'direction-violation', subjectSelectorId, signalIds[], metrics}>",
        "scale": "'module'|'cross_module'|'architecture'|'insufficient_evidence'|'model_adoption_required'|null",
        "scaleReasonCodes": "RefactorScaleReasonCode[]",
        "affectedNodeIds": "string[]",
        "majorChangeReasons": "ArchitectureMajorChangeReasonCode[]", // 由 targetDelta 對照宣告模型計算
        "pressure": "{level, score, signalIds[]}", // 僅 observed / verified signal
        "confidence": "{level, callerCoverage|null, testsObserved|null, rollbackObserved|null, unresolvedEvidence[]}",
        "assessmentDigest": "string"
      }
    },
    {
      "id": "RecommendationV3",
      "owner": "archctx ledger (Proposed → lifecycle)",
      "fields": {
        "schemaVersion": "archcontext.recommendation/v3",
        "recommendationId": "string", // recommendation.<digestSuffix(fingerprint)>
        "runId": "string",
        "fingerprint": "string",
        "subject": "string", // v2 保留
        "practiceId": "string?", // v2 保留
        "status": "RecommendationStatus", // 9 個既有值
        "confidence": "'low'|'medium'|'high'", // v2 保留
        "enforcement": "'advisory'|'checkpoint'|'complete'", // v2 保留
        "risk": "'low'|'medium'|'high'", // v2 保留
        "uncertainty": "'low'|'medium'|'high'", // v2 保留
        "evidenceBindingIds": "string[]", // v2 保留
        "explanation": "string[]", // v2 保留
        "category": "'practice'|'structural_observation'|'refactor_proposal'", // 新增 required
        "authoredBy": "{kind, id, source}", // 新增 required；refactor_proposal 的 source ≠ system/daemon
        "subjectSelectorId": "string", // 新增 required
        "payload": "PracticeRecommendationPayloadV1 | StructuralObservationPayloadV1 | RefactorProposalPayloadV1", // 新增 required
        "relations": "{supersedes?: string, regressesFrom?: string}",
        "createdAt": "datetime",
        "updatedAt": "datetime"
      }
    },
    {
      "id": "StructuralObservationPayloadV1",
      "owner": "archctx ledger",
      "fields": {
        "assessmentDigest": "string",
        "kind": "observation kind",
        "affectedNodeIds": "string[]",
        "baselineSnapshotDigest": "string",
        "derivedOutcomes": "RefactorTargetOutcomeV1[]" // 由 kind 確定性派生
      }
    },
    {
      "id": "RefactorProposalPayloadV1",
      "owner": "archctx ledger",
      "fields": {
        "assessmentDigest": "string",
        "proposalDigest": "string",
        "scale": "RefactorScale",
        "affectedNodeIds": "string[]",
        "majorChangeReasons": "ArchitectureMajorChangeReasonCode[]",
        "baselineSnapshotDigest": "string",
        "targetDelta": "ArchitectureTargetDeltaV1?",
        "targetOutcomes": "RefactorTargetOutcomeV1[]", // 來自 Agent
        "killList": "同 RefactorProposalV1"
      }
    },
    {
      "id": "RefactorResolutionEvidenceV1",
      "owner": "archctx ledger (Verified)",
      "fields": {
        "schemaVersion": "archcontext.refactor-resolution-evidence/v1",
        "recommendationId": "string",
        "recommendationDigest": "string",
        "beforeSnapshotDigest": "string",
        "afterSnapshotDigest": "string",
        "verifiedHeadSha": "string",
        "verifiedWorktreeDigest": "string",
        "expectedOutcomes": "RefactorTargetOutcomeV1[]",
        "observedOutcomes": "RefactorObservedOutcomeV1[]",
        "residuals": "Array<{code, subject, severity}>",
        "executionEvidenceRefs": "Array<{kind:'task_contract'|'cutover_closure'|'acceptance_receipt'|'merge_receipt', locator, sha256}>",
        "disposition": "'resolved'|'partially_resolved'|'not_improved'|'regressed'|'stale'",
        "resolutionDigest": "string"
      }
    }
  ],
  "relationships": [
    "RefactorAssessmentV1.statisticsSnapshotDigest → ModuleStatisticsSnapshotV1.snapshotDigest",
    "RefactorAssessmentV1.proposalDigest → RefactorProposalV1.proposalDigest",
    "RecommendationV3.payload.assessmentDigest → RefactorAssessmentV1.assessmentDigest",
    "RecommendationV3.subjectSelectorId → ArchitectureSubjectSelectorV1.selectorId（既有）",
    "RecommendationV3.runId → RecommendationRunV1（trigger.source = refactor_scan）",
    "RefactorResolutionEvidenceV1.recommendationId → RecommendationV3.recommendationId",
    "RefactorResolutionEvidenceV1 → EvidenceBinding/v1 → RecommendationV3.evidenceBindingIds",
    "RecommendationV3.relations.regressesFrom → 舊 RecommendationV3（保持 resolved）"
  ]
}
```

新增錯誤碼（`packages/contracts/src/schema.ts` `ArchContextErrorCode`）：`AC_MODEL_ADOPTION_REQUIRED`、`AC_REFACTOR_STALE`、`AC_REFACTOR_EVIDENCE_REQUIRED`、`AC_REFACTOR_PROPOSAL_UNAUTHORED`（proposal 缺 `authoredBy` 或 source 為 system / daemon）。既有 `AC_SCHEMA_INVALID`、`AC_CAPABILITY_UNSUPPORTED` 沿用。

---

## Performance Targets

| Target | Number | Measurement Method | Degradation Threshold |
|---|---:|---|---:|
| `refactor scan` on this repo（index ready） | ≤ 30 s | `time archctx refactor scan --json` 三次取中位數 | 60 s |
| `refactor scan` on 20-node fixture | ≤ 60 s | 同上，fixture 倉 | 120 s |
| `refactor verify` | ≤ scan + 5 s | 同上 | +15 s |
| snapshot JSON size（20 node） | ≤ 256 KB | `wc -c` | 1 MB |
| `docs plan` drift after RF1 | 0 owned region | `archctx docs plan --json` | 任一非零即回退 |

---

## Known Unknowns

| Item | Impact | Resolution Path | Owner |
|---|---|---|---|
| [UNKNOWN] `paths:` scope 部分無 owner 時整體 fail closed 是否過嚴 | Agent 對混合路徑集合拿不到 scale | RF2 先整體 `model_adoption_required`；dogfood 兩週後決定是否加 `ownedSubset` | Maintainer |
| ~~[UNKNOWN] `targetDelta` 是否復用 accepted-change 結構~~ **[RESOLVED, RF1a]** `ArchitectureTargetDeltaV1` 已在 `archctx-contracts@0.5.0` 凍結為獨立型別；只復用 `ARCHITECTURE_MAJOR_CHANGE_REASON_CODES` 詞彙表，不復用 `classifyArchitectureMajorChange`（它需要兩份完整 `ArchitectureSemanticStateV1` 與 diagram proof compilation，等於要 ArchContext 自造目標模型，違反 §0.1） | — | — | Maintainer |
| [UNKNOWN] v2→v3 migration 後 `ledger rebuild` replay 一致性 | 不一致則 0.5.0 不能宣稱 ledger 可重建 | RF3 驗收加入對照腳本 | Maintainer |
| [UNVERIFIED] CodeGraph `1.5.0` 在大倉的 `truncated` 頻率與 `edgeLimit` | `insufficient_evidence` 比例過高會讓儀器不可用 | RF1 在本倉與一個外部 fixture 倉實測 | Maintainer |
| [UNKNOWN] 本倉 model 只有 capability + child component | dogfooding 無法驗證 cross_module / architecture scale | RF2 前另開 model adoption 任務把 `packages/core/*` 拆為獨立 node | Maintainer |
| [UNKNOWN] `source.tests` selector 進 node/v2 還是等 node/v3 | 影響 `tests` 何時能離開 `unknown` | RF1 以 `unknown` 交付；進 schema 需 ChangeSet 與 ADR | Maintainer |
| [UNKNOWN] 0.5.1 與 0.5.0 的間隔 | 過長會讓 repo-harness shadow 期無法驗證 resolve 路徑 | Sprint 把 RF4 排在 RF5(0.5.0) 之後立即開始，目標兩週內 | Maintainer |
| [UNKNOWN] 外部 research provider（如 GPT Pro）撰寫的 proposal 如何標 provenance | 0.5.0 只能以 `developer→manual`（人簽署）或 `subagent→subagent`（harness agent 採納並負責）提交，來源寫在 `intent`；無一等 provenance 欄位 | 若下游需要可稽核的 provenance，0.6.0 contract 加 `provenance?: {provider, ref}`，不新增 author source | Maintainer |
| [UNKNOWN] `confidence.level` 在 v1 帶 proposal 時封頂 `medium` | 下游若把 `medium` 當作不可行動，儀器價值降低 | RF1c／node/v3 `source.tests` 落地後 `testsObserved` 才能非 null；dogfood 兩週後決定是否引入 `evidenceLevel` 分離欄位 | Maintainer |

---

## Developer Handoff

You are implementing this PRD.

- Build first: RF0 characterization fixtures（含 recommendation-engine 現行 fingerprint / dedup 行為）；然後 RF1 snapshot 與 digest；RF2 observations 先於 scale。
- Do not reinterpret:
  - ArchContext 不撰寫 proposal、不生成 `targetDelta`、不判斷「重複實作」；`refactor_proposal` 的 `authoredBy.source` 不得為 system / daemon。
  - 模組身份只來自 `.archcontext` node；祖先 / 後代重疊不是歧義。
  - footprint 只算 git-tracked 檔案。
  - `refactor` 路徑禁止呼叫 `computeRefactorConfidence` 預設值與 `createInterventionProposal()`。
  - `RecommendationV3` 是 v2 超集；不得刪 `enforcement` 等既有欄位。
  - 復用 `recommendationFingerprint()` 與 `ArchitectureSubjectSelectorV1`。
  - `resolved` 只能經 `RefactorResolutionEvidenceV1.disposition = resolved` + `recommendations resolve --evidence-digest`。
  - 不新增 MCP tool；不寫 Git 追蹤的 refactor 文檔。
  - `majorChangeReasons` 用 `ARCHITECTURE_MAJOR_CHANGE_REASON_CODES`，不擴充。
- You may improve: SCC 演算法、digest canonicalization、SQLite 表設計、捷徑 flag、observation 排序、reason code 補充項。
- Verify with:
  - `bun run typecheck`
  - `bun test packages/core/refactor-assessment packages/core/refactor-decision packages/core/pressure-engine packages/core/recommendation-engine packages/contracts`
  - `bun run verify`（含 `privacy-route-audit`、`packaged-cli-smoke`、`evals/run.ts --check`）
  - `bun packages/surfaces/cli/src/main.ts capabilities --json | jq '.features'` 含對應批次 feature
  - `bun packages/surfaces/cli/src/main.ts docs plan --json` 無 owned drift

### Acceptance Scripts

1. Determinism：`for i in 1 2; do bun packages/surfaces/cli/src/main.ts refactor scan --json > /tmp/scan-$i.json; done; cmp /tmp/scan-1.json /tmp/scan-2.json`
2. Footprint reproducibility：在 fixture include glob 內寫入未追蹤 `dist/x.ts` 後重跑，`jq '.data.snapshot.modules[].footprint.lineCount'` 與前次一致。
3. Fail-closed：`incomplete-evidence.fixture` 五子案例，`jq -r '.data.assessment.scale'` 只允許 `insufficient_evidence` / `model_adoption_required`。
4. No self-authored proposals：`observation-only.fixture` 跑 scan + record 後，`jq '[.recommendations[] | select(.category == "refactor_proposal")] | length == 0'`。
5. Dedup：同一 HEAD 連跑 `refactor record` 兩次，第二次含 `duplicate-active-fingerprint`，`book recommendations --open` 數量不變。
6. Heuristic isolation：同一 proposal 帶與不帶 `task` 文本，`assessmentDigest` 中 scale 相關欄位一致。
7. Migration replay：遷移前 `ledger rebuild` 取 digest，執行 `ledger migrate --recommendation-v3`，再 `ledger rebuild`，對照一致。
8. Resolve gate（0.5.1）：`resolution-not-improved.fixture` 跑 `verify` 後 `recommendations resolve --evidence-digest`，exit code ≠ 0 且 `code = AC_REFACTOR_EVIDENCE_REQUIRED`。
9. Release：`rg '0\.4\.8' --glob '!CHANGELOG*' --glob '!docs/**'` 為空；`npm view archctx@0.5.0 version`；clean-room readback 重跑。

---

## Adjacent Patterns

架構先例（本倉內部）：projection protocol 的 exact-version + `capabilities` feature 子集 handshake + `expectedWorktreeDigest` 綁定 + receipt digest 復核（`packages/contracts/src/projection.ts`；repo-harness `src/effects/architecture/archctx-provider.ts`）。三個 verb 直接復用該模式。Agent 撰寫 typed proposal、確定性層驗證與記錄的分工，先例是 ADR-0040 的 subagent `InvestigationReport/v1`：提案流入、daemon 驗證與寫入，提案者不直接改狀態。

---

## Backend Perspective

- RPC：`refactorScan(root, RefactorRequestV1)`、`refactorRecord(root, {assessmentDigest, expectedWorktreeDigest, selection?})`、`refactorVerify(root, RefactorVerificationRequestV1)` 加入 dispatch 表與 `RuntimeRpcClient`；scan / verify 歸長 timeout。
- 持久化：snapshot 以 ledger snapshot 落 SQLite；assessment 與 proposal 以 evidence item 暫存並綁 digest；`record` / `verify` 各一個 store transaction；migration 新增 recommendation v3 欄位、`relations`、`authoredBy`、`refactor_scan` event source。
- Mutation contract：`record` / `verify` 是 daemon-owned event append，不是 ChangeSet；不觸碰 `.archcontext/` 與 generated projections。`targetDelta` 被接受後的模型變更仍走既有 `architecture-projection accept` / ChangeSet，不在本 PRD 內。
- 隱私：snapshot 只含 repo-relative path、計數、selector、digest；proposal 的 `intent` / `thesis` 為 Agent 文本，長度上限 512 字元，不得含 source 片段（由 schema 校驗長度，內容由 privacy 掃描守護）。

---

## 依賴順序與發布順序

```text
RF0 → RF1 → RF2 → RF3 → RF5(0.5.0: scan + record + 3 features) → npm readback
                    └→ RF4 → RF5(0.5.1: verify + refactor-resolution-v1) → npm readback
                                              ↓
repo-harness Program B：更新 exact pin → required features 子集 → shadow(0.5.0) → active(0.5.1 後)
```

兩倉不得在未發布協議上同時猜欄位開發。六個 contract（request / proposal / snapshot / assessment / recommendation v3 / resolution evidence）在 `archctx-contracts@0.5.0` 一次凍結；repo-harness 在 0.5.1 readback 前對 `verify` 只允許 compile-only 型別準備。
