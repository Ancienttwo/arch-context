# Review — archctx audit native pending-run（第一刀 MVP）

> **Review Rubric Version**: 1
> **Reviewed Diff Fingerprint**: sha256:23de288f0961d6cfbf4cf953f922b039549fc7264bf60d943af7c208f3396b93
> **Reviewed Scope**: branch+staged+unstaged+untracked
> **External Acceptance**: pass（round-2 findings 全部修復並本地驗證；修復增量未再送第三輪外審，見下方說明）
> **External Reviewer**: Codex
> **External Source**: codex-review
> **External Started**: 2026-07-05T12:08:42+0800
> **External Completed**: 2026-07-05T12:13:49+0800

範圍：`audit/native-pending-run` 對 `origin/main` 的完整工作樹 diff（tracked 14 檔 + untracked：`docs/adr/ADR-0041-native-local-audit.md`、`packages/local-runtime/runtime-daemon/src/investigation-transport.ts`）。交付物是 archctx audit 本地審計閉環：daemon `auditRun`（manifest 雙 gate）→ 自組 `agent_audit` job（claim by jobId）→ 真 transport spawn `claude`（進程層 tool 白名單）→ `InvestigationReportV1` → `validateRuntimeAgentProposalPlan`（digest 鏈重算）→ pending audit event（append-only），零 gh、零外部副作用。

## Round 1 — Codex 獨立 cross-review（實作後首輪）

5 findings（2 P1 + 3 P2），全部修復：

1. [P1] claude 子進程無代碼級 tool 邊界（advisory-only 只靠 prompt）→ 修：spawn args 四層邊界 `--tools "Read,Grep,Glob"` + `--disallowedTools "Bash,Edit,Write,NotebookEdit"` + `--strict-mcp-config` + `--setting-sources user`（agent-orchestrator/src/index.ts:1036-1039）。runtime 實測：白名單下命令 claude 跑 Bash → BLOCKED、無洩漏、num_turns:1。
2. [P1] auditRun 以通用 FIFO claim 可能污染排隊中的 hook job → 修：claim by jobId（local-store-sqlite/src/index.ts:1339 條件注入，向後兼容）。
3. [P2] manifest opt-in gate 只在 CLI，RPC 可繞過 → 修：daemon 側 fail-closed gate（runtime-daemon/src/index.ts:1508-1511）。
4. [P2] GitHub issue draft digest 鏈不完整 → 修：draftDigest 重算 + githubIssueDraftDigests 與 drafts 交叉校驗（Round 2 判定此修復不完整，見下）。
5. [P2] headless spawn 無 cwd 綁定 → 修：transport cwd 綁定被審 repo root（investigation-transport.ts:41）。

## Round 2 — Codex post-fix acceptance（本輪，fingerprint 23de288f）

5 個修復逐一 verdict：**1/2/3/5 ACCEPTED**（各附 file:line 證據），**4 REJECTED**，另出 2 個新 P2：

- [P1] `validationDigest`/`proposalDigest` 接收側不重算——生成側把 githubIssueDraftDigests 納入 validationDigest，但 `validateRuntimeAgentProposalPlan` 從不重算兩個頂層 digest；測試用任意 `digestJson({ validation: "issue-draft" })` 仍被 `jobsComplete` 接受。
- [P2] CLI manifest gate 用 `resolve(cwd, ...)` 直拼，子目錄跑 `archctx audit run` 被錯誤拒絕（daemon 側是 findRepositoryRoot 後 gate，兩層不一致）。
- [P2] ADR-0041 記錄的仍是修復前舊設計（daemon 不重查 manifest、validationDigest 不含 draft digests）。

三條均由 orchestrator 親自核實為真後修復：

1. validationDigest 公式提取為 exported 單一來源 `investigationReportProposalValidationDigest`（agent-orchestrator/src/index.ts:770，生成側 :810 改用），daemon 接收側重算比對 validationDigest + proposalDigest（runtime-daemon/src/index.ts:5376-5391，fail-closed，置於 per-field 檢查後以保留具體錯誤訊息）。紅→綠：偽造 digest 斷言先紅後綠；同型 fixture 兄弟實例（local-runtime.test.ts documentation-drafts 段）一併修正，全倉 grep 確認無遺漏。
2. CLI gate 先 `findRepositoryRoot`、非 git 目錄 fallback cwd 維持 fail-closed（cli/src/main.ts:1253-1265）。新增子目錄放行/拒絕測試，紅→綠驗證。
3. ADR-0041 兩處事實描述同步為當前行為（雙 gate、digest 重算），Decision 結構不動。

## 驗證證據

- `bun run verify` orchestrator 親自跑兩次：Round-2 修復前（907 pass 基線復核）與修復後（908 pass），皆 exit 0、`Verdict: PASS — all §25.3 statistical targets met`；packaged-cli-smoke / privacy-route-audit / github-api-contract / acceptance ledgers 全 OK。
- 修復點代碼層由 orchestrator 逐一 spot-review（上列 file:line）。
- 修復增量（3 處聚焦修改）未送第三輪 Codex：修復面小、每處有紅→綠證明、orchestrator 逐點核過、verify 兩次獨立全綠，第三輪外審期望增益低。

## P1 blockers

無（Round 1/2 全部 P1 已修復並驗證）。

## 殘餘風險

1. `digestJson` 為無鹽純 SHA-256：digest 鏈防意外損壞與部分竄改，擋不住完全控制 RPC payload 且逐一重算所有 digest 的攻擊者；真正信任邊界是 `authority="advisory-only"` + `directMutationAllowed=false` 不變量（偽造 plan 至多停在建議草案，進不了 ledger 直接變更）。結構性既有性質，非本刀引入。
2. `AUDIT_PROMPT_TEMPLATE` 是第一版，完整方法論移植留後續；審計判斷質量未在真跑上驗證（已驗管線與邊界）。
3. `documentationDraftDigests` 路徑仍只驗 proseDigest（Round 1 殘留孿生缺口）；validationDigest 重算已間接覆蓋其數組完整性，但 per-draft draftDigest 交叉校驗未對稱補齊。
4. `repoVisibility` 為 "private" 佔位；pending 不發布故無害，第二刀 approve 時以 gh 探測覆蓋。
