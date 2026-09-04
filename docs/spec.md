# Product Spec: ArchContext

> **Status**: Active
> **Last Updated**: 2026-09-02
> **Owner**: Planner
> **Full PRD**: `plans/prds/20260619-2039-archcontext.prd.md`
> **Follow-up PRD**: `plans/prds/20260620-0236-archcontext-local-github-governance.prd.md`
> **Architecture Ledger PRD**: `plans/prds/Deep Research Report on ArchContext.md`

## Product Outcome

> **Code with an architect on standby.** —— 让 Coding Agent 背后随时有一位资深架构师待命。

ArchContext 是嵌入 Agentic Coding Runtime 的软件架构控制循环。它利用 CodeGraph 感知代码，在任务前编译架构上下文，在开发中检测结构压力，在必要时推动有证据的重构，并在任务完成前同步与验证系统状态——让没有架构经验的开发者也能把简单应用持续养成可维护的复杂产品。

文档、图表、ADR 和数据库都是这个控制循环的输入或输出，不是产品本身。

## Product Modes

| Mode | Local install | GitHub App | Execution | Result |
|---|---:|---:|---|---|
| Local Core | Required | No | Developer machine | Local review and MCP/CLI workflow |
| Personal Publish | Required | No | Developer machine | User-authored status or comment, informational only |
| Developer Review | Required | Yes | Developer machine | `ArchContext / Developer Review`, developer-attested |
| Organization Runner | Runner install | Yes | Customer-controlled GitHub Actions or self-hosted runner | `ArchContext / Organization Runner`, organization-attested |

GitHub App is an optional governance bridge. It handles installation, PR metadata, Challenge, Attestation verification, and Check delivery; it is not a code executor and it is not required for the local product.

## Success Criteria

- **Primary workflow**: 用户用自然语言提出产品需求 → Agent 经 `prepare → checkpoint → intervention/change → reconcile → cleanup → complete` SOP 完成实现；ArchContext 在背后判断局部修改还是结构性重构、阻止无依据的 wrapper/fallback/双轨、把架构变化写入结构化模型、清理迁移旧路径，并可在 GitHub 发布绑定 Commit 的 Developer Review 或 Organization Runner Check。
- **Quality bar**: 长期项目中 Agent 能在不累积结构性技术债的前提下持续完成新需求（北极星）。确定性内核（Schema/Policy/路径安全/Digest/写入）100% 可复现；Stale Plan、路径逃逸、Attestation Replay 拦截率 100%；无依据兼容代码检测 Recall ≥ 85%；SaaS 代码内容路由数 = 0。
- **Out of scope (MVP)**: 通用代码图谱解析器、大型可视化画布、云端代码分析/Embedding、通用 Bug/Security AI Review、跨仓库图谱、ArchContext 托管私有代码 Runner、Slack Bot、多人实时协作编辑、PGlite/托管 Vector DB、Agent 自动合并 PR、第三方 Skill 作为核心执行依赖。

## Constraints

- **Technical**: TypeScript + Node.js `>=22.22 <26` + Bun workspaces；CodeGraph 为产品硬依赖，仅经 `CodeFacts` Adapter 软耦合、精确锁版本、禁止读取其内部 DB；本地 SQLite（`node:sqlite` + WAL + FTS5）默认位于 OS 用户数据目录中的 `repositories/<storage-repository-id>/worktrees/<storage-workspace-id>/runtime.sqlite`，不用 PGlite；当前架构事实源是 Git 中 `.archcontext/` 的结构化 YAML，Markdown/图表为生成投影；Architecture Ledger 采用 ADR-0040 的 hybrid 模式：SQLite ledger 是 operational architecture state，`.archcontext/` 仍是 review/collaboration boundary，必须先经过 `yaml` → `dual` → `ledger-shadow` → `ledger-authoritative` 的可回滚晋级；一个版本一致的 `archctx` 本地产品交付 CLI、`archctxd`、MCP stdio adapter、local RPC schema、SQLite migrations 和 runtime build provenance；CLI/MCP 为薄适配层共享 Daemon RPC；MCP 默认仅暴露 5 个 `archcontext_*` 工具（`prepare_task` / `checkpoint` / `plan_update` / `apply_update` / `complete_task`）。
- **Compliance**: SaaS 代码内容路由数必须为 0。ArchContext Cloud 不请求、不调用、不处理、不存储 Repository Contents、PR Diff/Patch、文件名、Symbol、CodeGraph、架构模型正文、Prompt/Completion 或详细 Finding；该边界由 GitHub API allowlist、Diff/Patch media type denylist、DTO allowlist、日志投影、egress recorder、D1/Queue schema audit 和 CI Privacy Contract Test 共同守护。GitHub App 默认无 Contents 权限，但不得把权限文案写成“技术上绝对无法读取代码”。ChatGPT Secure MCP Tunnel 场景必须明示数据会进入 OpenAI，不得宣称"数据永不离开本地"。
- **Delivery**: 公开仓库免费；个人 Pro $5/月，覆盖该开发者可访问的全部私有仓库，不按仓库/Seat/Token/调用计费。MVP 以"可闭环的 Agentic Coding 架构 SOP"为完成标准，而非功能数量；里程碑 M0（契约冻结）→ M6（Beta 加固）。

## Acceptance Scenarios

### Accepted Projection Delivery Recovery

已提交的 accepted projection apply 若在写入后因并发非 owned 变更返回
`applied-reconcile-required`，其 refresh signal 保持在原始 receipt 中且不被普通
`projection run apply` 重试消费。唯一恢复入口是 `projection recover --request-json`：客户端只提交
receipt identity intent；daemon 在 writer 临界区以不消费的方式读取 receipt，再重建当前无
accepted-change 的 projection fixed point，并严格比对
原 approval、model/source/flow-proof/projection digest、renderer/layout、CodeGraph ready
provenance 与 owned output bytes。所有绑定一致后，daemon 才在同一个 store transaction 中复检
其权威 snapshot 并原子消费原 signal；RPC 不暴露 direct delivery，重复请求只返回
`already-delivered` proof，不写 projection。
旧 v0.4.7 receipt 仍可读取，但没有该 immutable binding 时必须拒绝 recovery，绝不猜测或降级。

### Recommendation Readback Identity

`book recommendations` reports the current checkout identity in `freshness.worktree`,
`freshness.headSha`, and `freshness.worktreeDigest`, including uncommitted changes. Its
`provenance` retains the historical ledger scope. Reading lifecycle status never rebinds
persisted resolution evidence or changes the ledger partition. Other book commands retain
their ledger readback identity.

## Release State

`archctx@0.5.3` and `archctx-contracts@0.5.3` are the current published release on `latest`
(2026-09-04). Refactor verification responses now report live Git identity while ledger replay
and append retain the recommendation partition; historical verification evidence stays immutable.
The packages retain the `0.5.2` protocols: the `refactor scan|record|verify` surface, the
`refactor-resolution-v1` capability feature, the v3 recommendation rewrite, and the release
manifest that declares the `koffi` runtime dependency. `0.5.1` was published on 2026-09-03 but its
tarball omitted that dependency, so a fresh install failed at startup; it must not be installed
and `0.5.2` supersedes it. `0.5.0` was prepared but never published. `archctx@0.4.8` and
`archctx-contracts@0.4.8` were the last pre-0.5.x published pair (verified with
`npm view archctx version` on 2026-09-03). The scoped `@archcontext/contracts`
workspace remains internal source authority; it is never the public contracts artifact. `0.4.7`
and earlier do not carry recovery semantics. Installation and organization-runner rollout still
fail closed on an unavailable or version-mismatched artifact.

- **Given** 一个从单体 Web 演进到含登录/订阅/支付 Webhook 的项目，**When** Agent 实现支付能力，**Then** ArchContext 从 L0 升级到 L1、给出支付数据边界与 Lifecycle Owner，并阻止把付款凭据写入业务数据库。
- **Given** 任务要统一新旧状态字段且旧字段只有内部消费者，**When** Agent 建议加永久 Mapper，**Then** ArchContext 拒绝无真实契约的兼容层，生成调用方迁移与 Kill List，完成后仓库只剩单一路径。
- **Given** 架构压力高但 CodeGraph 无法确认部分动态调用方（信心低），**When** Agent 想直接重构，**Then** 进入 Proof Required，先做最小验证实验，而非补丁或盲目重写。
- **Given** PR `synchronize`，**When** 本地 Runtime 完成 Review 并生成设备签名 Attestation，**Then** SaaS 仅验证最小字段并更新 `ArchContext / Developer Review`；新 Commit 到达后旧 Attestation 立即失效，且 Developer Review 不能满足要求 `ArchContext / Organization Runner` 的策略。

## Open Questions

- ChatGPT App 完整私有能力（Secure MCP Tunnel）算 MVP 还是 v1.1？发布资格与面向所有 Pro 用户的可用性待定。
- `archctxd` 后续是否从 MVP loopback HTTP RPC 切到 UDS/Windows Named Pipe；Windows 守护进程生命周期。
- Node `kind`、Relation `type` 是否在 MVP 固定枚举还是允许 namespaced 扩展。
- Public 免费版是否包含 GitHub Check，还是仅本地 Runtime。
- 个人 Pro 是否提供年付（约 $50）。
- 完整待确认清单见 PRD §29。
