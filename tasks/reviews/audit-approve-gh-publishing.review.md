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

## 殘餘風險

1. **真 gh 端到端未驗**：`createNodeGithubIssueExecutor` 的真實 gh 參數拼接、`gh repo view --json visibility` 輸出解析、`gh issue list` 分頁行為全部只被 fake 覆蓋。需一個專用測試 repo + Issues:write-only fine-grained PAT 跑一次真實 approve（用戶環境才能提供）。
2. **gh 非冪等的窄雙發窗口**（ADR-0042 已記）：gh 側已建但 daemon 未觀測到響應、且 create 後立即 crash 的瞬間——已收斂到孤兒 ≤1 + marker dedup + 手動 resume，advisory 低頻可接受。
3. **dedup 探測上限**：純 list `--limit 100`——issue 量大的 repo 中舊 orphan 可能翻不到；inconclusive 方向是 fail-closed 不重發。
4. `withWriter` 撞鎖走 dispatch 通用 500 而非結構化 errorEnvelope——init/applyUpdate 共享的既有不一致，未新增也未修（獨立改動）。
5. `production-mock-reachability-audit` 腳本的 blocked-keys 斷言列表未含 investigationTransport/githubIssueExecutor（daemon 自身 blockedProductionInjections 已攔，腳本斷言弱一層）——ADR-0041 期既有缺口的對稱延續。
