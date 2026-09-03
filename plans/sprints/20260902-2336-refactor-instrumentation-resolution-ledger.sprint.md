# Sprint: Refactor Instrumentation, Module Statistics and Resolution Ledger

> **Status**: Approved
> **Slug**: refactor-instrumentation-resolution-ledger
> **Created**: 2026-09-02 23:36
> **Updated**: 2026-09-03 09:06
> **Source PRD**: `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md`
> **Source Spec**: `docs/spec.md`
> **Goal Mode**: incremental

Program-level sprint container. The Source PRD summary and ordered backlog
decompose product intent into ordered rows. Contract rows become task-contract
slices after `$think` expansion; inline rows stay in the sprint backlog or
active plan Task Breakdown.
`tasks/todos.md` stays the deferred-goal ledger and never carries this backlog.

## PRD

Full PRD: `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md`（Approved）。
定位：ArchContext 是 Agent 在代碼架構上的儀器、證據閘門與賬本，不是重構決策者。

### Problem

- ArchContext 已有 CodeGraph adapter、scale signal、import edge、pressure engine、posture 判定、
  recommendation fingerprint/dedup 與 lifecycle，但沒有 first-class、版本化、fail-closed 的
  「量測 → 對 Agent 提案判級 → 記錄 → 事後驗證」協議。
- 下游 repo-harness Refactor Mode 若自己補統計器與判級器，就會出現第二套事實來源。
- 現行 `prepareTask()` 預設 `callerCoverage ?? 0.8` 等值、`createInterventionProposal()` 用 placeholder
  自造 target，都不能成為機器消費的依據。

### Users

- coding agent（透過 repo-harness Refactor Mode 或直接用 CLI）：動手前拿到「提案實際動幾個 node、
  是否改宣告模型、證據夠不夠」，改完後用 `verify` 證明結構真的改善。
- repo-harness Refactor Mode：以 exact-version CLI 拿到可校驗 digest 的 snapshot / assessment /
  recommendation / resolution evidence；內部零統計器、零第二 ledger。
- 本地開發者：`archctx book recommendations --open --explain` 看見 observation 與 proposal 的
  scale、證據、解決狀態。

### Success Criteria

- Snapshot determinism：同 model / HEAD / index 兩次 `refactor scan --json` byte-identical。
- Fail-closed scale：證據不足時只允許 `insufficient_evidence` / `model_adoption_required`，永不猜 module。
- No self-authored proposals：ledger 中 `refactor_proposal` 的 `authoredBy.source ≠ system/daemon`。
- Resolve gate：無 evidence、disposition ≠ resolved、HEAD 漂移時 `recommendations resolve` 必被拒絕。
- Docs churn = 0：`docs/architecture` 仍只輸出 1–2–5 bucket，RF1 後 `docs plan` 無 owned drift。
- v2→v3 migration replay：遷移前後 `ledger rebuild` digest 一致。

### Acceptance Scenarios

- S1 Agent 提案落在單一 node → `scale = module`。
- S2 提案跨兩個 node、`targetDelta` 為空 → `scale = cross_module`；ArchContext 不評價語義。
- S3 提案 `targetDelta` 改 owner / relation → `scale = architecture`，`majorChangeReasons` 非空，
  無任何 ArchContext 自造 target 字串。
- S4（0.5.1）`refactor verify` 後 `recommendations resolve --evidence-digest` 才能 resolved。
- S5（negative）缺 index / truncated / 非父子重疊 / unowned path / undeclared include 五子案例
  全部 fail closed。
- S6（negative，0.5.1）merged 但指標未改善 → `not_improved`，resolve 被拒。
- S7（negative）無 proposal 的 scan+record 只產生 `structural_observation`，`scale = null`。

### Non-goals

- 不替 Agent 決定是否重構；不生成目標架構、kill list、遷移計畫；不做「重複實作」「兼容層」語義判斷。
- 不建 Task / Plan / Contract / Lease / PR / Issue / Campaign；不知道什麼是「main」。
- 不新增 MCP tool；不新增 Git 追蹤的 refactor 文檔投影；不把精確計數寫進 `docs/architecture`。
- 不修改 `prepareTask()` / `createInterventionProposal()` 既有 SOP 行為；不修 spec 的 MCP 工具數漂移。
- 不實作 repo-harness 側的 scale 映射、看板、GPT Pro alias。

## Architecture Notes

### Capabilities Touched

- `packages/contracts`（六個新 schema、`RecommendationStatus` 共用 union、`refactor_scan` event source、
  新錯誤碼、`ARCHCTX_FEATURES` 增補）。
- `packages/core/projection-engine`（footprint 改 git-tracked 來源；bucket 輸出不變）、
  `packages/local-runtime/codegraph-adapter`（出邊 → 全倉圖）、新 `packages/core/module-statistics`、
  新 `packages/core/refactor-assessment`。
- `packages/core/recommendation-engine`（fingerprint 輸入泛化、relations）、
  `packages/local-runtime/local-store-sqlite`（v3 migration、relations、authoredBy）、
  `packages/local-runtime/runtime-daemon`（`refactorScan` / `refactorRecord` / `refactorVerify` RPC）。
- `packages/surfaces/cli`（`refactor` verb、`recommendations resolve --evidence-digest`、help）。
- `docs/architecture` 只被動驗證無 drift；`.archcontext/` 不在本 sprint 內改動。

### Dependency Order

- RF0 characterization freeze → contracts freeze → RF1 snapshot → RF2 assessment → RF3 v3 + recording
  → RF5a CLI/RPC/capabilities + 0.5.0 → readback。
- RF4 verify runtime 依賴 RF1 與 RF3，排在 0.5.0 之後立即開始 → RF5b 0.5.1 → readback。
- 前置但不在本 sprint 內：本倉 model adoption（把 `packages/core/*` 拆成獨立 node），以獨立 plan
  經 `archctx` ChangeSet 流程進行，可與 RF0 並行；RF2 的 scale fixture 用合成 fixture 倉，不依賴它。
- 本 sprint 的 backlog 為有序隊列，contract row 不並行執行（sprint 檔回填衝突）。

### Risks

- SCC / fan-in / 入邊索引今天完全不存在，是淨新工作；import edge 只有出邊且 truncation 為全局值。
- 精確 lineCount 讀工作樹不可重現，必須改 git-tracked 來源，否則 determinism 驗收不可達。
- v2→v3 migration 若破壞 `ledger rebuild` replay，0.5.0 不能發。
- `privacy-route-audit` 掃 renderer / retrieval / cloud 目錄的字面量，fixture 與文案需用片段拼接。
- 版本號釘在代碼裡不只 manifest；發版前 `rg` 掃到空、`catalog.yaml` digest 重算、clean-room readback 重跑。
- Bun 1.4.0 node:sqlite 運行時選擇已釘死，migration 測試必須在同一運行時下跑。

## Backlog

Ordered execution queue; keep rows in dependency order. Mode `contract` runs
the full plan -> contract -> worktree flow; `inline` allows primary-tree
execution for small tasks. Every row needs a concrete acceptance line.

| # | Status | Task | Mode | Acceptance | Plan |
|---|--------|------|------|------------|------|
| 1 | [x] | rf0-characterization-freeze | contract | `test/fixtures/refactor-baseline/` digest fixtures exist under `packages/core/refactor-decision`, `packages/core/pressure-engine`, `packages/core/recommendation-engine`, `packages/core/projection-engine`, `packages/local-runtime/codegraph-adapter`; `bun test` for those five packages passes; `bun evals/run.ts --check` exit 0; `git diff --stat -- docs/architecture` empty | `plans/archive/plan-20260902-2348-rf0-characterization-freeze.md` |
| 2 | [x] | rf1a-contracts-freeze | contract | `packages/contracts/src/refactor.ts` exports schema constants for `archcontext.refactor-request/v1`, `refactor-proposal/v1`, `module-statistics/v1`, `refactor-assessment/v1`, `recommendation/v3`, `refactor-resolution-evidence/v1` plus invariant validators and digest functions; `RecommendationStatus` shared union exported from `ledger.ts`; `bun test packages/contracts` and `bun run typecheck` pass; `grep -c 'recommendation/v3' packages/local-runtime` is 0 (no consumer switched yet) | `plans/archive/plan-20260903-0305-rf1a-contracts-freeze.md` |
| 3 | [x] | rf1b-module-statistics-snapshot | contract | `bun test packages/core/module-statistics` passes fixtures: two-run identical `snapshotDigest`; untracked `dist/` file inside include glob leaves `lineCount` unchanged; ancestor/descendant overlap assigns file to deepest node; non-ancestor overlap sets `ambiguousOwnership=true`; node without `source.include` sets `footprintDeclared=false`; missing index yields `coverage=unknown` and `dependencyGraph=null`; `bun packages/surfaces/cli/src/main.ts docs plan --json` reports zero owned drift (PRD S5) | `plans/archive/plan-20260903-0411-rf1b-module-statistics-snapshot.md` |
| 4 | [x] | rf2-assessment-observations-scale | contract | `bun test packages/core/refactor-assessment` passes fixtures single-module (S1 `scale=module`), cross-module (S2 `scale=cross_module`), architecture-owner-change (S3 `scale=architecture`, no placeholder target strings), incomplete-evidence five sub-cases (S5 only `insufficient_evidence`/`model_adoption_required`), observation-only (S7 `scale=null`, zero `refactor_proposal`), heuristic-isolation (same scale with and without `task` text) | `plans/archive/plan-20260903-0512-rf2-assessment-observations-scale.md` |
| 5 | [x] | rf3-recommendation-v3-ledger-recording | contract | `bun test packages/core/recommendation-engine packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon` passes with: `refactor_scan` in `ArchitectureEventSource`; `refactorRecord` RPC in dispatch table; second `record` at same HEAD returns `duplicate-active-fingerprint`; `regressesFrom` link on re-detected fingerprint; `ledger migrate --recommendation-v3` then `ledger rebuild` digest equals pre-migration rebuild digest; `recommendations resolve` without `--evidence-digest` on non-practice category returns `AC_REFACTOR_EVIDENCE_REQUIRED` | `plans/archive/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md` |
| 6 | [ ] | rf5a-cli-rpc-capabilities-0.5.0 | contract | `archctx refactor scan --json` and `refactor record` wired through `refactorScan`/`refactorRecord` RPC; `capabilities --json` features include `module-statistics-v1`, `refactor-assessment-v1`, `recommendation-v3`; help `commands` includes `refactor`; `packaged-cli-smoke` covers `refactor scan`; version bumped to `0.5.0` with `rg '0\.4\.8' --glob '!CHANGELOG*' --glob '!docs/**'` empty; `bun run verify` exit 0 | (pending) |
| 7 | [ ] | rf5a-release-readback-0.5.0 | inline | `npm view archctx@0.5.0 version` prints `0.5.0`; `npm view archctx-contracts@0.5.0 version` prints `0.5.0`; clean-room readback script exit 0; readback record committed under `docs/` following the 0.4.8 precedent | (pending) |
| 8 | [ ] | rf4-resolution-verification | contract | `bun test packages/core/refactor-assessment packages/local-runtime/runtime-daemon` passes fixtures: resolved (S4 `disposition=resolved`, resolve succeeds with `--evidence-digest`), not-improved (S6 `disposition=not_improved`, resolve returns `AC_REFACTOR_EVIDENCE_REQUIRED`), stale base (`disposition=stale`), HEAD drift (`AC_REFACTOR_STALE`), incomplete after-coverage never `resolved`; `refactorVerify` RPC in dispatch table; evidence bound via `EvidenceBinding/v1` | (pending) |
| 9 | [ ] | rf5b-cli-verify-0.5.1 | contract | `archctx refactor verify --request-json` wired through `refactorVerify` RPC; `capabilities --json` features include `refactor-resolution-v1`; `packaged-cli-smoke` covers `refactor verify`; version bumped to `0.5.1` with `rg '0\.5\.0' --glob '!CHANGELOG*' --glob '!docs/**'` empty; `bun run verify` exit 0 | (pending) |
| 10 | [ ] | rf5b-release-readback-0.5.1 | inline | `npm view archctx@0.5.1 version` prints `0.5.1`; clean-room readback script exit 0; readback record committed under `docs/` | (pending) |

## Execution Log

Keep this section last; `repo-harness run sprint-backlog complete-task` appends rows here.

| When | Task | Plan | Result |
|------|------|------|--------|
| 2026-09-03 02:29 | rf0-characterization-freeze | `plans/archive/plan-20260902-2348-rf0-characterization-freeze.md` | done |
| 2026-09-03 04:00 | rf1a-contracts-freeze | `plans/archive/plan-20260903-0305-rf1a-contracts-freeze.md` | done |
| 2026-09-03 05:11 | rf1b-module-statistics-snapshot | `plans/archive/plan-20260903-0411-rf1b-module-statistics-snapshot.md` | done |
| 2026-09-03 07:13 | rf2-assessment-observations-scale | `plans/archive/plan-20260903-0512-rf2-assessment-observations-scale.md` | done |
| 2026-09-03 09:06 | rf3-recommendation-v3-ledger-recording | `plans/archive/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md` | done |
