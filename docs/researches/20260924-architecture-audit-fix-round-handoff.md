# Handoff：2026-09-24 架构审计与第一轮 P1 修复

> Date: 2026-09-24
> From: Claude Code 审计 + 修复会话
> To: 仓库 owner / 下一个接手的 agent
> Status: 第一轮修复已合入 `main`；剩余工作见“下一步”
> Main after this round: `4ac7849`（#177 合并后；#158 合并只追加文档）

## 一句话结论

完成一轮只读架构审计 → 外部（GPT）复核 → 开 16 个 issue → 修复并合入 4 个 P1 级问题（6 个 issue）。修复均先写回归测试并在未修复代码上确认失败；三平台 × 三 Node 版本 CI 全绿后合并。剩余 1 个 P1（#161，需要设计决策）与若干 P2/P3。

## 文档入口

| 文档 | 内容 |
|---|---|
| [`20260924-architecture-audit.md`](./20260924-architecture-audit.md) | 审计报告；顶部“复核处置”表与修订后的执行顺序优先于正文 |
| [`20260924-architecture-audit-review-handoff.md`](./20260924-architecture-audit-review-handoff.md) | 给外部 reviewer 的复核 handoff（已复核，保留供追溯） |
| 本文件 | 本轮修复结果、经验教训与下一步 |

## 已合并 PR

| PR | 修复 | 关键点 |
|---|---|---|
| [#175](https://github.com/Ancienttwo/arch-context/pull/175) | #159、#173 | manifest stamp commit 先经 `assertArchitectureProjectionVerifiedAgainst` 再进 git；`--end-of-options`；changed paths 用 `-z` 按 NUL 切分；git-adapter 拒绝形似选项的 revision |
| [#176](https://github.com/Ancienttwo/arch-context/pull/176) | #160、#172 | 存储文件旁 pid 锁（`<store>.owner.lock`，temp+hard link 原子发布，不可读锁 10s 宽限）在 `ArchctxDaemon.start()` 迁移/恢复前获取；恢复后仍 pending 的 journal 阻断 `withWriter` 并在 `status().changeSetRecovery` 暴露；CLI 每条命令单一 runtime 且等待命令完成再关闭 |
| [#177](https://github.com/Ancienttwo/arch-context/pull/177) | #167 | `init` create-only（已存在或部分初始化即 `AC_PRECONDITION_FAILED`，不写任何东西）；逐文件 no-follow 原子创建，create-only 提交用 hard link（不会覆盖检查后出现的文件）；失败（含 generated 重建失败）回滚本次创建的文件；no-follow writer 总是 `fchmod` |
| [#158](https://github.com/Ancienttwo/arch-context/pull/158) | — | 审计报告、复核 handoff、本文件 |

合并顺序：#175 → #176 → #177 → #158。后两个修复 PR 在同一测试文件同一锚点插入测试，合并前各自并入最新 `main`、解冲突、本地全量测试 + CI 全绿后才合并。

## Issue 状态

**已关闭（本轮修复）**：#159、#160、#167、#172、#173。

**仍开放（按修订后的执行顺序）**：

| 顺序 | Issue | 严重度 | 说明 |
|---|---|---|---|
| 1 | [#161](https://github.com/Ancienttwo/arch-context/issues/161) | P1 | audit 子进程 env allowlist；仓库 capability 与用户级授权分离；修正 ADR-0041 出站描述。**需要 owner 先确认授权设计** |
| 2 | [#168](https://github.com/Ancienttwo/arch-context/issues/168) | P2 | MCP `approved` 严格布尔 + surface allowlist；approval token |
| 3 | [#169](https://github.com/Ancienttwo/arch-context/issues/169)、[#174](https://github.com/Ancienttwo/arch-context/issues/174) | P2 | 持久化字段 allowlist + 预算；MCP stdio 协议形状（真实 SDK 契约测试） |
| 4 | [#179](https://github.com/Ancienttwo/arch-context/issues/179) | P2 | 恢复时备份丢失仍标记 recovered（#176 中发现的后续项） |
| 5 | [#163](https://github.com/Ancienttwo/arch-context/issues/163) | P2 | 最小有效自模型（observed ≠ approved；注入违规依赖须被检测） |
| 6 | [#164](https://github.com/Ancienttwo/arch-context/issues/164) | P2 | daemon 拆分：A 保行为提取 → B 显式方法表 + decoder → C 按用例提取 |
| 7 | [#165](https://github.com/Ancienttwo/arch-context/issues/165) | P2 | projection 管线迁入 daemon 用例，复用 plan/apply/receipt |
| 8 | [#166](https://github.com/Ancienttwo/arch-context/issues/166)、[#162](https://github.com/Ancienttwo/arch-context/issues/162)、[#170](https://github.com/Ancienttwo/arch-context/issues/170)、[#171](https://github.com/Ancienttwo/arch-context/issues/171) | P2/P3 | 分层端口；错误 connected 状态（可提前小修）；contracts 发行契约；P3 汇总 |

## 本轮暴露的问题与经验（接手前必读）

1. **bun 版本**：仓库固定 `bun@1.4.0`。容器预装 1.3.11 跑全量测试会在 N-API finalizer 处 panic（exit 132）。本地用 `npm i --prefix <dir> bun@1.4.0` 并把其 `node_modules/.bin` 与仓库 `node_modules/.bin`（提供 `codegraph`）放到 PATH 前面。全量命令：`bun test --timeout 60000`（默认 5s 超时会误报）。
2. **跑全量测试时不要切分支**：测试从工作区读源码，中途 `git checkout` 会让结果对应错误的代码。需要并行处理多个分支时用 `git worktree add` + 在 worktree 里 `bun install --frozen-lockfile`。
3. **koffi 调用变参函数**：`descriptor-relative-write.ts` 把变参 `openat` 的 mode 声明为固定参数，Apple arm64 上变参走栈，mode 是垃圾值。已改为总是 `fchmod`。以后通过 koffi 绑定任何变参函数都要注意，Linux 上测不出来。
4. **Windows CI 偶发**：`cli.test.ts` 的 `runAdoptedHookAdaptersScenario` 直接调用外部 `codegraph init`，在 Windows/Node 25 上出现过一次 exit 5（与改动无关，重跑通过）。若再次出现，值得单独开 issue 让该 fixture 更稳健。
5. **CLI try/finally 陷阱**：`runCliUnchecked` 原先在 `try` 里 `return` 未完成的 promise，`finally` 先关闭 runtime。已修复；新增命令分支不要绕过 `execute()`。
6. **Codex review bot**：PR 从 draft 标记为 ready 时自动触发，本轮发现了两个真实竞态（锁发布非原子、create-only 提交用 rename）。建议保留，并在合并前处理其 P1/P2。

## 残余风险（已在 PR 中说明）

- 两个进程在同一瞬间接管同一把“死锁”仍有竞态窗口（仅崩溃后；沿用现有 daemon 锁模式）。
- `archctx state recover --write` 与 legacy 存储迁移不经过 writer ownership（各有自身守卫）。
- 恢复闸门只覆盖 `withWriter` 路径；不触及 `.archcontext/` 文件的 ledger 追加（jobs/audit 事件）不受阻断。
- `--end-of-options` 需要 git ≥ 2.24；更旧的 git 会“无法测量”（fail closed）。

## 需要 owner 决策

1. **#161 授权模型**：audit 的“同意”放在哪里（用户级 state 文件 / 环境变量 / 每次 CLI 显式 flag），以及子进程 env allowlist 的具体名单（至少排除 `ARCHCONTEXT_GH_ISSUES_TOKEN`、`GH_TOKEN`、daemon token）。
2. **#162**：先做“本地状态真实性”小修（去掉合成 refresh token、不报告 connected），D1/Queue 交付另立里程碑——是否同意这个拆分。
3. **#170**：contracts 发行契约走“源码包 private + staging 生成公开包”还是维持现状并修订 ADR-0034。

## 验证基线（合并后 `main`）

- `bun run typecheck`、`node scripts/package-boundary-audit.mjs`、`node scripts/production-mock-reachability-audit.mjs` 通过。
- `bun test --timeout 60000`（bun 1.4.0）：1798 pass / 0 fail（171 个文件，约 284s）。
- 三个修复 PR 在 ubuntu / macOS / windows × Node 22 / 24 / 25 与 Governance Verify 上均为绿。
