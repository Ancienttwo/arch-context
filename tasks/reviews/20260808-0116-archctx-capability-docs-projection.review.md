# Task Review: archctx-capability-docs-projection

> **Status**: Done
> **Plan**: plans/plan-20260808-0116-archctx-capability-docs-projection.md
> **Contract**: tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md
> **Notes File**: tasks/notes/20260808-0116-archctx-capability-docs-projection.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-08-08
> **Recommendation**: pass

## Human Review Card

- Verdict: pass(gatekeeper 驗收:五項交付逐項 PASS;唯一阻斷項是本 review card 未填,現以閘門實證轉錄補齊)
- Change type: code-change
- Intended files changed: contract allowed_paths 全清單(projection-engine、review-engine、policy-engine、changeset-engine、codegraph-adapter、runtime-daemon、CLI、renderer test、al9 readback ×2、changeset schema enum、`.gitignore`、`.archcontext/model` node、`docs/architecture/**`、harness 產物)
- Actual files changed: 34 個變更檔,`git status --porcelain -uall` 全部映射到 goal manifest(T0/T1/T2T3/T4T5/T6/T8/harness),無用戶 WIP、無越界
- Commands passed: `bun run typecheck`;`bun test`(全量 1156 pass / 0 fail,7074 expect,142 檔);`bun test packages/core/projection-engine packages/core/review-engine packages/local-runtime/codegraph-adapter`(91 pass);`bun run test:contracts`(157 pass);`node scripts/package-boundary-audit.mjs`(passed, 5 workspaces);`bun run verify`(全鏈 exit 0,evals Verdict: PASS — all §25.3 statistical targets met);`archctx docs drift --json`(ok:true, reasonCodes:[], diffs:[], notices:[]);`archctx agent-context plan`(ok:true, 2 targets, git status 前後逐字相同)
- External acceptance: unavailable(local-only work package;跨 repo 會師點已列 Residual)
- Residual risks: 見 Residual Risks / Follow-ups
- Reviewer action required: inspect diff and card
- Rollback: worktree base `7415329`;投影輸出檔按 marker region 回滾,人工區不受影響

## Mode Evidence

- Selected route: Fable orchestrator + explorer(勘察)+ deep-worker ×3(T0T1 / T2T3 / T4 終刀)+ fast-worker ×2(T6 live 驗收 / T8 死結修復)+ deep-reasoner(Q1 白名單 / Q2 戳記語義裁決)+ gatekeeper(驗收)
- P1/P2/P3 evidence: plan 的 Agentic Routing 段(explorer file:line 地圖、既有投影全路徑 trace、Approach 決策表);deep-reasoner 裁決全文轉錄於派工單與 notes
- Root cause or plan evidence: notes T1-T8 各章節(接口、決定、實證);drift 不動點問題與 freshness 死結均有「現狀失敗 → 修後通過」的反證測試記錄

## Verification Evidence

- Waza `/check` run: n/a(由 gatekeeper agent 驗收替代)
- Commands run: 見 Human Review Card「Commands passed」;gatekeeper 另做三次 `git status --porcelain -uall` 快照(verify 前/drift 後/verify 後)逐字相同,HEAD 全程停在 `74153295`
- Manual checks:
  - 「連續兩次投影零 diff(冪等);marker 外 byte-for-byte 保留」:live `docs apply` ×2 第二次 `diff -r` 零輸出;`entity-summary.test.ts:236` 以 `Buffer.from` 逐位元比對人工區前後綴(含雙空格/tab/尾隨空白);`:219` 連跑三次 render body 全等;`mergeGeneratedRegion` 為純位移拼接,結構性保證
  - 「P1 flowchart 邊全部可溯源到 codegraph import 邊;無啟發式合成邊」:gatekeeper 抽樣三條 live 邊逐一對回真實 import 語句(`reconcile-engine/src/index.ts:4`、`local-store-sqlite/src/index.ts:51`、`projection-engine/src/index.ts:11`);`entity-summary.test.ts:541` 雙向釘死(畫出的邊有輸入支撐 + 跨目錄輸入邊全被畫);解析不到的 specifier 回空集不合成
  - 「codegraph 不可用時 P2 生成 fail-closed 報錯(非空模板)」:`assertCapabilityEntrypointCallGraphs` 拋 `architecture-docs-projection-call-graph-missing` / `...-entrypoint-mismatch`;`entity-summary.test.ts:692/:697` 釘死;無索引時 P1 誠實省略、P2 assert 拋錯
  - 「Evaluator review file recommends pass」:本檔即為該證據(Recommendation: pass)
- Supporting artifacts: `docs/architecture/modules/capability-architecture-context.md`(live 機器區:引言塊 `Verified against: 74153295...(2026-07-14)` 與 `git show -s --format=%cI 7415329` 逐字相符;P1 flowchart 5 條目錄聚合邊;P2 sequenceDiagram 來自宣告 entrypoints);`docs/architecture/.projection-manifest.json` per-target `verifiedAgainst`
- Implementation notes reviewed: yes(T1-T8 全章節)
- Run snapshot: gatekeeper run(bun test 全量 + bun run verify 全鏈)於 2026-08-08,worktree HEAD `74153295`

## External Acceptance Advice

> **External Acceptance**: unavailable
> **External Reviewer**: n/a
> **External Source**: n/a
> **External Started**: n/a
> **External Completed**: n/a

- P1 blockers: none
- P2 advisories: 跨 repo 會師點三條(見 Residual)
- Acceptance checklist: handoff §3 五項交付逐項 PASS(gatekeeper 驗收表)

## Behavior Diff Notes

- entity-summary 渲染輸出從薄摘要升級為 handoff §2 機器區(引言塊 + §1 P1 地圖 + §2 P2 數據流),marker 外人工區 byte-for-byte 保留
- `Verified against` 語義 = 「該內容上次被生成/驗證的 commit」(黏性戳記):HEAD 移動且無覆蓋源碼變更 → bytes 不變(投影可 commit 且停在不動點);覆蓋源碼變更 → 重蓋戳並清除 freshness 告警
- `complete_task` 新增 projection freshness gate(`stale-context` finding),不改既有 HEAD-mismatch 語義
- ChangeSet 新增 `render_agent_context` op kind,agent-context 寫入走 scoped 白名單(基礎 ALLOWLIST 一字未動;repo 根拒絕;basename + 推導集 + operation 三條件同時成立)
- drift 分類修正:region 自洽但與期望不同 → `stale`(原誤報 `manually-edited`)
- `docs/architecture/decisions/index.md` 追平 ADR-0041~0045(投影在本 WP 前已落後,重投影順手追平)

## Residual Risks / Follow-ups

- **跨 repo 會師點 1**:`Verified against` 黏性戳記語義 vs handoff §3.5 單 commit 措辭——repo-harness 做 `check-architecture-sync --strict` freshness 委派前需按 per-capability 戳記對齊
- **跨 repo 會師點 2**:P1 圖跨 package 依賴邊缺席(`@archcontext/*` workspace alias 不解析,No-Fallback 誠實省略);值得單獨切一刀做確定性 workspace 解析
- **跨 repo 會師點 3**:agent-context live 落點粒度——本 repo node `source.include: packages/**/src/**` 使 primary dir 坍縮為 `packages`;真正翻開 agent-context 投影前該 node 需拆細
- CLI `plan` 對既有檔案更新記 `create_entity` op kind(provenance 不精確,寫入語義正確)
- 黏性戳記在「量不到變更集」時重蓋並出 notice(rebase 自癒),不硬 fail——刻意裁決
- verify-contract 兩條全庫性質噪音:`evidence_requirements.benchmark` 全庫零命中(harness 模板與 verifier 期望落差)

## Manual Check Evidence

- [x] Evaluator review file recommends pass
  - Evidence: 本檔 Recommendation: pass;gatekeeper 驗收五項交付逐項 PASS(VERDICT 全文見任務通知記錄),verify 鏈 `bun run verify` exit 0
- [x] 連續兩次投影零 diff(冪等);marker 外 byte-for-byte 保留(測試斷言 + gatekeeper diff 驗收)
  - Evidence: live `archctx docs apply` ×2 第二次 `diff -r /tmp/t7-post1 docs/architecture` 零輸出;`entity-summary.test.ts:236` Buffer 逐位元比對人工區前後綴、`:219` 三連跑 body 全等;gatekeeper 三次 `git status --porcelain -uall` 快照逐字相同
- [x] P1 flowchart 邊全部可溯源到 codegraph import 邊;無啟發式合成邊
  - Evidence: gatekeeper 抽樣三條 live 邊對回真實 import 語句(reconcile-engine/src/index.ts:4、local-store-sqlite/src/index.ts:51、projection-engine/src/index.ts:11);`entity-summary.test.ts:541` 雙向釘死;未解析 specifier 回空集不合成
- [x] codegraph 不可用時 P2 生成 fail-closed 報錯(非空模板)
  - Evidence: `assertCapabilityEntrypointCallGraphs` 拋 `architecture-docs-projection-call-graph-missing` / `...-entrypoint-mismatch`;`entity-summary.test.ts:692`、`:697` 兩條測試釘死;無索引時 P2 由 assert 拋錯、P1 誠實省略

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 9/10 | 五項交付逐項 PASS;全量 1156 測試 + full verify 鏈 exit 0;扣 1 分:P1 跨 package 邊缺席使圖資訊量偏低 |
| Product depth | 8/10 | 不動點/死結兩個生命週期問題被主動實測發現並閉環;agent-context 落點粒度留待 node 拆細 |
| Design quality | 9/10 | 白名單 operation-kind 限定三條件疊加;單點推導防漂移;core 純函數/IO 分層維持 |
| Code quality | 9/10 | 293+ 新測試含反證式斷言(byte 級、雙向邊溯源);NUL 收口;無 silent fallback |

## Failing Items

- none(代碼側);本 card 先前未填為唯一阻斷項,已補齊

## Retest Steps

- Re-run: `bun run typecheck && bun test && bun run test:contracts && node scripts/package-boundary-audit.mjs && bun run verify`
- Re-check: `archctx docs apply` ×2 第二次零 diff;`archctx docs drift --json` ok:true;`repo-harness run verify-contract --contract tasks/contracts/20260808-0116-archctx-capability-docs-projection.contract.md --strict`

## Summary

- repo-harness handoff 20260808 §3 五項 arch-context 側交付全部落地並通過 gatekeeper 驗收;marker 外 byte-for-byte 與連續投影冪等兩條硬條件有 byte 級測試與 live 實證;`Verified against` 收斂為黏性 per-capability 戳記(不動點可達、freshness 可清除);agent-context 經 scoped ChangeSet 寫入邊界接線完成(本輪只 plan/preview,未對 live 樹 apply)。
