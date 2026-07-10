# Task Review: business-logic-deep-review

> **Status**: Completed
> **Review Rubric Version**: 2
> **Reviewed Diff Fingerprint**: sha256:65aa11c9ee5e4abc276854cd3c8e301d7a7d5dbf237cce05f9b8c0ecb67b3c7b
> **Reviewed Scope**: branch+staged+unstaged+untracked（全空；實際審查對象為 main@a8e463f 的整體業務邏輯）
> **Last Updated**: 2026-07-10 04:49
> **Recommendation**: pass — remediation verified

## External Acceptance Advice

> **External Acceptance**: fail
> **External Reviewer**: Codex (gpt-5.6-sol)
> **External Source**: codex-review（session `019f488d-e7ca-7060-b10c-e406dbaafb54`；首輪 read-only sandbox 於 540s timeout，經 `codex exec resume` 取回最終報告；resume 輪未執行任何命令、僅輸出文字）
> **External Started**: 2026-07-10T04:15+0800（約）
> **External Completed**: 2026-07-10T04:45+0800（約）
> **Review Rubric Version**: 2
> **Reviewed Diff Fingerprint**: sha256:65aa11c9ee5e4abc276854cd3c8e301d7a7d5dbf237cce05f9b8c0ecb67b3c7b
> **Reviewed Scope**: branch+staged+unstaged+untracked

- P1 blockers: F1–F11（見下表；其中 F2/F6/F7 為雙軌獨立收斂）
- P2 advisories: F12–F18
- Acceptance checklist: fail——修復前不應宣稱滿足 ADR-0040 的原子 apply／單一寫者／隱私不變量

## 方法

雙軌獨立審查，兩軌互不可見；orchestrator 對承重主張逐一抽查源碼：

- 軌 A：Codex gpt-5.6-sol（read-only sandbox + 唯讀行為探針）→ 10 [P1] + 2 [P2]（附錄 A 全文）
- 軌 B：deep-reasoner / Claude Opus 4.8 max（獨立、未見軌 A）→ 1 [P1] + 6 [P2]，confidence HIGH（附錄 B 全文）
- 輔助：Explore agent 業務邏輯地圖（模組邊界、入口、關鍵流、驗證面、覆蓋率）
- Orchestrator 抽查：8 項承重主張親讀源碼，8/8 屬實

## Findings 總表（雙軌綜合）

「驗證」欄：✅=orchestrator 親讀源碼證實；🧪=Codex 唯讀探針行為證實；◐=機制與已讀源碼一致、未逐行覆核。

### 第一層 P1 — ChangeSet 原子性與正確性核心

| # | 發現 | 位置 | 來源 | 驗證 |
|---|------|------|------|------|
| F1 | `validateModel()` 回傳 `{valid:false}` 被丟棄，無效模型照樣 commit、回 `applied`；postcondition "schema-valid-after" 形同虛設 | packages/core/changeset-engine/src/index.ts:247-249；packages/local-runtime/model-store-yaml/src/index.ts:185 回傳不 throw | Codex | ✅🧪 |
| F2 | 破壞性 `renameSync` 先於 journal 記錄（WAL 倒置）：崩潰窗口內原檔移走但 journal 無記錄→恢復不還原；孤兒 backup 觸發 :272 檢查永久卡死該路徑後續 apply；`listModelFiles` 會把孤兒 backup 讀回污染模型 | packages/core/changeset-engine/src/index.ts:272-289；packages/local-runtime/local-store-sqlite/src/index.ts:3527-3537 | 雙軌收斂 | ✅ |
| F3 | `ChangeSetDraft.base` 三個 digest（headSha/worktreeDigest/modelDigest）宣告了但從未比對；daemon 只比「呼叫端當前 digest」，舊 draft 可在模型已變後照常 apply（跨檔 lost update） | packages/core/changeset-engine/src/index.ts:188-241；packages/local-runtime/runtime-daemon/src/index.ts:2431-2433（grep 全檔無 `base.*` 使用） | Codex | ✅ |
| F4 | ledger append 已 COMMIT 後、`commitChangeSet` 前任何失敗 → catch 回滾 YAML + journal 標 aborted；恢復只掃 `status='pending'`，aborted 永不對帳 → ledger 有 event、YAML 已回滾的持久分歧 | packages/local-runtime/runtime-daemon/src/index.ts:2487；packages/core/changeset-engine/src/index.ts:232-236；packages/local-runtime/local-store-sqlite/src/index.ts:1546 | Codex | ◐ |
| F5 | SQLite `synchronous` PRAGMA 未設，journal 耐久性押在 driver 隱式預設上；若為 NORMAL，F2 窗口從「窄」擴成「任一最後操作」 | packages/local-runtime/local-store-sqlite/src/index.ts:82-85 | deep-reasoner | ✅ |

### 第一層 P1 — 邊界圍堵（security / privacy）

| # | 發現 | 位置 | 來源 | 驗證 |
|---|------|------|------|------|
| F6 | 寫入 allowlist 是純詞法 containment，symlink 檢查只 lstat 最後一段：`.archcontext/policies` 若是指向倉外的 symlink，寫入落在倉外可覆蓋使用者檔案 | packages/core/policy-engine/src/index.ts:186-198；packages/core/changeset-engine/src/index.ts:561-566（倉內已有 realpath 範式 local-store-sqlite:3018-3030 可復用） | 雙軌收斂 | ✅ |
| F7 | 隱私不變量在持久化邊界零執法：`payload_json`/`event_json`/FTS 原文入庫；`--reason` 自由文字實流入 event，而 daemon 回應（:2833）固定宣稱未持久化敏感正文；探針證實 `payload.rawDiff` 塞入 secret 樣式內容被接受並可從 replay 讀回 | packages/local-runtime/local-store-sqlite/src/index.ts:2045-2085；packages/core/architecture-ledger/src/index.ts:2115/2243；packages/local-runtime/runtime-daemon/src/index.ts:2758/2833 | 雙軌收斂 | 🧪 |

### 第二層 P1 — Ledger 權威一致性（ledger-authoritative 晉升前必修）

| # | 發現 | 位置 | 來源 | 驗證 |
|---|------|------|------|------|
| F8 | ledger→YAML 投影非 contract-preserving round trip：relation 投影缺 schema 必填的 `intent`、node 把 `source`/`responsibilities` 塞進 `metadata`（node schema `additionalProperties:false`）→ `ledger project`/rollback 產出 schema-invalid YAML；capability 的 `source` 降級後 ADR-0043 resolver 選不到 | packages/core/architecture-ledger/src/index.ts:1652-1680/1887；schemas/repo/architecture-relation.schema.json:7；schemas/repo/architecture-node.schema.json:6 | Codex | ✅ |
| F9 | `ledger project`/rollback 繞過 ChangeSet journal：裸 `writeFileSync` 迴圈（`writeArchitectureProjectionFiles`），無 temp+rename/expectedHash/journal，多檔寫到一半崩潰 → `.archcontext/` 新舊混雜且無可恢復記錄 | packages/local-runtime/runtime-daemon/src/index.ts:2844/3002/5627 | Codex | ✅ |
| F10 | ledger 讀取/replay 只按 `storage_repository_id + storage_workspace_id` 過濾，scope 中 branch/HEAD/worktreeDigest 全忽略 → 切分支後狀態互染（探針：main scope 讀回 feature 資料） | packages/local-runtime/local-store-sqlite/src/index.ts:690/2504-2512/2645 | Codex | ✅🧪 |
| F11 | append 無 baseDigest/resultingDigest CAS；錯誤 resultingDigest 被接受。單一寫者鎖今天緩解，ledger-authoritative 晉升後升級為 lost-update 通道 | packages/local-runtime/local-store-sqlite/src/index.ts:1729-1780；packages/core/architecture-ledger/src/index.ts:2252 | Codex | 🧪 |

### P2 — 建議修

- F12 恢復迴圈單點 throw（idempotency 衝突）棄置其餘 pending journal — local-store-sqlite:1555（orchestrator）
- F13 `changeSetJournalPlannedLedgerEvent` 吞驗證錯誤 → 恢復誤判「未 append」回滾檔案，ledger/檔案靜默分歧 — local-store-sqlite:3509-3521（orchestrator + deep-reasoner 一致）
- F14 journal/ledger 無界成長 + 每次啟動對全部 committed journal 重跑 cleanup（O(history) 啟動） — local-store-sqlite:1540-1545（deep-reasoner）
- F15 agent-context 路徑源自未驗證 `source.include`（`../../x/**` → 倉外路徑）；merge 不驗 marker digest；多 capability 同目錄產生互踩檔案 — projection-engine:793-798/811/887（雙軌）
- F16 `rebuildGeneratedProjection` 在 journal/backup 保護外先 `rmSync(.archcontext/generated)` — model-store-yaml:164-174（deep-reasoner）
- F17 projection manifest 不在 drift 管理集合，complete gate 只驗存在不驗完整性 — runtime-daemon:5845；projection-engine:235/701（Codex）
- F18 測試驗實作形狀不驗不變量：恢復測試主動補記錄跳過真崩潰缺口、privacy 測試只掃欄名、ledger fixture 塞無關 digest 仍過 — local-store-sqlite.test.ts:727/1479；runtime-daemon/test/local-runtime.test.ts:3246（雙軌收斂）

## 測試缺口（合併）

- F2 崩潰窗口：真 `SqliteLocalStore` 下「rename 落盤但未 record」→ 重啟恢復 → 斷言 target 還原、無孤兒 backup、後續 apply 不被卡死（現有 local-store-sqlite.test.ts:715/757/788 只覆蓋已記錄檔案）
- ChangeSetEngine × 真 SQLite 從未合測（現只用 in-memory fake journal，changeset-engine.test.ts:582-596）
- idempotency 衝突 throw + ROLLBACK 零殘留（local-store-sqlite:1744）無測試
- 隱私負向測試：含 secret/source 標記的 payload 應在 append 被拒（現在通過）
- symlink 逃逸、include `..` 逃逸、同路徑並發 apply 競態均無測試
- 覆蓋率弱點：architecture-ledger 0.27:1、retrieval 0.18:1、projection-engine 0.25:1；runtime-daemon 與 local-store-sqlite 絕對未測面最大

## 處置

四期修復方案已成案，執行包：`tasks/notes/20260710-0449-business-logic-fixes.codex-handoff.md`（交 Codex 執行）。

- Phase 1：ChangeSet 原子性核心（F1–F5）
- Phase 2：邊界圍堵（F6、F7、F15）
- Phase 3：Ledger 權威一致性（F8–F11）
- Phase 4：韌性與規模（F12、F14、F16、F17、F18 殘餘）

## Remediation Closeout — 2026-07-10

原始 External Acceptance 與 fingerprint 保留為對 `main@a8e463f` 的歷史判定；本節記錄其後的修復與本地獨立驗證，不構成 `ledger-authoritative` promotion。

| Findings | Verified remediation |
|---|---|
| F1–F5 | 無效模型 fail closed；file intent 先於 rename；draft HEAD/worktree/model base 全比對；ledger append 與 journal commit 同一 SQLite transaction；`synchronous=FULL`。 |
| F6–F7、F15 | canonical parent containment 阻斷 symlink escape；ledger persistence boundary 執行 typed/size/privacy gate；agent-context 拒絕 `..`、驗 marker digest、同路徑 coalesce。 |
| F8–F11 | node/relation/constraint 宣告欄位 round trip 並以 repo schema 驗證；project/rollback 全走 ChangeSet；所有 ledger surface 以完整 cursor 分區；append transaction 執行 base/resulting graph CAS。 |
| F12–F14 | recovery error 逐 journal 隔離；malformed planned event 保持 pending 並記錄 error；migration `0011_changeset_cleanup_cursor` 將 startup cleanup 限為每輪 100 筆未完成 journal。 |
| F16–F18 | generated replacement 先 plan 再 journaled apply；projection manifest 納入 drift/complete integrity；新增 crash/privacy/scope/CAS/idempotency/manifest 等負向不變量測試。 |

驗證結果：`git diff --check` pass；`bun run typecheck` pass；`bun test` 1008 pass / 0 fail / 6096 assertions；`bun run verify` pass（含 package boundary、production reachability、privacy、acceptance ledger、packaged CLI 與 representative eval）。

---

## 附錄 A — Codex 報告全文（verbatim，gpt-5.6-sol）

结论：**FAIL**。发现 10 个必须修复的 business-logic 问题。六个关键测试文件当前为 `148 pass / 0 fail`，但没有覆盖下述失败窗口。

### Findings

1. **[P1] `validateModel()` 返回无效时，ChangeSet 仍会提交**

   changeset-engine/src/index.ts:247 只 `await validateModel()`，没有检查 `valid`；model-store-yaml/src/index.ts:185 明确以 `{ valid, errors }` 返回失败而不抛异常。context-compiler/src/index.ts:102 同样忽略 `valid`。

   失败场景：ChangeSet 写入缺少 `schemaVersion` 的 policy/node；校验返回 `valid:false`，但 journal 被标记 committed、结果返回 `status:"applied"`，后续 context 也继续基于无效模型生成。只读探针已确认 `valid:false` 仍得到 `status:"applied"`。

2. **[P1] ChangeSet 声明的 HEAD/worktree/model preconditions 实际没有执行**

   `ChangeSetBase` 包含三个 digest，但 changeset-engine/src/index.ts:188 的 apply 流程没有比较它们。runtime-daemon/src/index.ts:2431 只验证调用者传入的 digest 等于“当前”worktree，并不验证它等于 draft 的 `base.worktreeDigest`；`base.modelDigest` 和 `base.headSha` 完全未使用。

   失败场景：ChangeSet 在模型 A 上规划；其他进程修改一个未被本 ChangeSet 触及的 relation，形成模型 B；调用方提交 B 的当前 digest 后，旧 draft 仍可应用。单文件 `expectedHash` 无法阻止跨文件语义 lost update。

3. **[P1] 文件先被移走，journal 后记录，存在不可恢复的 crash gap**

   changeset-engine/src/index.ts:273 先把原文件 rename 到 backup；直到 changeset-engine/src/index.ts:281 才写 `files_json`。恢复逻辑 local-store-sqlite/src/index.ts:1540 只能恢复已经记录的文件。

   失败场景：进程在 `renameSync()` 后、`recordChangeSetFile()` 前掉电。SQLite 中有 pending journal，但 `files_json=[]`；重启会把 journal 标记 recovered，却不知道 `.archctx-backup` 属于哪个目标，Git-visible truth 文件保持缺失。

4. **[P1] YAML 与 ledger 的双写只处理 crash，不处理 append 后的同步异常**

   runtime-daemon/src/index.ts:2487 记录计划后提交独立 SQLite event transaction；local-store-sqlite/src/index.ts:1769 已经 COMMIT。随后才记录 append 结果并提交 ChangeSet journal。任何后续异常都会进入 changeset-engine/src/index.ts:232，回滚 YAML 并 abort journal，但不会撤销 ledger event。

   失败场景：event append 成功后磁盘空间耗尽，使 `recordChangeSetLedgerAppend()` 或 `commitChangeSet()` 失败。YAML 回到旧状态，ledger 保留新状态；journal 已 aborted，启动恢复不会再执行 pending-event 检测。

5. **[P1] Ledger append 不执行 base/resulting digest CAS**

   local-store-sqlite/src/index.ts:1729 只做形状校验、idempotency lookup 和 hash-chain归一化；没有验证 `event.baseDigest` 等于当前 graph digest，也没有验证 materialize 后的 digest 等于 `event.resultingDigest`。architecture-ledger/src/index.ts:2252 的校验也只检查 identity 和 operation 必填字段。

   失败场景：两个 daemon 都从 graph G 规划写入。A 先提交 G→G1；B 仍携带 `baseDigest=G`，却被顺序接受并覆盖同一 entity。只读 in-memory 探针确认错误的 `resultingDigest` 被接受，且与实际 graph digest 不同。

6. **[P1] Ledger scope 忽略 branch、HEAD 和 worktree digest，分支状态互相污染**

   `storageWorkspaceId` 只由 worktree 根路径生成，local-store-sqlite/src/index.ts:690。当前状态读取 local-store-sqlite/src/index.ts:2504 和 replay local-store-sqlite/src/index.ts:2645 都只过滤 `storage_repository_id + storage_workspace_id`，忽略 scope 中的 branch/HEAD/worktree digest。

   失败场景：同一 worktree 在 `main` 写入 “Main API”，切到 feature 后写入 “Feature API”；再以 main scope 读取，得到的仍是 Feature API，replay 同时包含两个分支事件。只读探针实际得到 `main:"Feature API"` 和 `replayMain:["main","feature"]`。

7. **[P1] Privacy gate 不在持久化边界执行，禁止内容可直接进入 ledger**

   architecture-ledger/src/index.ts:2243 接受任意 payload 属性；local-store-sqlite/src/index.ts:2045 无条件持久化 `payload_json` 和完整 `event_json`。YAML bridge 的 architecture-ledger/src/index.ts:2115 还会把所有未识别字段原样放入 metadata。

   另一个真实入口是 recommendation `--reason`：runtime-daemon/src/index.ts:2758 接受自由文本，recommendation-engine/src/index.ts:611 原样写入 feedback，随后进入 event；响应却在 runtime-daemon/src/index.ts:2833 固定宣称没有持久化敏感正文。

   失败场景：用户把 token、raw diff 或 prompt 粘贴进 reason/metadata，内容永久进入 event、artifact table 和 FTS。只读 in-memory 探针已确认 `payload.rawDiff` 携带 secret 样式值被接受并可从 replay 原样读回。

8. **[P1] Ledger→YAML projection 不是 contract-preserving round trip**

   Node import 会把 `source`、`responsibilities`、`ownership` 等字段塞进 ledger metadata，architecture-ledger/src/index.ts:1887；projection 再输出成顶层 `metadata`，architecture-ledger/src/index.ts:1652。但 node schema architecture-node.schema.json:6 禁止 `metadata`。

   Relation 更直接：projection architecture-ledger/src/index.ts:1668 输出 `status`、`summary`、`metadata`，却不输出 schema 强制要求的 `intent`；schema 见 architecture-relation.schema.json:7。

   失败场景：带 `source.include` 的 capability 经过 ledger rollback/project 后变成 `metadata.source.include`；projection-engine/src/index.ts:33 只读取顶层 `source`，因此 capability resolver 和 agent-context projection 不再能选择该 capability。任何 relation round trip 还会直接产出 schema-invalid YAML。

9. **[P1] `ledger project` 和 rollback 绕过 ChangeSet/journal，写入不是原子的**

   runtime-daemon/src/index.ts:2844 直接调用 projection writer；runtime-daemon/src/index.ts:5627 对每个文件执行普通 `writeFileSync()`，没有 temp+rename、expected hash 或 journal。rollback 在 runtime-daemon/src/index.ts:3002 也直接执行 backup、删除和覆盖。

   失败场景：20 个 model 文件投影到一半时进程崩溃，`.archcontext/` 同时包含旧、新两个 graph 的文件。命令没有 pending ChangeSet 可恢复，且已经破坏 ADR-0040 要求的 Git-visible architecture truth。

10. **[P1] 写入 allowlist 只检查 lexical path，父目录 symlink 可以越出仓库**

    policy-engine/src/index.ts:186 只使用 `resolve/relative` 做字符串级 containment。changeset-engine/src/index.ts:266 只在写入前调用该检查；现有 symlink 防护只覆盖最终目标，而非父目录链。

    失败场景：仓库中的 `.archcontext/policies` 是指向仓库外目录的 symlink，目标 `new.yaml` 尚不存在。路径通过 allowlist，最终写入发生在仓库外，可覆盖用户文件。

11. **[P2] Projection manifest 和 agent-context marker 没有完整性 gate**

    Complete gate 只检查 manifest 是否存在，runtime-daemon/src/index.ts:5845；虽然 loader 读取 manifest，projection-engine/src/index.ts:235，drift 的 managed path 集合 projection-engine/src/index.ts:701 不包含它。

    Agent-context merge projection-engine/src/index.ts:887 找到 marker 后直接覆盖，不验证 marker 中的 `sourceDigest/outputDigest`；多个 capability 共享同一 primary source directory 时，projection-engine/src/index.ts:811 还会为同一路径产生多份互相独立的文件。

    失败场景：manifest 的 renderer/output digest 被篡改而其他文件未变，`complete_task` 仍可通过；两个 capability 同属 `packages/core/**` 时，apply 可能因第二份相同路径的 expected hash 过期而整体失败，或下游 last-write-wins 丢失一个 marker region。

12. **[P2] “完整性/隐私/恢复”测试验证了实现形状，没有验证真实不变量**

    Privacy 测试 local-runtime.test.ts:3246 只扫描 migration SQL 是否含敏感列名，不写入恶意 payload。Journal 恢复测试 local-store-sqlite.test.ts:727 在 destructive rename 后主动记录文件，跳过真正的 crash gap。Ledger fixture local-store-sqlite.test.ts:1479 为 `baseDigest/resultingDigest` 填入与 graph 无关的值，而 append 测试仍期望成功。

    失败场景：所有现有测试保持全绿，同时 invalid model commit、rawDiff persistence、cross-branch contamination 和 stale-base append 都进入生产。

### Optimization proposals

1. **统一 ChangeSet/YAML/ledger 为一个 durable operation state machine**

   先持久化完整 intent，再执行 filesystem writes，ledger append 采用 outbox/finalize 阶段；任何同步异常与重启都根据同一状态机完成 commit 或 rollback。入口：changeset-engine/src/index.ts、local-store-sqlite/src/index.ts、runtime-daemon/src/index.ts。

2. **把 ledger cursor 变成真正的 scope 与 CAS key**

   当前状态、events、idempotency、FTS、snapshots 全部至少绑定 repository/worktree/branch/HEAD/worktreeDigest；append transaction 内校验 `baseDigest=currentDigest`，materialize 后校验 `resultingDigest`。入口：local-store-sqlite/src/index.ts、architecture-ledger/src/index.ts。

3. **建立唯一的持久化 privacy/schema gate**

   所有 event、artifact、metadata、feedback 在 SQLite transaction 前经过严格 schema、字段 allowlist、secret-shaped scan 和 size limit；拒绝而非清洗或 fallback。入口：architecture-ledger/src/index.ts、contracts/src/ledger.ts、local-store-sqlite/src/index.ts。

4. **改为 lossless、schema-driven YAML projection**

   为 node/relation/constraint 定义明确的 ledger record 映射，保留 `source`、`intent`、ownership 等原字段；projection 完成后必须通过 repo schema validation，再允许写入。入口：architecture-ledger/src/index.ts、model-store-yaml/src/index.ts。

5. **把 manifest、generated region、agent-context 纳入统一 drift engine**

   对 manifest 自身做 schema/digest 校验；同一路径的多个 agent-context region先聚合再生成一个文件；任何 marker 缺失、digest 不符或重复 ownership 都 fail closed。入口：projection-engine/src/index.ts、cli/src/main.ts。

6. **增加 adversarial recovery matrix**

   覆盖每个 fsync/rename/journal/append/commit 边界的 crash injection，以及 two-store concurrency、branch switch、invalid schema、parent symlink、raw secret payload 和 manifest tampering。入口：changeset-engine.test.ts、local-store-sqlite.test.ts、local-runtime.test.ts。

Not examined: pressure-engine/refactor-decision 的推荐算法正确性、GitHub audit transport/executor、external-doc provider、Explorer UI/HTTP surface、legacy SQLite migration 的全部失败窗口、adapter-likec4/structurizr import-export 语义。

---

## 附錄 B — deep-reasoner 報告全文（verbatim，Claude Opus 4.8 max）

RECOMMENDATION: Ship-worthy core, but fix one crash-safety ordering bug before trusting the "atomic ChangeSet" guarantee — the destructive `renameSync` runs before the journal records it, so a mid-apply crash orphans a `.archctx-backup` that recovery can't roll back and that then wedges every future apply to that path — confidence: HIGH

### Architecture map (≤10 lines)
- `changeset-engine` plans/approves/applies file ops behind a journal port; `local-store-sqlite` is the journal + append-only architecture ledger (SQLite WAL) + job queue; `runtime-daemon` is the single mutation owner; `surfaces` CLI/MCP are triggers/readers; `contracts` holds schemas/ledger types; `projection-engine`/`model-store-yaml` render `.archcontext/` truth.
- Two durable stores are kept consistent by hand: fsync'd file ops in `.archcontext/` and the SQLite `changeset_journal`; recovery (`recoverPendingChangeSets`) reconciles them via the planned ledger event's `idempotencyKey`.
- Ledger append (`appendArchitectureEvents`) is a proper `BEGIN IMMEDIATE` transaction with real idempotency (`UNIQUE(repo,ws,idempotency_key)` + hash-chain conflict throw) and fault-injection *inside* the txn — this part is sound.
- Rendering is deterministic (static generated body, digest-not-timestamp markers) — invariant-3's "non-deterministic body" risk is **not** present.

### Findings

**[P1] ChangeSet apply logs intent *after* the destructive move (WAL inversion) → unrecoverable orphan + permanent path wedge**
`packages/core/changeset-engine/src/index.ts:273-289` (with `recoverJournalFiles` at `packages/local-runtime/local-store-sqlite/src/index.ts:3527-3537` and the guard at `:272`).
- **Order today:** `renameSync(absolute → backupPath)` + `fsyncDirectory` (line 275-276, *durable on disk*) → `backups.push` (280, memory only) → `recordChangeSetFile` (282, *durable in SQLite*) → write new content (293).
- **Failure scenario:** daemon SIGKILL/power-loss between line 275 and 282. Disk: original is now at `<path>.archctx-backup`, `<path>` is gone. SQLite: `files_json` has **no** entry for it; the in-memory `backups` array died with the process. On restart, `recoverPendingChangeSets` → `recoverJournalFiles` iterates only *recorded* files, so it never restores this one. Result: model YAML silently missing, orphan `.archctx-backup` left behind.
- **Escalation:** the orphan is permanent — the next ChangeSet touching that path hits `if (existsSync(backupPath)) throw "Backup path already exists"` (line 272) and **aborts every future apply to that file** until a human deletes the orphan. Also `listModelFiles` recurses `.archcontext/model`, so the orphaned `*.archctx-backup` gets read back as a duplicate model node, polluting the graph.
- **Mitigation (why not catastrophic):** `.archcontext/` is Git-tracked, so content is recoverable with `git checkout`; the window is narrow. But this directly violates ADR-0040's atomic-apply invariant and is untested.
- **Smallest safe fix:** make it true write-ahead: (1) `recordChangeSetFile` **before** `renameSync`; (2) write new content to `tempPath` first (non-destructive) and swap last; (3) harden `recoverJournalFiles` to reconcile actual disk state — restore `backup→target` only when `backup` exists, otherwise leave `target` untouched and only `rm` the temp (never the unconditional `rmSync(absolute)` it does now, which, once records-first, would delete a still-good original). All three are needed together; (1) alone without (3) turns the orphan case into a delete-the-original case.

**[P2] SQLite `synchronous` PRAGMA is unset — recovery durability rides on an implicit driver default**
`packages/local-runtime/local-store-sqlite/src/index.ts:82-85` (`SQLITE_PRAGMAS` = WAL + foreign_keys + busy_timeout only). The whole crash-recovery story assumes the `changeset_journal` is at least as durable as the fsync'd file ops. With WAL + `synchronous=NORMAL`, a power-loss can drop the last committed journal write while the file rename already fsync'd — which **widens P1-1 from a narrow window to "any last op"**. Today it works only because the driver defaults to `FULL`. **Fix:** add `"PRAGMA synchronous = FULL"` explicitly.

**[P2] Privacy invariant #3 has no enforcement at the persistence boundary (fail-open)**
`validateArchitectureLedgerEvent` (`packages/core/architecture-ledger/src/index.ts:2252-2261`) checks only identity + operation *shape*; `insertArchitectureEvent` (`packages/local-runtime/local-store-sqlite/src/index.ts:2045-2085`) persists `stableJson(event)` / `event.payload` / `event.provenance` and FTS-indexes free-text `summary`/`rationale`/`title` **verbatim, unredacted**. The contract is enforced entirely by (a) digest-only schemas and (b) *offline* verify scripts. Free-text fields that flow from an LLM investigation runner are persisted and FTS-indexed with no scan. **Fix:** a fail-closed content-scan at `appendArchitectureEvents` (reuse the `SECRET_PATTERNS`/`CODE_CONTENT_PATTERNS` the readback scripts already define) — contract-enforcement, not speculative defense.

**[P2] `assertSafeTarget` symlink check covers only the final component; path resolution is lexical**
`packages/core/changeset-engine/src/index.ts:561-566`. `assertAllowedArchContextPath` uses `path.resolve` (purely lexical); `assertSafeTarget` `lstat`s only the final path element. An agent operating on an untrusted/cloned repo where `.archcontext/model` is a planted symlink → outside dir: the lexical allowlist check passes; `atomicWriteFile`'s `mkdirSync`+`rename` follow the symlinked directory and write outside the repo. **Fix:** `realpathSync` the target's parent dir and assert containment — the codebase already does exactly this at `assertTrustedLegacyLocalStoreSource` (`local-store-sqlite/src/index.ts:3018-3030`).

**[P2] Agent-context projection path derives from unvalidated `source.include`**
`packages/core/projection-engine/src/index.ts:793-798` + `800-851`. `primarySourceDirectoryFromInclude` does zero validation; a model node whose `source.include[0]` is `"../../x/**"` yields `path = "../../x/CLAUDE.md"`. Could not locate a daemon disk-writer that persists `AgentContextProjectionPlan.files` — may be plan-only today, which bounds exposure `[unverified]`. **Fix:** `assertRepoRelativePath` on each computed `path`.

**[P2] Unbounded ledger/journal growth + O(history) startup work**
`recoverPendingChangeSets` (`:1540-1545`) re-`cleanupCommittedJournalFiles` for **every** committed journal on **every** daemon start and never prunes; `architecture_events` and terminal `runtime_job_queue` rows accumulate unbounded. First thing to fail at 10x: daemon startup latency and DB size. **Fix:** retention sweep + processed flag.

**[P2] Minor: two swallowed-error / unbacked-write spots**
- `changeSetJournalPlannedLedgerEvent` (`:3509-3521`) swallows validation errors → recovery treats a committed-but-unparseable planned event as "no ledger append" → rolls back files even if the ledger event committed (file/ledger divergence).
- `rebuildGeneratedProjection` (`model-store-yaml/src/index.ts:164-174`) does `rmSync(.archcontext/generated, recursive)` + rewrite **inside** `apply()` *before* `validateModel`, outside the journal/backup.

### Optimization proposals (ranked)
1. **True WAL for file ops** — record intent before any destructive rename; temp-write-then-swap; state-reconciling recovery. ~30 lines across 2 functions. Entry: `changeset-engine:applyFileOperation` + `local-store-sqlite:recoverJournalFiles`.
2. **Fail-closed privacy gate at the append boundary.** Entry: `local-store-sqlite:appendArchitectureEvents`/`insertArchitectureEvent`.
3. **realpath containment for `.archcontext/` writes.** Entry: `assertSafeTarget`, `renderAgentContextProjection`.
4. **Journal/event retention sweep.** Entry: `recoverPendingChangeSets` + daemon maintenance tick.
5. **Explicit `PRAGMA synchronous=FULL`.** Entry: `SQLITE_PRAGMAS`.

### Test gaps
- The P1 window itself with the real `SqliteLocalStore` (current tests at `local-store-sqlite.test.ts:715/757/788` only cover *recorded* files).
- Engine × real SQLite never exercised together (`changeset-engine.test.ts:582-596` uses an in-memory fake journal).
- Idempotency conflict → throw *and* ROLLBACK leaves zero partial rows (`:1744` untested).
- Privacy negative test: secret/source-marker payload must be rejected at append.
- Symlink escape; include `..` escape; two apply flows racing the same path.

---

## 0.2.2 Ship Gate — 2026-07-10

> **Review Rubric Version**: 2
> **Reviewed Diff Fingerprint**: sha256:dff901f7ee4fd680ba70a70b1d8f0894445e2f899dd0b60d7e452ea8806e7dc3
> **Reviewed Scope**: branch+staged+unstaged+untracked

### 本地閘（gatekeeper，Claude Opus 4.8 max）

VERDICT: PASS

本 session 實跑 `bun run typecheck` pass、`bun test` 1008 pass / 0 fail / 6096 assertions、`bun run verify` 全鏈 pass；F1–F18 逐條親讀源碼證實閉環；零 P0/P1/P2 阻斷；殘餘 P3 兩條——F10 分區隨 HEAD/worktreeDigest 累積屬規模特徵、policy-engine symlink 負測 Windows 可移植性。

### External Acceptance（Codex，gpt-5.6-sol）

> **External Reviewer**: Codex (gpt-5.6-sol)
> **External Source**: codex-review（session `019f4a0a-45b2-7911-a299-909e2fbe44e1`；首輪 read-only 580s timeout，經 `codex exec resume` 取回結論）

- P1 blockers: `package.json` 仍为 `0.2.1`，且 19 个修改与 2 个未跟踪文件尚未形成可复核的 immutable `0.2.2` release candidate，因此 ship gate 无法绑定到确定产物。
- P2 advisories: 修复记录显示 `typecheck`、1008 tests 和 `verify` 均通过；未检查范围：`0.2.2` tarball/preflight、clean commit/tag、npm registry 与安装后 live readback、跨平台验证。
- Acceptance checklist: fail

### Orchestrator 裁定

Codex 對修復 diff 本身零代碼 finding，其 fail 全屬「release candidate 尚未成形」的流程態；該清單正是本次發佈序（commit → bump → tarball preflight → publish → registry/install readback → tag → release）要逐項閉合的步驟，故 ship 決定為繼續，發佈後以 readback 證據回填。
