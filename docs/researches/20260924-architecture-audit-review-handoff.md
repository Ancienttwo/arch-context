# Handoff：2026-09-24 架构审计与重构方案的外部复核

> Date: 2026-09-24
> From: Claude Code 架构审计会话
> To: 外部 reviewer（可读 GitHub 的模型或人）
> Status: 待复核；复核结论决定修复与重构排程
> Reviewed base SHA: `6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b`（main，0.5.11）
> Audit PR: https://github.com/Ancienttwo/arch-context/pull/158
> Audit report: [`docs/researches/20260924-architecture-audit.md`](https://github.com/Ancienttwo/arch-context/blob/claude/admiring-franklin-wfxfro/docs/researches/20260924-architecture-audit.md)

## 你要做什么

1. **逐条证伪审计结论**：对每个 P1（以及你认为重要的 P2），打开下方源码链接，判断结论是否成立、严重度是否合适、修复建议是否正确且最小。重点找误报、夸大、遗漏的前置守卫，以及审计没发现的同类问题。
2. **评审重构方案**（本文“重构提案”一节）：拆分顺序、切分边界、约束是否合理；有没有更好的切法或不该做的项。
3. **回答“需要你判断的问题”** 一节。

下文所有代码链接都固定在 base SHA 上，行号不会漂移。审计本身是只读的：没有修改产品代码、`.archcontext/`、SQLite 或运行时状态；PR 只新增审计报告和本 handoff。

## 仓库背景（最少必要）

- ArchContext 是本地优先的架构控制回路：CLI / MCP / hooks 是触发与读取面，`archctxd`（`packages/local-runtime/runtime-daemon`）是 SQLite 与 ledger 的单写者，`.archcontext/` YAML 只能经 ChangeSet 修改。
- 分层期望：`contracts ← core ← local-runtime ← surfaces`；`cloud` 可依赖 contracts/core。
- 权威约束：[CLAUDE.md](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/CLAUDE.md)、ADR-0003/0005/0006/0012/0016/0017/0034/0040/0041/0042（`docs/adr/`）、[authority matrix](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/docs/architecture/architecture-ledger-authority-matrix.md)。

基线：`bun run typecheck`、`archctx validate`、`practices validate --strict`、`scripts/package-boundary-audit.mjs` 全部通过；`bun test`（bun 1.4.0）1778 pass / 0 fail；PR #158 CI 全绿。

## P1 结论与证据入口

### F1：仓库内容向 daemon 的 `git diff` 注入选项（已在 scratch repo 复现）

- 读取仓库内提交的 `docs/architecture/.projection-manifest.json`，`verifiedAgainst` 未校验：[projection-engine/src/index.ts#L1266-L1294](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/core/projection-engine/src/index.ts#L1266-L1294)
- 取出 `commit` 字符串：[runtime-daemon/src/index.ts#L8668-L8679](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L8668-L8679)
- 拼进 argv，无 `--end-of-options`：[runtime-daemon/src/index.ts#L8293-L8299](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L8293-L8299)
- 复现：`git diff --name-only "--output=<dir>/pwned..HEAD"` 在目标目录创建 `pwned..HEAD`。
- 请判断：影响受 `*..HEAD` 文件名约束，P1 是否合适？触发路径（complete-task freshness）上游是否有我没看到的校验？还有哪些 git 调用存在同类问题？

### F2：daemon 在拿单写者锁之前执行崩溃恢复

- `start()` 先 migrate + 回滚 pending ChangeSet/删除 pending snapshot：[runtime-daemon/src/index.ts#L1316-L1322](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L1316-L1322)
- RPC server 在 `daemon.start()` 之后才 `acquireDaemonLock`：[runtime-daemon/src/index.ts#L6334-L6342](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L6334-L6342)
- 无锁入口：[scripts/apply-model-proposal.ts#L115](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/scripts/apply-model-proposal.ts#L115)（打开真实 store 并继续 plan/apply）；[cli/src/main.ts#L4241](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/surfaces/cli/src/main.ts#L4241)（foreground daemon）。
- 竞态为代码顺序推导，**未做并发复现**。请判断：`recoverPendingChangeSets` 是否有其它互斥（如 SQLite 事务、journal 状态机）使第二个进程实际上无法回滚活跃 daemon 的 ChangeSet？

### F3：ADR-0017 / ADR-0016 未兑现

- `ControlPlane` 全内存状态：[control-plane/src/index.ts#L862-L876](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/cloud/control-plane/src/index.ts#L862-L876)
- Worker 每请求 `new ControlPlane()`：[deploy/cloudflare/fg2-staging-worker.ts#L120](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/deploy/cloudflare/fg2-staging-worker.ts#L120)
- `github connect` 保存合成 refresh token：[cli/src/main.ts#L2722](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/surfaces/cli/src/main.ts#L2722)
- 请判断：这是“有意的 staging 阶段形态”（应改 ADR 状态），还是应作为缺陷修？有没有 ADR/计划文档已声明这是过渡状态？

### F4：ArchContext 的自模型无法治理自身

- 仅 1 条 relation：[.archcontext/model/relations/](https://github.com/Ancienttwo/arch-context/tree/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/.archcontext/model/relations)；实际子包级 import 边约 95 条。
- `review.failOn` 含 `prohibited-dependency`：[.archcontext/manifest.yaml](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/.archcontext/manifest.yaml)，但无约束可触发；`policies/review.yaml` 的 failOn 只有 3 项。
- ADR frontmatter `appliesTo` 使用的 `package.*`/`app.*` id 不匹配任何 node id。
- 请判断：自举建模是否应作为重构的前置条件（先让工具能看见边界，再拆）？

### F5：本地 audit 的同意闸与出站描述

- 同意开关是仓库内提交的 manifest：[runtime-daemon/src/index.ts#L1828-L1836](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L1828-L1836)
- `claude` 子进程继承 daemon 全量 env（含 gh PAT）：[investigation-transport.ts#L36-L44](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/investigation-transport.ts#L36-L44)
- `doctor` 硬编码 `defaultOutbound: "local-only"`：[cloud/hardening/src/index.ts#L59](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/cloud/hardening/src/index.ts#L59)
- 请判断：CLI 侧还有 `auditGithubIssuesEnabled` 双重闸，是否足以视为“用户同意”？把同意移到用户级状态是否会破坏 ADR-0041 的设计意图？

## 重要 P2（选审）

- **F7 CLI 非薄适配层**：~1000 行 projection 领域逻辑在 CLI，入口 [cli/src/main.ts#L1366](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/surfaces/cli/src/main.ts#L1366)。
- **F9 `init` 覆盖 `.archcontext/`**：[model-store-yaml/src/index.ts#L149-L176](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/model-store-yaml/src/index.ts#L149-L176)，调用方 [runtime-daemon/src/index.ts#L1386-L1391](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L1386-L1391)。
- **F10 MCP 审批由 agent 自证**：[mcp-local/src/index.ts#L199-L206](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/surfaces/mcp-local/src/index.ts#L199-L206)。
- **F12 contracts 可公开发布**：[packages/contracts/package.json](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/contracts/package.json)（`private: false` + `publishConfig.access: public`）vs ADR-0034。请确认这是否因 repo-harness 依赖 `archctx-contracts` 而有意为之。

其余 P2/P3 见审计报告。

## 重构提案（请重点评审）

结论：**需要重构，但按“变更频率 × 耦合度”定向做纯移动式拆分，不按行数一刀切，不做大重写。安全修复（F1/F2/F5）先于拆分。**

| 文件 | 行数 | 建议 | 理由 |
|---|---|---|---|
| [runtime-daemon/src/index.ts](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts) | 8876 | 优先拆 | 可见 212 次提交中改动 30 次（源码第一）；58 个 RPC 方法各需在 4 处同步：接口 L1025-1133、`ArchctxDaemon` 方法、`RuntimeRpcClient` L6011-6322、[dispatch switch L6517](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/runtime-daemon/src/index.ts#L6517)（`params[n] as T` 位置强转） |
| [cli/src/main.ts](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/surfaces/cli/src/main.ts) | 4404 | 架构修正 | projection 管线迁入 daemon RPC（ADR-0006 parity），而非仅拆文件 |
| [local-store-sqlite/src/index.ts](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/local-runtime/local-store-sqlite/src/index.ts) | 7764 | 机会式 | 低 churn；先抽 ~770 行内联 SQL migration 与 ~1100 行 runtime-state 恢复 |
| [cloud/control-plane/src/index.ts](https://github.com/Ancienttwo/arch-context/blob/6e85b35fee113f21334bd5ba36c5d7d2bb2c3d2b/packages/cloud/control-plane/src/index.ts) | 3352 | 暂缓 | 取决于 F3 决策，若转 D1 持久化会重写 |
| core 1500–2800 行的包 | — | 不立项 | 内聚尚可，下次触碰时顺手拆 |

daemon 拆分 PR 序列：

1. 单一方法表生成 `rpc-protocol.ts` / `rpc-client.ts` / `rpc-server.ts`，消除四处重复与位置强转；`mcp-local` 仅依赖 client。
2. 按 feature 抽 `developer-review-run.ts`、`ledger-admin.ts`、`audit.ts`、`projection-apply.ts`、`explorer-server.ts`；`ArchctxDaemon` 变为基于共享 `DaemonContext` 的 facade。已有先例：`refactor-scan.ts`、`refactor-verify.ts`、`refactor-recording.ts`、`explorer-projection.ts`。
3. 每抽一块，同步把 `runtime-daemon/test/local-runtime.test.ts`（6983 行）对应用例迁出。

约束：

- 纯移动，不改任何写路径（ledger 写入只经 ChangeSet / daemon-owned 事务）。
- 每个 PR 必须通过 typecheck、`package-boundary-audit` 和全量测试。
- 拆出的模块同步补 component 节点与 relation / 层约束（F4），让 `refactor scan` 与 `prohibited-dependency` 能守住新边界。
- 仓库存在并行的 codex worktree；daemon 拆分选在无活跃功能分支时进行，PR 小而快合。

不建议：按行数设硬上限、一次性重写 daemon、拆分中夹带逻辑修改。

## 需要你判断的问题

1. 五个 P1 中，哪些你认为是误报或应降级？给出源码依据。
2. 审计遗漏了哪些同等级问题（尤其是写权威、信任边界、ledger 隐私守卫）？
3. RPC 方法表方案：用“单一 method table + 类型推导”还是“代码生成”？对现有 `RuntimeDaemonClient` 公开类型与 repo-harness 下游的兼容性影响如何？
4. CLI projection 管线迁入 daemon 时，应作为新 RPC（如 `projectionRun`）还是复用现有 `planUpdate`/`applyUpdate` + 更高层编排？
5. F3 应“实现 ADR”还是“降级 ADR 为 staging-only”？你倾向哪个，理由？
6. 自举建模（F4）应在拆分之前、同时，还是之后？

## 期望输出格式

- 每个 finding：`成立 / 部分成立 / 不成立` + 建议严重度 + 一句理由 + 源码链接。
- 新发现：同样格式，标注 `NEW`。
- 重构方案：`同意 / 修改（给出替代）/ 反对` 逐项回答，并给出你建议的 PR 顺序。
- 请不要直接提交修改；以评审意见形式返回。
