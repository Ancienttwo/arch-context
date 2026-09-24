# ArchContext 架构审计（2026-09-24）

日期：2026-09-24。性质：只读源码/契约审计 + 仓库自带确定性检查 + 针对性复现。基准：`main@6e85b35`（0.5.11）。本轮未修改产品代码、`.archcontext/`、SQLite 或任何运行时状态；本文件是唯一产物。

## 方法与基线结果

| 检查 | 结果 |
|---|---|
| `bun run typecheck` | 通过 |
| `archctx validate --json` | `valid: true`，无错误（但见 F4：模型几乎不含依赖声明，校验面很小） |
| `archctx practices validate --strict` | 通过（catalog 2026.06.0） |
| `node scripts/package-boundary-audit.mjs` | 通过（仅约束 5 个 workspace 级边界，不约束子包/层方向的全部规则） |
| `archctx refactor scan --json`（自扫描） | 23 个模块；`codeFacts.coverage=unknown`、`truncated=true`、reasonCodes=`code-facts-missing, code-facts-truncated, caller-coverage-unknown, unowned-paths`；`crossModuleEdgeCount=0`，1238/1318 tracked 文件无 owner |
| `bun test` | 见文末“验证环境说明” |

人工审计按四个维度并行展开，关键结论均由主线程回到源码逐条复核：写权威/变更边界、模块内聚与 god-file、声明模型与代码漂移（含 ADR 卫生）、信任边界与云端。

严重度：P1 = 违反已接受 ADR 不变量或存在可利用安全缺陷；P2 = 结构性偏离、可维护性/治理风险；P3 = 卫生问题。

---

## P1

### F1 / P1（安全，已复现）：仓库内容可向 daemon 执行的 `git diff` 注入选项

- `packages/core/projection-engine/src/index.ts:1266-1294` 读取仓库内提交的 `docs/architecture/.projection-manifest.json`，`verifiedAgainst` 原样透传，未校验 `commit` 形状。
- `packages/local-runtime/runtime-daemon/src/index.ts:8674-8678` 取出 `commit`，`:8295` 执行 `execFileSync("git", ["diff", "--name-only", `${commit}..HEAD`])`，无 `--end-of-options`。
- 触发路径：`completeTaskProjectionFreshness`（`:8652`），即每次 `archcontext_complete_task`。
- 复现（scratch repo）：`git diff --name-only "--output=<dir>/pwned..HEAD"` 会在任意可写目录创建/截断名为 `*..HEAD` 的文件。影响受文件名后缀约束，但它是“仓库内容 → daemon 以用户身份写文件”的通道，违反 ADR-0003 将仓库视为不可信输入的边界。
- 修复：loader 中 `commit` 必须匹配 `^[0-9a-f]{40}([0-9a-f]{24})?$`；git 调用在 revision 前加 `--end-of-options`；为其它以外部值拼接 git argv 的调用补同样防护并加回归测试。

### F2 / P1（不变量）：daemon 在获得单写者锁之前执行崩溃恢复

- `ArchctxDaemon.start()`（`runtime-daemon/src/index.ts:1316-1319`）依次执行 `migrate()`、`recoverPendingSnapshots()`、`recoverPendingChangeSets()`；后者会按 pending journal 回滚 `.archcontext/` 文件，前者删除 pending snapshot。
- 锁在之后才获取：`ArchctxRuntimeRpcServer.start()` 先 `daemon.start()`（`:6336`），再 `acquireDaemonLock`（`:6342`）。`withWriter` 只是进程内布尔。
- 无锁入口：`scripts/apply-model-proposal.ts:115`（`bun run apply:model-proposal`，打开真实 `defaultLocalStorePath`，并继续 plan/apply），CLI 测试注入的 embedded runtime（`cli/src/main.ts:3773-3778`），以及 `runForegroundDaemon`（`:4241`）在拿锁前已完成恢复。
- 后果：在 archctxd 运行期间启动第二个进程，可在任何锁拦截之前回滚正在进行的 ChangeSet、删除其 pending snapshot。违反 ADR-0005 与 authority matrix 的 single-writer 行。竞态窗口为代码顺序推导，未做并发复现。
- 修复：把锁（或 SQLite `BEGIN EXCLUSIVE` 恢复守卫）移入 `ArchctxDaemon.start()`，先锁后恢复；`apply-model-proposal` 与 embedded 模式在检测到活跃 connection/lock 时拒绝启动，改走 RPC。

### F3 / P1（ADR 未兑现）：Cloud control plane 与签名边界停留在内存实现

- `ControlPlane`（`packages/cloud/control-plane/src/index.ts:862-876`）全部状态为内存 `Map/Set`；唯一 Worker `deploy/cloudflare/fg2-staging-worker.ts:120` 每请求 `new ControlPlane()`，不读 `CONTROL_PLANE_DB` D1 binding；`wrangler.jsonc` 无 Queue binding。`cloud-db` 有 D1 migration，但其 `TransactionalSqlDatabase` 为同步接口且未接线。与 ADR-0017（Workers + D1 + Queue）不符。
- CLI 进程内静态依赖 cloud 服务端代码：`cli/src/main.ts:2782/2966` `new ControlPlane()` 后 `claimReviewChallengeLease`——lease 只存在于 CLI 进程内，不协调任何东西。
- `github connect` 向 token store 保存合成 refresh token：`main.ts:2722` `refresh_${accountId}_${Date.parse(connectedAt)}`；`KeychainTokenStore` / `CredentialSecretStore` 实际为内存 Map（`control-plane-client/src/index.ts:89-127`），设备私钥进程退出即丢失。ADR-0016 的本地签名边界未真正交付，但状态文件会报告 “connected”。
- 建议：二选一并落 ADR——(a) 实现 D1/Queue 持久化与真实 OS keychain，并在无 keychain 时拒绝 connect；(b) 将 ADR-0017/0016 标为 “partially implemented / staging-only”，CLI 的 developer review 相关命令明确标注为非生产能力。无论哪条路，都应去掉合成 refresh token。

### F4 / P1（治理自洽）：ArchContext 无法用自身模型治理自身

- `.archcontext/model/relations/` 仅 1 条 relation（capability → projection-renderer），实际子包级 import 边约 95 条、跨层边 11 类；`flows/` 仅 1 条。
- `manifest.yaml` 的 `review.failOn` 包含 `prohibited-dependency`，pressure-engine 以 boundary-crossing import 为信号，但在没有 relation/约束的情况下二者对本仓库永远不会触发。`policies/review.yaml` 的 failOn 只有 3 项，与 manifest 的 5 项不一致。
- component 粒度只覆盖 core：local-runtime 7 个、surfaces 7 个、cloud 9 个子包，以及 core 的 `module-statistics`、`refactor-assessment` 没有 component 节点——而最大的四个 god-file 恰好在这些未建模的子包里（见 F5）。部分已建模 component 的 summary 漏掉大块职责（architecture-ledger 的 ~1100 行 book 检索、recommendation-engine 的 V3 refactor 管线、agent-orchestrator 的 runner adapters）。
- ADR frontmatter 的 `appliesTo` 使用 `package.*` / `app.*` id，全部不匹配任何真实 node id，且命名自相矛盾（`package.cli` vs `package.surfaces-cli`）；`app.control-plane` 指向不存在的 `apps/`；loader 完全忽略 `appliesTo`（`projection-engine/src/index.ts:854-872`）。ADR 与模型之间没有可机器校验的关联。
- 自扫描结果（上表）进一步说明：本仓库环境下 code facts 缺失，结构证据无法闭环。
- 建议：把“自举”作为验收门——为每个 `packages/<layer>/<pkg>` 建 component 节点，按实际 import 生成 `depends_on` relation 与层方向约束（contracts ← core ← local-runtime ← surfaces；cloud 不得依赖 local-runtime），把 ADR `appliesTo` 迁移到真实 node id 并在 validate 中校验。这也是 `tasks/todos.md` 中 “Measured direction violations” 延期目标最直接的真实样本来源。

### F5 / P1（信任边界）：本地 audit 的同意闸与出站描述由仓库控制/失真

- `auditRun` / `auditApprove` 的开关是仓库内提交的 `.archcontext/manifest.yaml: audit.githubIssues.enabled`（`runtime-daemon/src/index.ts:1830-1836`, `:2118`）。克隆的第三方仓库可以替用户“同意”启用 audit。
- `investigation-transport.ts:41` `spawn(command, args, { cwd })` 未设 `env`，`claude` 子进程继承 daemon 全量环境，包括 daemon 读取的 `ARCHCONTEXT_GH_ISSUES_TOKEN`（`index.ts:166`, `:2152`）；与 ADR-0042 “subagent 永不获得通往 gh 的路径”不符。对照：`runGh` 已做 env 白名单（`github-issue-executor.ts:136-146`）。
- ADR-0041 声称 “no network calls… nothing leaves the local machine”，但 `claude --print` 会把读取到的仓库内容发送给模型提供方；`doctor` 的 `defaultOutbound: "local-only"` 为硬编码（`cloud/hardening/src/index.ts:59`），不反映 Context7/audit/gh 的实际状态。
- issue draft 的 secret 检测仅覆盖 GitHub token、JWT、PEM（`github-issue-executor.ts:201-215`），而 draft 由可能被仓库内容 prompt-inject 的 LLM 生成。
- 修复：同意状态移到用户级（state dir 或 env），仓库 manifest 只能“声明可用”不能“授予同意”；runner 使用最小 env 白名单；修订 ADR-0041 出站描述，`doctor` 按实时配置计算 egress；secret detector 复用 Context7 adapter 的 `FORBIDDEN_OUTBOUND_PATTERNS`。

---

## P2

### F6 / P2：god-file 与 RPC 四处重复定义是最大的变更热点

| 文件 | 行数 | 主要问题 |
|---|---|---|
| `local-runtime/runtime-daemon/src/index.ts` | 8876 | 每个 RPC 方法（58 个）需在 4 处同步：`RuntimeDaemonClient` 接口（:1025-1133）、`ArchctxDaemon` 方法、`RuntimeRpcClient`（:6011-6322）、`dispatch` switch（:6517，`params[n] as T` 位置参数强转）。类内混合 audit（~610 行）、projection-apply（~500）、ledger admin（~600）、developer review、explorer server（~900）等；另有 ~2200 行散落 helper。近 212 次提交中被改 30 次，是源码第一热点。 |
| `local-runtime/local-store-sqlite/src/index.ts` | 7764 | 内联 ~770 行 SQL migration、~1100 行 runtime-state 恢复/迁移（文件系统工作而非存储）、81 个方法的单一 store 类。 |
| `surfaces/cli/src/main.ts` | 4404 | 42 个顶层命令一个 switch；~1000 行 projection/docs 领域逻辑（见 F7）；~525 行 GitHub developer review 状态机；~515 行 daemon 生命周期。 |
| `cloud/control-plane/src/index.ts` | 3352 | 101 个方法混合 auth/billing/密钥生命周期/review challenge/投递队列/通知/隐私脱敏/metrics。 |

已有抽取范式（`refactor-scan.ts`、`refactor-verify.ts`、`refactor-recording.ts`、`explorer-projection.ts`、`investigation-transport.ts`、`github-issue-executor.ts`）且对应测试也随之拆分干净，但只抽走了纯计算/执行器，feature 编排仍留在 index.ts。测试同样单体：`local-runtime.test.ts` 6983 行、`cli.test.ts` 4814 行。跨文件重复 helper：`readCurrentBranch`、`readHeadCommittedAt`、`isArchContextGeneratedProjectionPath`（daemon ↔ CLI）、`isProcessAlive`、`writePrivateJson`（daemon ↔ sqlite），以及 `cli/src/hook-fast.ts:159-228` 复制的 `runtimeStatePaths` / `stableStorageId` / `digestJson`。

建议顺序（纯移动、不改写路径）：
1. 以单一方法表生成 `rpc-protocol.ts` / `rpc-client.ts` / `rpc-server.ts`，消除四处重复与位置参数强转；`mcp-local` 只依赖 client。
2. daemon 拆 `developer-review-run.ts`、`ledger-admin.ts`、`audit.ts`、`projection-apply.ts`、`explorer-server.ts`，`ArchctxDaemon` 变为基于共享 `DaemonContext` 的 facade。
3. sqlite 拆 `migrations/`、`runtime-state-recovery.ts`、`ledger-repository.ts`、`explorer-cache.ts`、`agent-job-queue.ts`。
4. CLI 按命令组拆 `commands/*.ts`；共享 helper 下沉到一个无依赖模块并加 parity 测试。

### F7 / P2：CLI 不是薄适配层（ADR-0006 / ADR-0034）

- `cli/src/main.ts:1021-2070` 约 1000 行 projection 领域逻辑：渲染、adoption plan、fixed point、recovery binding、CLI 侧读取 `expectedHash`，然后以 `approved: true` 调 `planUpdate`/`applyUpdate`（:1412-1427）。写入仍经 ChangeSet，不算绕过，但 MCP 无对应入口，ADR-0006 的 CLI/MCP parity 无法成立；ADR-0034 规定 CLI 不构造生产 CodeGraph adapter，而 CLI 直接调用 `prepareArchitectureDocumentationProjectionSnapshot`（:14, :1216）。
- 声明模型的唯一 flow 把这条 CLI 路径列为 entrypoint，等于模型把偏离固化为设计。
- GitHub developer review 的 lease/attestation/submission 状态机由 CLI 持有，并把完整 `ReviewChallengeV2`（含 nonce）与 `AttestationV2`（含签名）写入 `github-developer-review*.json`（:3082-3089），而 `sanitize…` 明确禁止回显 nonce（:3122）。
- 修复：新增 daemon RPC（如 `projectionRun`）承接 projection 管线；developer review 状态进 daemon store 或只持久化 digest。

### F8 / P2：层方向违规与跨层耦合

- 实际层依赖：core → contracts；local-runtime → contracts, core；surfaces → contracts, core, local-runtime, cloud；**cloud → local-runtime**（`cloud/hardening/src/index.ts:5` → codegraph-adapter，`cloud/runner/src/index.ts:22` → git-adapter；`packages/cloud/package.json` 声明了 `@archcontext/local-runtime`）。无包级环。
- core 被模型描述为 “runtime-independent”，但 8 个 core 包直接 `node:fs`，`changeset-engine/src/descriptor-relative-write.ts` 通过 `koffi` 加载 libc（原生 FFI）并执行写入/rename/fsync；`projection-engine` 直接读 `docs/adr`。`core/application/src/index.ts:196-220` `applyArchitectureUpdate` 直接调 `ChangeSetEngine.apply` 且无调用方，是一条潜在的 daemon 外 apply 路径。
- `local-store-sqlite/src/index.ts:52` 以 `../../../../schemas/*.json` 跨出包边界；`deploy/cloudflare/fg2-staging-worker.ts`（真实 cloud composition root，723 行）以相对路径 import 各包源码，绕过 package exports。
- 修复：runner/hardening 通过 contracts 中的 port 注入 git/codegraph 能力；core 的文件 I/O 收敛到 port，由 local-runtime 实现（或修改模型 summary 如实描述）；删除 `applyArchitectureUpdate` 或设为 internal；把以上方向规则写进 F4 的 relation/约束和 `package-boundary-audit.mjs`。

### F9 / P2：ChangeSet 之外的 `.archcontext/` 写入

- `archctx init`：`runtime-daemon/src/index.ts:1388-1391` → `model-store-yaml/src/index.ts:149-188`，无存在性/expected-hash 检查地覆盖 `manifest.yaml`、`product.yaml`、`policies/review.yaml`、`projections/targets.json`、根 capability 节点，并清理 generated 目录。对已初始化仓库重跑 `init` 会静默替换声明架构（CLI `case "init"`，`main.ts:271-282` 亦无守卫）。违反 ADR-0012。
- `.archcontext/integrations/context7.lock.yaml` 由 daemon 直接写（`index.ts:7906-7914`），有 expected-hash 但无 journal/回滚，且对 Git 跟踪文件使用 `0o600`。
- `archctx state recover --write` 在 CLI 进程内隔离/删除 SQLite 并发布新 `runtime.sqlite`（`main.ts:601-627` → `local-store-sqlite:1129-1240`）。守卫充分（daemon 停止断言、迁移锁、指纹/digest 前置条件），但 ADR-0005 与 authority matrix 未登记该例外。
- 修复：init 在 manifest 已存在时失败，或表达为 `expectedHash: "missing"` 的 create 操作；lockfile 走 ChangeSet 或在 ADR-0012/0039 显式豁免；在 ADR-0005/matrix 登记离线恢复例外。

### F10 / P2：MCP 写入审批由 agent 自证

- `mcp-local/src/index.ts:199-206`：`args.approved` 由调用方 agent 提供，即转为 `approved: true`；唯一额外保护是依赖宿主实现的 `requiresConfirmation` 注解（:65）。
- `listChatGptTools` 在列表中隐藏 `apply_update`（:135-137），但 `callTool` 未强制同一 allowlist，仍可调用（ADR-0019：ChatGPT 默认不暴露 Apply ChangeSet）。
- 影响受 allowlist 路径与新鲜 worktree digest 约束。修复：`callTool` 按 surface 强制 allowlist；审批绑定 daemon 签发、在 agent 通道之外确认的一次性 token（可复用 `tunnel` 的确认机制或 CLI preview digest）。

### F11 / P2：持久化守卫缺口

- `jobsComplete`（`runtime-daemon/src/index.ts:1765-1779`）将任意 RPC 客户端提供的 `runMetadata`、`error` 写入 `runtime_job_queue.job_json`，无 `assertArchitectureLedgerPersistenceSafe`、无大小上限、无 secret 扫描。
- `ARCHITECTURE_LEDGER_FORBIDDEN_RAW_KEYS`（`core/architecture-ledger/src/index.ts:2565-2587`）缺 `body`/`diff`/`patch`（orchestrator 的键集包含），字符串检查只匹配 `diff --git `，8KB 内的裸 `---/+++/@@` hunk 可通过。
- 修复：对 `runMetadata`/`error`/`bodyMarkdown` 执行统一守卫；对齐两套键集并增加 unified-hunk 模式。

### F12 / P2：`@archcontext/contracts` 被配置为可公开发布

`packages/contracts/package.json`：`"private": false` + `publishConfig.access: "public"`，与 ADR-0034（所有 workspace 保持 `private: true`）及 `docs/spec.md:112`（“never the public contracts artifact”）矛盾，存在误发布内部 scoped 包的风险。修复：改回 `private: true`，或以新 ADR 明确 contracts 公开发布策略（`README` 中 repo-harness 依赖 `archctx-contracts` 的现状需一并说明）。

---

## P3

- **生成的 ADR 索引损坏**：`docs/architecture/decisions/index.md` 中 44 条标题都是 “Context”（取了第一个 `# ` 标题而非 frontmatter `title`）；链接 `../../docs/adr/...` 从 `docs/architecture/decisions/` 解析为 `docs/docs/adr/...`（`projection-engine/src/index.ts:1805`）。ADR-0022 已被 ADR-0029 取代但仍为 `status: accepted`。
- **manifest 指向不存在的目录**：`content.decisions: .archcontext/decisions`、`content.practices: .archcontext/practices` 不存在（ADR 实际在 `docs/adr`）。`tsconfig.json` 仍 include `apps/**`。
- **本地 RPC 细节**：RPC/Explorer token 用 `===` 比较（`index.ts:6514`, `:5902`）；Explorer 接受 `?token=`；`/health` 无 token、无 Host/Origin 校验（`:6460`），DNS rebinding 页面可读 PID 与 composition report；win32 下 `isPrivateControlFile` 恒真（`:8563`）。
- **staging readback HMAC** 复用 `GITHUB_WEBHOOK_SECRET` 且不校验时间戳新鲜度（`fg2-staging-worker.ts:623-635`）。
- **Cloud submit 接受调用方提供的身份与公钥**，`signingKeyStatus` 可选导致撤销检查可被跳过（`control-plane/src/index.ts:1690-1711`，`attestation/src/index.ts:384-392`）；当前 Worker 未暴露该路由，可利用性未验证。
- **无单一 egress 闸口**：`scripts/local-no-cloud-e2e.mjs` 只清 env 不阻断网络；现有出站为 Context7、`npm view`（opt-in）、`claude`、`gh` 子进程。
- **`scripts/` 是未建模的影子代码库**：约 51.7k 行（与 `packages/**/src` 约 61k 行同量级），`package.json` 174 个 script 中 137 个为 record/readback/verify/e2e 证据脚本；39 个非测试脚本直接 import 包内源码。证据生产机制本身没有 owner、没有边界约束。建议为 `scripts/` 建 node 并按 sprint/功能归档已冻结的 readback 脚本。
- **导入风格不一**：core 内 10 处 `../../x/src/index` 相对导入与 `@archcontext/core/x` 混用；core/local-runtime 根 barrel 不完整；`surfaces/explorer-ui` 只是 `export *` 自 `local-runtime/explorer-html`。
- **文档漂移**：`docs/spec.md:37` 称 MCP 暴露 5 个工具，`LOCAL_MCP_TOOLS` 实为 6 个（含 `archcontext_practices`）。
- **测试密封性**：`tests/ownership-change-acceptance-recovery.test.ts:107` 通过 `execFileSync("codegraph", …)` 依赖全局 PATH，而非 `node_modules/.bin`。

---

## 已确认稳固的控制

- 本地 RPC 仅绑定 `127.0.0.1`，拒绝非 loopback peer，`POST /rpc` 需随机 bearer token（跨源浏览器无法无预检携带），connection 文件 `0600` 且读时复核；锁文件以 `wx` 创建。
- Explorer 仅 GET、token 有 TTL 可撤销、严格 CSP、HTML 转义。
- 全部子进程均为 argv 数组，产品代码中无 `shell: true`。
- audit runner 限定 `--tools Read,Grep,Glob`、禁 Bash/Edit/Write、`--strict-mcp-config`、`--setting-sources user`；gh executor env 白名单、body 经 `0600` 临时文件、stderr 脱敏、all-or-nothing preflight。
- Webhook HMAC 使用 `timingSafeEqual`；cloud-db 参数化 SQL、nonce 原子消费、attestation 追加only触发器。
- ChangeSet 路径 allowlist + containment + 最近存在祖先 realpath + 拒绝符号链接目标；projection layout 同样做 containment/symlink 检查。
- 所有 ledger 事件经 `assertArchitectureLedgerPersistenceSafe`；ChangeSet journal 仅含元数据与 digest；`ledger promote` 仅 preflight。
- `mcp-local` 无 fs/SQLite 依赖，纯 RPC；`model-store-yaml` 写函数只被 daemon 调用。
- ADR-0045（authority-separated data engine）的 contracts/存储/编译器分层已落地，explorer 编译器不 import store。
- 各 workspace `package.json` 依赖声明与实际 import 一致；子包级与层级均无依赖环。

## 建议路线

| 批次 | 内容 | 规模 |
|---|---|---|
| 立即（小改动、高收益） | F1 commit 校验 + `--end-of-options`；F2 先锁后恢复、脚本拒绝并发；F5 runner env 白名单 + 用户级同意；F10 `callTool` 强制 surface allowlist；F12 contracts 改回 private；F9 init 存在性守卫 | 各自 1 个 PR，均需回归测试 |
| 近期 | F4 自举模型（component/relation/层约束、ADR `appliesTo` 校验）；F11 守卫对齐；P3 ADR 索引修复 | 模型变更须走 ChangeSet |
| 中期 | F6 RPC 方法表 + daemon/sqlite/CLI 纯移动拆分；F7 projection 管线入 daemon RPC；F8 cloud→local-runtime 解耦 | 多 PR，按热点排序 |
| 决策项 | F3：实现 ADR-0017/0016 或将其降级为 staging-only 并修订 ADR | 需产品决策 |

## 验证环境说明

- 容器预装 bun 1.3.11，而仓库 `packageManager` 固定 `bun@1.4.0`。在 1.3.11 下 `bun test` 于约 47s 处因 N-API finalizer 触发 Bun 自身 panic（`napi_reference_unref`，exit 132），属运行时缺陷而非仓库测试失败；崩溃前唯一失败为上述 `codegraph` PATH 依赖用例。随后使用本地安装的 bun 1.4.0 重跑，结果见提交说明/PR 描述。
- 自扫描 `code-facts-missing` 源于本环境未建立 CodeGraph 索引；本轮为避免写入状态未执行 `archctx sync`。
