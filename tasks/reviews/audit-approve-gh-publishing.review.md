# Review — archctx audit approve（第二刀 · gh issue publishing）

> **Review Rubric Version**: 1
> **Reviewed Diff Fingerprint**: 第二刀全部改動疊加於 03f429c 之上（8 tracked +1322/-19 加 untracked executor/ADR-0042/本檔），最終狀態以本 commit 為準
> **Reviewed Scope**: branch+staged+unstaged+untracked（03f429c 之後全部增量）
> **External Acceptance**: pass（設計一致性 A1-A6+C 全 CONFIRMED；acceptance findings 2 P1 + 1 P2 全部修復並本地驗證）
> **External Reviewer**: Codex
> **External Source**: codex-review（設計軌 + acceptance 軌各一輪）
> **External Completed**: 2026-07-05（設計軌與 acceptance 軌均本日完成）

範圍：`archctx audit approve <run>` 把 pending audit run 的 issue drafts 真正發布到 GitHub——本庫第一次帶寫意圖調 gh。狀態機 pending →(intent event)→ issuing →(per-draft progress events)→ issued；approve 永不寫 failed（該狀態專屬調查失敗語義）。

## 雙軌設計（high-stakes 流程）

deep-reasoner（Opus max）與 Codex 各自獨立出完整方案、互不可見，orchestrator 裁決 synthesize：

- **獨立收斂（直接定案）**：加 `issuing` 狀態、per-draft progress event（孤兒窗口 ≤1）、顯式 `--resume` 永不自動恢復、draftDigest footer marker dedup、專用窄權 PAT env（絕不回退 ambient gh auth）、visibility 探測 fail-closed、executor port 注入 + fake 測試、三條紅線測試。
- **決定性分歧**：deep-reasoner readback 發現既有 idempotencyKey（`agent-audit:${runId}`，狀態無關）疊加 sqlite「同 key 不同內容即拋 conflict」（local-store-sqlite:1739-1748 + :230 UNIQUE）會讓任何狀態轉移事件落不了盤——Codex 方案完全未覆蓋此地基。orchestrator 親自核實後採 deep-reasoner 修法：pending/failed key 字節不變，issuing/issued 用 content-addressed key（`...:${runId}:${status}:${digestSuffix(auditRunDigest)}`）。
- **嫁接 Codex 優點**：public/internal 門用防重放 token 式確認（`public:<owner/repo>:<baseSha>:<runId>`，boolean flag 會被腳本寫死繞門）；issuedIssues 條目帶 draftDigest（ledger 自包含對賬）；「gh CLI 呼叫面不在任何靜態掃描器 scanRoots 內、守門靠紅線測試」明寫進 ADR-0042 consequences。
- **orchestrator 補強**：dedup 探測用純 list API（`gh issue list --json` + 本地 marker 匹配）而非 search——兩版都依賴 GitHub search，其 indexing 延遲正是 crash-resume 窗口的軟肋；純 list 完全繞開。

## 實作與 acceptance

實作（fast-worker）：architecture-ledger 狀態機與 planner、`github-issue-executor.ts` 新檔（execFile 無 shell、`--body-file` 0600 tmp、PAT 僅走 child env `GH_TOKEN`、child env 縮減為 PATH/HOME/GH_TOKEN/GH_PROMPT_DISABLED、內聯 SECRET_PATTERNS 發前整批掃 + 65536 長度 pre-flight）、daemon `auditApprove`/`canFileGithubIssues`/append 泛化/RPC 接線（executor 進 blockedProductionInjections）、CLI approve 子命令 + filed N/M 渲染、ADR-0042 + README 索引。五處偏離設計均有正當理由（復用 `AC_USER_CONFIRMATION_REQUIRED` 既有契約、確認信息走 message 慣例、token digest 進 provenance.inputDigest additive 混入、repoView/list 同樣強制顯式 env、list 單次 fetch 復用），orchestrator 逐一核可——其中 provenance.inputDigest 佔用疑慮由 orchestrator 與 Codex 雙方獨立查證為無（pending 事件 digest 輸入 `{runId,auditRunDigest}` 字節不變）。

實作過程記錄一次操作事故：fast-worker 誤跑 `git checkout --` 將 daemon 主檔回退至 HEAD（=已 commit 的第一刀，實際僅抹第二刀未提交部分），靠同次 sed 備份檔完整恢復，typecheck + 全量測試 + 完整 verify 三重驗證無損。

Codex acceptance：設計一致性 **A1（idempotencyKey）/A2（永不 failed）/A3（runner 取不到 executor）/A4（PAT 不進 argv）/A5（純 list dedup）/A6（progress 先於下一 create）+ C（provenance 無佔用）全部 CONFIRMED**，另抓 2 P1 + 1 P2，orchestrator 核實為真後修復：

1. [P1] 並發 auditApprove 雙發——狀態只在開頭讀一次，冪等 intent append 當不了鎖 → 全程包進 daemon 既有 `withWriter` 互斥（與 init/applyUpdate/ledgerRebuild 同構）。並發測試先紅（兩調用皆 fulfilled、同 draft 雙 create）後綠（一過一拒 "runtime writer is locked"，createIssue 次數 = draft 數）。
2. [P1] tmp body 檔寫入失敗洩漏——writeFileSync 移進 try、finally rmSync 整目錄；注入式寫入失敗測試先紅（殘留目錄實證）後綠。
3. [P2] gh stderr 無 token redaction——executor 錯誤路徑統一 `redactGithubSecrets`（字面 token + `gh[opsu]_` pattern）；真 execFile 路徑假 gh 腳本測試先紅（token 原樣洩出）後綠。

## 驗證證據

- `bun run verify` orchestrator 親自跑（實作後、修復後各一次）：皆 exit 0、`Verdict: PASS`；修復後全倉 932 pass / 0 fail。
- 關鍵面 orchestrator 逐一 spot-review：idempotencyKey 字節保持與 content-addressed 分支、eventInputDigest additive 混入、executor env 縮減與 PAT 線程傳遞、per-draft loop 順序（create → progress append → 下一個）、withWriter 包裹、tmp try 範圍、redaction 調用點。
- 全部測試在 fake executor 下完成，零真 gh 呼叫。

## P1 blockers

無（設計軌 1 個地基問題於設計期閉合；acceptance 軌 2 P1 已修復並驗證）。

## 真 gh 端到端手測（2026-07-05，用戶授權後執行）

殘餘風險 #1 已閉合：在一次性私有測試 repo `Ancienttwo/archctx-audit-e2e` 上走完整真實路徑——`archctx audit run`（真 claude 帶進程層白名單，完整 AUDIT_PROMPT_TEMPLATE 審 fixture repo，產 4 個像樣的中文 drafts：1 P1 + 2 P2 + 1 P3）→ pending 落賬 → `approve`（真 `execFile gh issue create`）→ **4/4 issued、真實 issue #1-#4、footer marker（runId+draftDigest）落在 issue body、冪等重跑返回 issued/4 no-op**。ps 實證 claude 子進程 args 帶全部四層白名單 flags；PAT gate fail-closed 在 token 缺失時真實拒絕且錯誤信息完整。

e2e 途中抓到並當場修復：**labels 出網偏差**——設計 non-goals 明確不發 `--label`（label 不存在即整 draft partial-fail），但實作把 draft.labels 傳給了 gh create，真 GitHub 錯誤 `could not add label` 一擊命中；修復（executor port 移除 labels 入參 + 真實 args 斷言紅→綠 + ADR non-goal 措辭同步），順帶真實演練了 partial-failure 恢復縫：run 停 issuing、filed 0/4、GitHub 零污染、錯誤信息帶完整 resume 命令，`--resume` 續發成功。

e2e 抓到的產品級 findings（未修，第三刀範圍）：

- **F1 [P1-ux] 同步 auditRun RPC 在真實審計時長下必超時**：CLI fetch（undici 默認 ~300s）遠小於真審計時長（fixture ~9 分鐘、中型 repo 20+ 分鐘）→ CLI 報 AC_RUNTIME_UNAVAILABLE 而 daemon 繼續跑，用戶只能自行輪詢 audit list。方向：auditRun 改異步（返回 runId + show 輪詢）或 CLI 對 auditRun 拉長 fetch timeout。
- **F2 [P1-robustness] audit job 被 stale-cancel 無痕自我取消**：被審 repo 的 `.archcontext/` 未 commit 時其內容變化抖動 worktreeDigest → `cancel-on-head-change` 取消 audit job，無任何 run 記錄落賬，疊加 F1 的 CLI 超時斷開，用戶完全不可見（實測：job expired `stale-head-or-worktree`）。方向：audit job 改用不取消政策，或取消時落 failed run 記錄。
- **F3 [P2] clock 未接線**：`createdAt`/`startedAt`/`completedAt`/`issuedAt` 全是 epoch 1970、durationMs 0（三處實證）——investigation/audit 鏈某些路徑沒把 daemon 的 clock 傳下去。
- **F4 [P2-ux] 審計失敗無分類診斷**：隱私紅線不存 raw completion（正確），但失敗只剩 errorDigest + 籠統 "failed"，連 envelope-parse/result-not-json/schema-invalid 的分類都沒有——F7 的診斷正是因此受阻。
- **F5 [P2] daemon 生命週期語義不透明**：帶 env 的 `daemon start` 返回 running:true 但實際服務的是舊進程或 CLI 進程內 runtime，operator 無法確定 token env 在哪個進程生效（實測繞路：token 前綴加在 CLI 命令上生效）；另有兩個 6/28 遺留殭屍 daemon 進程未清理。
- **F6 [P2-scale] 中型 repo 深審失敗**：growth-hacker（141 檔）完整模板審計 outcome "failed"（非 timeout，claude 正常退出但 report 未被接受；縮小版審計同 repo 完全合規）——因 F4 無從分類，嫌疑 maxOutputBytes 或長跑後輸出違規。fixture 級完整鏈成功。
- **F7 [P3] 審計進程對被審 repo 的寫入面**：claude CLI 自身 session 記賬與用戶全局 hooks 在 cwd（被審 repo）寫 `.claude/`/`.ai/` 狀態檔——工具白名單管不到 CLI 自身行為；本次因 digest 尊重全局 gitignore 未成事故，但「零寫入被審 repo」嚴格說不成立，值得 ADR 殘餘風險記錄或用 CLAUDE_CONFIG_DIR 類機制隔離。

## 第三刀（F1/F2/F3 修復）驗收（2026-07-05）

實作（fast-worker）修復 F1（auditRun 默認異步：enqueue+claim 同步、投研後台驅動全 catch、AbortController Map + stop() abort、CLI 按 jobId 輪詢 + `--no-wait`）、F2（stalePolicy 貫通 `advisory-only-on-stale`，並挖到 `jobsComplete` 成功分支裡第二道不看 policy 的 stale-check 一併修復，帶同 sweep 對照斷言）、F3（根因改道：daemon 構造子默認 clock 是常量 `new Date(0)` 且 production 被 blockedProductionInjections 擋住無法注入——修在 `runtimeDefaultClock(compositionMode)`，embedded/test 保留凍結 epoch 守 900+ 測試確定性）。

Gatekeeper（Opus max ship gate）VERDICT: **PASS** 零 findings——(a) 後台無 unhandled-rejection 路徑、(b) started 前的失敗全部同步可見、(c) F2 無過度放行（對照：同 sweep 內 hook job expired vs audit job succeeded）、(d) 生產工廠鏈路無 epoch 泄漏、(e) 測試斷不變量，全部 file:line 閉合；完整 verify 親跑 exit 0（942 pass）。三個自報偏離全部裁決可接受。

e2e 復現路徑驗證：fixture repo 真審計（claude ~9 分鐘）全程 CLI 無超時、輪詢拿到落賬 run（F1 對「audit run 不再假死」的用戶面目標坐實）。

**e2e 同時抓到兩個新 finding（同根，未修）**：

- **F3b [P1] 真實 CLI 路徑不走 production 工廠**：乾淨環境（殭屍 daemon 清除、connection 檔不存在）下真實 `archctx audit run` 的新 job `queuedAt` 仍 epoch——實測服務者是 **CLI 進程內 runtime**（`createStartedDaemon` embedded 構造、epoch clock；佐證：approve 時 PAT env 加在 CLI 命令前綴即生效）。`createCliRuntime`（cli/main.ts:2583）的分支邏輯聲稱無 embedded deps 就走 RPC discovery，與實測矛盾——分支取值或 discovery 失敗路徑待定位。F3 的修復在 production 工廠層正確但真實 CLI 落不到它。
- **F1b [P2] 進程內模式下 `--no-wait` CLI 不退出**：F1 的後台驅動 promise + claude 子進程掛住 event loop，`--no-wait` 輸出 envelope 後進程繼續存活直到審計完成（ps 實測 CLI 進程即「daemon」本體）。RPC 模式無此問題；與 F3b 同根（不該進程內跑的路徑進程內跑了）。

## F3b/F1b 修復（stale-daemon-entry 檢測）驗收（2026-07-05）

定位推翻了第三刀段記錄的兩個假設（運行時探針證據）：CLI 分支選擇本來就正確（depsKeys=[] → RPC 分支），RPC 失敗是硬 throw 無靜默回退。**真實根因：過期 daemon 靜默復用**——daemon detached+unref 永不自退出（本機實測累積 66 個跨天殭屍），connection-file 快路徑只查 RPC wire schema 版本，對「daemon 常駐期間源碼已更新」無感；第三刀 e2e 的 epoch 時間戳（F3b）與 CLI 不退出（F1b）都是復用了源碼修復前起的舊 daemon 的表象。

修法：復用既有 RuntimeVersionUnsupportedError 模式新增 `stale-daemon-entry` 判據——CLI entry mtime 對比 connection file 的 wall-clock startedAt（該時間戳走 `new Date()` fallback，對被偵測的凍結 clock bug 免疫），接入 createOrStartRuntimeRpcClient / startBackgroundDaemon / upgradeDaemon 三處，fail-closed 指引 `archctx daemon upgrade`。e2e 期間發生一次非注入真實復現（編輯源碼後剛起的 daemon 變真過期）被新檢測原生攔截。乾淨環境終驗：`audit run --no-wait` 0.2s 退出、新 daemon production clock、`queuedAt` 真實時間、audit list 可見。

Gatekeeper 二度 PASS（mtime 三態安裝形態核實、startedAt wall-clock 免疫鏈核實、全入口 grep 覆蓋核實、新測試斷真實不變量無 fake 樁；verify 親跑 exit 0）。兩個 MEDIUM findings：upgrade 返回字段語義漂移（ship 前已修——按 reason 分流 `previousStartedAt`/`entrypointMtime`，消費者空集核實）；`daemon status`/`doctor` 展示路徑未接入 stale 檢測（唯讀診斷不產工件，留給 daemon 生命週期治理刀）。

## Daemon 生命週期治理刀驗收（2026-07-06，commit 42a32a9）

idle 自退出（默認 30 分鐘，flag/env 可配，0=禁用；每次 /rpc dispatch reset；到期三重檢查 in-flight/後台工作 fail-closed/二次確認後摘 connection file → stop → exit 必達 try/finally）+ status/doctor 接入 stale-daemon-entry 檢測（含 !client 第四處）。e2e 冒煙：真 daemon 5s idle 精確退出、控制檔全清；過程中現場撞到並用新檢測清掉一個 4.5 小時殭屍。Gatekeeper 三度 PASS 零阻擋（競態窗口有界自癒、逐出 session 的 queued job 可由 restore/lease 恢復無永久孤兒、health GET 排除語義正確）；其 gated_auto LOW（stop throw 時 exit 不達）已按給定修法收掉。verify 948 pass exit 0。

新增已知 gap（gatekeeper 獨立評估確認，未修）：**verify 的 `&&` 鏈不看 CLI envelope `ok` 值**——CLI 非 foreground 路徑從不把 ok:false 映射為非零 exit，`verify:practices` 段撞運行時錯誤（如過期 daemon）時吐錯誤信封但整鏈照樣 PASS。侷限於 practices 段、pre-existing，但它是全部驗收證據的可信度基石，列為下一刀首選。

## 殘餘風險

1. ~~真 gh 端到端未驗~~ → 已由上節閉合（fixture 級全鏈 + 真 issue 發布 + 冪等；中型 repo 深審質量見 F6）。
2. **gh 非冪等的窄雙發窗口**（ADR-0042 已記）：gh 側已建但 daemon 未觀測到響應、且 create 後立即 crash 的瞬間——已收斂到孤兒 ≤1 + marker dedup + 手動 resume，advisory 低頻可接受。marker dedup 的「命中復用」路徑僅 fake 覆蓋（真實演練需精確 kill 時機）。
3. **dedup 探測上限**：純 list `--limit 100`——issue 量大的 repo 中舊 orphan 可能翻不到；inconclusive 方向是 fail-closed 不重發。
4. `withWriter` 撞鎖走 dispatch 通用 500 而非結構化 errorEnvelope——init/applyUpdate 共享的既有不一致，未新增也未修（獨立改動）。
5. `production-mock-reachability-audit` 腳本的 blocked-keys 斷言列表未含 investigationTransport/githubIssueExecutor（daemon 自身 blockedProductionInjections 已攔，腳本斷言弱一層）——ADR-0041 期既有缺口的對稱延續。
6. `github-api-contract-audit` 掃描根不含 runtime-daemon——gh write-intent 唯一調用點無靜態掃描器兜底，靠紅線測試（ADR-0042 consequences 已記錄此盲區）。
