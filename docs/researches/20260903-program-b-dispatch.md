# Program B（repo-harness Refactor Mode）派工單

> **Date**: 2026-09-03
> **From**: arch-context orchestrator session（`arch-context-4e`）
> **To**: repo-harness 側 Program B 執行 session
> **Authority**: `packages/contracts/src/refactor.ts`、`packages/contracts/src/ledger.ts`、`packages/contracts/src/schema.ts`（arch-context main，PR #129）> `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` > `docs/researches/20260902-restructure.md` §0 修訂記錄 > 其餘研究正文
> **Upstream sprint**: `plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md`（2/10 done；RF1b 實作中）

## 1. 對下游現況判讀的確認與更正

下游 2026-09-03 的判讀大方向成立：0.5.0 未發布、Program B 硬閘未達、研究文件字段已漂移、npm 上 `archctx` / `archctx-contracts` 仍為 0.4.8、`ARCHCTX_FEATURES` 仍為舊 5 項。一處更正：

- **`insufficient_evidence` 與 `model_adoption_required` 是 `RefactorScale` 的值，不是 reason code。** `REFACTOR_SCALES = ["architecture","cross_module","insufficient_evidence","model_adoption_required","module"]`（`refactor.ts:27-33`）；`RefactorAssessmentV1.scale: RefactorScale | null`，無 proposal 時為 `null`（`:268`）。reason code 是另外 10 值的 `scaleReasonCodes`（`:34-45`）。原方案的 `proof_required` 對應到 scale `insufficient_evidence`，`no_action` 不存在。

完整字段對照見 `docs/researches/20260902-restructure.md` §0.2；發布分版見 §0.3。

## 2. 可以現在做（不依賴上游發布）

1. **Program B PRD**（repo-harness 側 `plans/prds/`，用 repo-harness-product 出）。必須含：
   - 定位：ArchContext 是儀器 / 閘門 / 賬本；repo-harness 從 `scale` + `scaleReasonCodes` 自行映射 workflow（原方案的「route」概念在 repo-harness 這邊定義），且不得把 `cross_module` / `architecture` 降級為 `module`、不得在 `insufficient_evidence` 時物化任務。
   - 兩段 gate：RH-RF0 ～ RH-RF3 綁 `archctx@0.5.0` + features `module-statistics-v1`、`refactor-assessment-v1`、`recommendation-v3`；RH-RF4（candidate verify）與 RH-RF5（after-scan / resolve）綁 `archctx@0.5.1` + `refactor-resolution-v1`。版本用精確相等、feature 用子集判定，沿用現有 `projection.ts` 的 handshake 模式。
   - Proposal 由 repo-harness 側的 Agent 撰寫並以 `RefactorProposalV1` 送入 `refactor scan`：`authoredBy.kind/source` 必須是允許配對（`cli→cli`、`mcp→mcp`、`subagent→subagent`、`developer→manual`），`daemon` / `system` 永不能撰寫；`targetDelta.unresolvedTargets` 由 ArchContext 回填，proposal digest 不含它。
   - `RecommendationV3` 三類 `practice` / `structural_observation` / `refactor_proposal`；repo-harness 只讀 status，不建第二份 ledger；`resolved` 在 0.5.0 對 refactor 類不可達（需 0.5.1 的 evidence）。
   - `RefactorVerificationRequestV1` 尚未定義，0.5.1 前不得對它寫 validator；核心 API 是 `refactorVerifyInvariantIssues(afterSnapshot, evidence)`。
   - `tests.callerCoverage` 在 v1 恆為 `null`，不得列為 essential evidence；essential evidence = model 完整、ownership 唯一、code facts coverage `complete`。
   - PRD 只落 PRD，是否開 sprint 由下游排程決定（下游已指出與 GPT Pro campaign 搶執行道）。
2. **Cutover Closure gate**：純 repo-harness 域，RH-RF4 與 campaign Phase B 的共同前提。
3. **`policy.refactor` reader 與 `off` / `shadow` / `active` 骨架**：先 fail-closed 在 `off`；`required_features` 依 §0.3 分兩組。
4. **pin `0.4.7` → `0.4.8`**：獨立小債，與 Program B 無關，可先做。

## 3. 不可以做

- 在 repo-harness 內實作 LOC / 檔案 / symbol 統計、import graph、SCC / cycle、模組邊界解析、第二套判級器、第二份 refactor ledger、直接讀 CodeGraph（原方案 §16 / §21 禁止項仍有效）。
- 以 git link 或本地路徑在 runtime 依賴未發布的 contract。僅允許 compile-only 型別準備（PRD 末節）。
- 由 Issue 標題推斷 scale。
- 用 `--json` 結果裡的 `findings` 欄位判斷外部審查通過（repo-harness `cross-review` 曾在 transcript 含 5 個 `[P1]` 時回 `findings: []` + PASS；一律讀 transcript）。

## 4. 上游時程與通知

上游剩餘順序：RF1b（實作中）→ RF2 → RF3 → RF5a（`archctx@0.5.0` + npm readback）→ RF4 → RF5b（`archctx@0.5.1`）。0.5.0 與 0.5.1 各自 npm readback 完成時，上游會透過 session chat 通知下游，附 `capabilities --json` 的 features 清單與 readback 記錄路徑；下游收到後才開 RH-RF0 / RH-RF4。

## 5. 回報格式

下游完成 §2 的任一項後，以 session chat 回報：`RESULT: DONE|PARTIAL|BLOCKED`、產物路徑（PRD / gate / policy reader）、驗證命令與結果、對上游 contract 的疑問（逐條指向 `refactor.ts` / `ledger.ts` 行號）。對 contract 的修改建議只能以疑問提出，不得在 repo-harness 側自行假設字段。
