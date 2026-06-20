# Product Spec: ArchContext

> **Status**: Active
> **Last Updated**: 2026-06-19
> **Owner**: Planner
> **Full PRD**: `plans/prds/20260619-2039-archcontext.prd.md`

## Product Outcome

> **Code with an architect on standby.** —— 让 Coding Agent 背后随时有一位资深架构师待命。

ArchContext 是嵌入 Agentic Coding Runtime 的软件架构控制循环。它利用 CodeGraph 感知代码，在任务前编译架构上下文，在开发中检测结构压力，在必要时推动有证据的重构，并在任务完成前同步与验证系统状态——让没有架构经验的开发者也能把简单应用持续养成可维护的复杂产品。

文档、图表、ADR 和数据库都是这个控制循环的输入或输出，不是产品本身。

## Success Criteria

- **Primary workflow**: 用户用自然语言提出产品需求 → Agent 经 `prepare → checkpoint → intervention/change → reconcile → cleanup → complete` SOP 完成实现；ArchContext 在背后判断局部修改还是结构性重构、阻止无依据的 wrapper/fallback/双轨、把架构变化写入结构化模型、清理迁移旧路径，并可在 GitHub 发布绑定 Commit 的签名 Review。
- **Quality bar**: 长期项目中 Agent 能在不累积结构性技术债的前提下持续完成新需求（北极星）。确定性内核（Schema/Policy/路径安全/Digest/写入）100% 可复现；Stale Plan、路径逃逸、Attestation Replay 拦截率 100%；无依据兼容代码检测 Recall ≥ 85%；SaaS 代码内容路由数 = 0。
- **Out of scope (MVP)**: 通用代码图谱解析器、大型可视化画布、云端代码分析/Embedding、通用 Bug/Security AI Review、跨仓库图谱、组织强制 Runner、Slack Bot、多人实时协作编辑、PGlite/托管 Vector DB、Agent 自动合并 PR、第三方 Skill 作为核心执行依赖。

## Constraints

- **Technical**: TypeScript + Node.js 24 LTS + Bun workspaces；CodeGraph 为产品硬依赖，仅经 `CodeFacts` Adapter 软耦合、精确锁版本、禁止读取其内部 DB；本地 SQLite（`node:sqlite` + WAL + FTS5），不用 PGlite；架构事实源是 Git 中 `.archcontext/` 的结构化 YAML，Markdown/图表为生成投影；长生命周期 `archctxd` daemon，MVP 本地 RPC 使用受保护的 loopback HTTP + repo-local connection file / lock file，`archctx daemon start` 可后台启动并在 health readback 后返回，CLI/MCP 为薄适配层共享 Core；MCP 默认仅暴露 5 个 `archcontext_*` 工具（`prepare_task` / `checkpoint` / `plan_update` / `apply_update` / `complete_task`）。
- **Compliance**: 零代码出域是技术事实——SaaS 永不接收源码、Diff、Symbol、CodeGraph、架构模型正文或详细 Finding；GitHub App 默认无 Contents 权限；SaaS 无任何内容上传路由，并以 CI Privacy Contract Test 守护；ChatGPT Secure MCP Tunnel 场景必须明示数据会进入 OpenAI，不得宣称"数据永不离开本地"。
- **Delivery**: 公开仓库免费；个人 Pro $5/月，覆盖该开发者可访问的全部私有仓库，不按仓库/Seat/Token/调用计费。MVP 以"可闭环的 Agentic Coding 架构 SOP"为完成标准，而非功能数量；里程碑 M0（契约冻结）→ M6（Beta 加固）。

## Acceptance Scenarios

- **Given** 一个从单体 Web 演进到含登录/订阅/支付 Webhook 的项目，**When** Agent 实现支付能力，**Then** ArchContext 从 L0 升级到 L1、给出支付数据边界与 Lifecycle Owner，并阻止把付款凭据写入业务数据库。
- **Given** 任务要统一新旧状态字段且旧字段只有内部消费者，**When** Agent 建议加永久 Mapper，**Then** ArchContext 拒绝无真实契约的兼容层，生成调用方迁移与 Kill List，完成后仓库只剩单一路径。
- **Given** 架构压力高但 CodeGraph 无法确认部分动态调用方（信心低），**When** Agent 想直接重构，**Then** 进入 Proof Required，先做最小验证实验，而非补丁或盲目重写。
- **Given** PR `synchronize`，**When** 本地 Runtime 完成 Review 并生成设备签名 Attestation，**Then** SaaS 仅验证最小字段并更新 Check；新 Commit 到达后旧 Attestation 立即失效。

## Open Questions

- ChatGPT App 完整私有能力（Secure MCP Tunnel）算 MVP 还是 v1.1？发布资格与面向所有 Pro 用户的可用性待定。
- `archctxd` 后续是否从 MVP loopback HTTP RPC 切到 UDS/Windows Named Pipe；Windows 守护进程生命周期。
- Node `kind`、Relation `type` 是否在 MVP 固定枚举还是允许 namespaced 扩展。
- Public 免费版是否包含 GitHub Check，还是仅本地 Runtime。
- 个人 Pro 是否提供年付（约 $50）。
- 完整待确认清单见 PRD §29。
