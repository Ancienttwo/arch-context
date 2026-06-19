# Sprint: ArchContext MVP

> **Status**: Active
> **Slug**: archctx
> **Created**: 2026-06-19
> **Updated**: 2026-06-19
> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`
> **Source Spec**: `docs/spec.md`
> **Goal Mode**: incremental

开发进度跟踪清单，逐条派生自 ArchContext PRD v2.0 的里程碑（§26）、ADR 清单（§28）与功能需求（§9）。里程碑表中每行是可跟踪的最小单元，带稳定 ID（如 `M2-07`）。**状态列**：◻ 未开始 / ◐ 进行中 / ☑ 完成。**Owner** = 归属包（PRD §10.5，非人名）。**Est** 留空供团队填。**验证方式** 为目标检查（产品代码/脚本尚未存在）。开始一条前先用 `$think` 展开；完成后更新行状态、「进度总览」与「ADR 实现矩阵」。

## PRD 摘要

完整 PRD 在 `plans/prds/20260619-2039-archcontext.prd.md`；稳定产品事实在 `docs/spec.md`。

- **Problem**：Vibe Coding 原型快，但增长后 Agent 倾向局部最优（加 wrapper/fallback/双轨而非重构），技术债复利上升。
- **Users**：Persona A 个人 Vibe Coding 开发者；B 高级个人/开源维护者；C 小团队独立贡献者。
- **Success Criteria**：长期项目中 Agent 不累积结构性技术债持续完成新需求（北极星）；确定性内核 100% 可复现；Stale/路径逃逸/Attestation Replay 拦截 100%；无依据兼容检测 Recall ≥ 85%；SaaS 代码内容路由 = 0。
- **Acceptance**：单体→订阅自动 L0→L1 守支付边界；拒绝无契约 Mapper 并生成 Kill List；高压力低信心进 Proof Required；PR 本地签名 Attestation，SaaS 仅验证最小字段，新 Commit 失效旧结果。
- **Non-goals (MVP)**：通用代码图谱解析器、可视化画布、云端代码分析/Embedding、通用 Bug/Security Review、跨仓库图谱、组织强制 Runner、Slack Bot、多人实时协作、PGlite/托管 Vector DB、Agent 自动合并 PR、第三方 Skill 作核心执行依赖。

## Architecture Notes

- **Capabilities / 包**：`contracts` · `runtime-daemon` · `local-store-sqlite` · `codegraph-adapter` · `architecture-domain` · `context-compiler` · `pressure-engine` · `refactor-decision` · `policy-engine` · `changeset-engine` · `reconcile-engine` · `review-engine` · `cli` · `mcp-local` · `mcp-cloud-metadata` · `skills` · `chatgpt-ui` · `control-plane` · `github-app` · `cloud-db` · `attestation`。
- **Dependency Order**：M0 契约冻结 → M1 本地 Runtime → M2 控制循环 → M3 CLI/MCP/Agent →（并行）M4 ChatGPT、M5 SaaS/GitHub Attestation → M6 加固发布。本地线（M1–M4）与云端控制面（M5）在 GitHub Attestation 汇合。
- **Risks**：CodeGraph 变化（锁版本+Adapter Contract+Fixture）；Agent 忽略 SOP（Skill+Hook+Complete Gate+状态持久化）；过度/不足重构（Pressure 与 Confidence 分离+Proof Required+Eval）；MVP 面偏大（M4 可降 v1.1，先交付 M0–M3 闭环）。

## Guardrails（Agent 禁止事项 / PRD §1.3 不变量）

1. SaaS 不接收源码、Diff、Symbol、CodeGraph、架构模型正文或详细 Finding。
2. Agent 不直接改架构模型；所有结构化写入必经 ChangeSet + Schema + Policy + 原子提交。
3. 兼容层必须持证：真实契约、Owner、移除条件、复审日期；"为了安全/调用方多"不是合法理由。
4. Target State 与 Migration State 分离；中间兼容态不当最终架构。
5. 高压力低信心进入 Proof Required，不堆补丁也不无证据重写。
6. 简单项目不强加复杂模型；治理强度随复杂度渐进（L0–L3）。
7. 每个任务结果绑定 Repository + HEAD SHA + Worktree Digest，禁止用过期上下文。

## ADR 实现矩阵（PRD §28）

每条 ADR 必须在对应里程碑实现前建立并与 PRD 一致。状态：◻ 未开始 / ◐ 进行中 / ☑ 已落地。

| ADR | 标题 | 主里程碑 | 状态 |
|---|---|---|:--:|
| ADR-0001 | Agentic Architecture Control Loop | M2 | ◻ |
| ADR-0002 | CodeGraph as Required Code Facts Engine | M0 · M1 | ☑ |
| ADR-0003 | Local-first Trust Boundary | M0 · M5 · M6 | ☑ |
| ADR-0004 | SQLite Local Store | M1 | ☑ |
| ADR-0005 | Single-writer Runtime Daemon | M1 | ☑ |
| ADR-0006 | CLI and MCP as Thin Adapters | M3 | ◻ |
| ADR-0007 | Structured Architecture Source of Truth | M0 · M1 | ☑ |
| ADR-0008 | Declared / Observed / Verified | M1 · M2 | ☑ |
| ADR-0009 | Target State vs Migration State | M2 | ◻ |
| ADR-0010 | Compatibility Code Requires Contract | M2 | ◻ |
| ADR-0011 | Architecture Intervention | M2 | ◻ |
| ADR-0012 | ChangeSet-only Architecture Writes | M2 | ◻ |
| ADR-0013 | Progressive Architecture | M1 · M2 | ☑ |
| ADR-0014 | Context Compiler with Budget | M1 · M2 | ☑ |
| ADR-0015 | GitHub App without Contents Permission | M5 | ◻ |
| ADR-0016 | Signed Local Attestation | M5 | ◻ |
| ADR-0017 | Cloudflare Control Plane | M5 | ◻ |
| ADR-0018 | Dual MCP Surface | M4 | ◻ |
| ADR-0019 | ChatGPT via Secure MCP Tunnel | M4 | ◻ |
| ADR-0020 | MCP Apps Standard-first UI | M4 | ◻ |
| ADR-0021 | First-party Skills as SOP Only | M3 | ◻ |
| ADR-0022 | No Slack in MVP | 全程 / Guardrails | ◻ |
| ADR-0023 | User-level Private Entitlement | M5 | ◻ |
| ADR-0024 | Developer vs Organization Attestation | M5 | ◻ |
| ADR-0025 | Evidence Confidence and Proof Required | M2 | ◻ |

## 进度总览

| 里程碑 | 范围 | 任务 | Exit Gate | 完成 |
|---|---|--:|--:|--:|
| M0 | 契约与架构冻结 | 18 | 5 | 23 / 23 |
| M1 | 本地 Runtime 基础 | 28 | 5 | 33 / 33 |
| M2 | 主动架构控制循环 | 33 | 6 | 0 / 39 |
| M3 | CLI / MCP / Agent 集成 | 22 | 5 | 0 / 27 |
| M4 | ChatGPT App | 27 | 6 | 0 / 33 |
| M5 | SaaS / 计费 / GitHub Attestation | 32 | 6 | 0 / 38 |
| M6 | 加固与发布 | 22 | 9 | 0 / 31 |
| **合计** | | **182** | **42** | **56 / 224** |

## Backlog（里程碑 waypoint 索引）

`.ai/harness/scripts/sprint-backlog.sh` 以此表为队列（保持模板原列）；逐条详表见下方「里程碑开发清单」。

| # | Status | Task | Mode | Acceptance | Plan |
|---|--------|------|------|------------|------|
| 1 | [x] | archctx-m0-contracts-freeze | contract | 9 份 Schema + ID/Version/Envelope/错误码/Digest 绑定 + Adapter/Ports + Threat Model v1 + ADR 记录；M0 Exit Gate 全绿 | `docs/verification/m0-contracts-gate.md` |
| 2 | [x] | archctx-m1-local-runtime | contract | `archctxd` + Session + SQLite + CodeGraph Adapter + 模型 Loader + `init/sync/validate/context/status`；M1 Exit Gate 全绿 | `docs/verification/m1-local-runtime-gate.md` |
| 3 | [ ] | archctx-m2-control-loop | contract | prepare/checkpoint/complete Gate + Posture + Pressure + Confidence + Intervention/Compatibility + ChangeSet；M2 Exit Gate 全绿 | (pending) |
| 4 | [ ] | archctx-m3-cli-mcp-agent | contract | 全 CLI + 5-tool stdio MCP + Resources + 第一方 Skills + Agent SOP 接入；M3 Exit Gate 全绿 | (pending) |
| 5 | [ ] | archctx-m4-chatgpt-app | contract | 双通道 MCP + Secure Tunnel + GPT 工具面 + MCP Apps UI + OAuth2.1；M4 Exit Gate 全绿 | (pending) |
| 6 | [ ] | archctx-m5-saas-attestation | contract | Identity/Entitlement + GitHub App + Stripe + Cloudflare；M5 Exit Gate 全绿 | (pending) |
| 7 | [ ] | archctx-m6-hardening-launch | contract | 跨平台/安全/体验加固；M6 Launch Gate 全绿 | (pending) |

---

# 里程碑开发清单

列含义：**St** 状态（◻/◐/☑）· **Owner** 归属包 · **Est** 预估（团队填）· **Deps** 前置任务 ID（同里程碑内；跨里程碑前置见各段头）。

## M0 · Contracts 与架构冻结

**目标**：冻结跨模块契约，避免 CLI/MCP/SQLite/GitHub App/Skill 各自演化出不同语义。
**关联 ADR**：0002、0003、0007、（并记录全部 0001–0025）。 **前置**：无。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M0-01 | ☑ | 冻结 `ArchitectureNode` JSON Schema | contracts |  | — |
| M0-02 | ☑ | 冻结 `ArchitectureRelation` JSON Schema | contracts |  | — |
| M0-03 | ☑ | 冻结 `Constraint` JSON Schema | contracts |  | — |
| M0-04 | ☑ | 冻结 `ArchitectureIntervention` JSON Schema | contracts |  | — |
| M0-05 | ☑ | 冻结 `CompatibilityContract` JSON Schema | contracts |  | — |
| M0-06 | ☑ | 冻结 `TaskContext` JSON Schema | contracts |  | — |
| M0-07 | ☑ | 冻结 `ChangeSet` JSON Schema | contracts |  | — |
| M0-08 | ☑ | 冻结 `ReviewResult` JSON Schema | contracts |  | — |
| M0-09 | ☑ | 冻结 `Attestation` JSON Schema | contracts |  | — |
| M0-10 | ☑ | 定义所有对象的稳定 ID 规则 | contracts |  | M0-01..09 |
| M0-11 | ☑ | 定义 Schema Version 与 Migration 协议 | contracts |  | M0-01..09 |
| M0-12 | ☑ | 定义 CLI JSON Envelope | contracts |  | — |
| M0-13 | ☑ | 定义错误码、严重级别与可恢复性（附录 A） | contracts |  | — |
| M0-14 | ☑ | 定义 Repository / HEAD / Worktree Digest 绑定规则 | architecture-domain |  | — |
| M0-15 | ☑ | 完成 CodeGraph Adapter Contract（`CodeFactsPort`） | codegraph-adapter |  | — |
| M0-16 | ☑ | 完成 Local Store / Model Store / Policy / Renderer Port 接口 | architecture-domain |  | — |
| M0-17 | ☑ | 完成 Threat Model v1 | cross/security |  | — |
| M0-18 | ☑ | 记录 PRD §28 全部核心 ADR（统一模板） | docs/adr |  | — |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M0-EG1 | ☑ | 所有 Schema 通过正/反/边界 Fixture | `bun test packages/contracts/test/contracts.test.ts`：valid/invalid/boundary fixtures 全绿 |
| M0-EG2 | ☑ | 未知/废弃字段与向前兼容规则有自动测试 | 字段策略单测通过 |
| M0-EG3 | ☑ | YAML→Domain→JSON→YAML 往返语义不变 | stable YAML / canonical JSON round-trip 断言通过 |
| M0-EG4 | ☑ | Contract 包不依赖 CLI/MCP/DB/Cloud | `@archcontext/contracts` 只依赖 Node 标准库 |
| M0-EG5 | ☑ | Human Architecture Gate 批准 | `docs/verification/m0-contracts-gate.md` |

## M1 · Local Runtime Foundation

**目标**：无 SaaS/GitHub App/ChatGPT 下，本地完成初始化、索引、上下文查询与确定性验证。
**关联 ADR**：0004、0005、0007、0008、0013、0014。 **前置**：M0 Exit Gate 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M1-01 | ☑ | 实现 `archctxd` 生命周期管理 | runtime-daemon |  | — |
| M1-02 | ☑ | 实现单 Repository Session | runtime-daemon |  | M1-01 |
| M1-03 | ☑ | 实现 Repository Fingerprint | runtime-daemon |  | — |
| M1-04 | ☑ | 实现 Worktree Digest | runtime-daemon |  | — |
| M1-05 | ☑ | 实现 SQLite Migration Runner | local-store-sqlite |  | — |
| M1-06 | ☑ | 启用 WAL、Foreign Keys、Busy Timeout | local-store-sqlite |  | M1-05 |
| M1-07 | ☑ | 实现 Runtime Lock 与异常恢复 | runtime-daemon |  | M1-01 |
| M1-08 | ☑ | 实现 Snapshot 创建、提交与清理 | local-store-sqlite |  | M1-05 |
| M1-09 | ☑ | 实现无损崩溃恢复测试 | runtime-daemon |  | M1-07,08 |
| M1-10 | ☑ | 以精确版本依赖 CodeGraph | codegraph-adapter |  | M0-15 |
| M1-11 | ☑ | 只通过 `CodeGraphAdapter` 访问 | codegraph-adapter |  | M0-15 |
| M1-12 | ☑ | 禁止读取 CodeGraph 内部 SQLite（断言测试） | codegraph-adapter |  | M1-11 |
| M1-13 | ☑ | 实现 初始化/增量同步/Task Context/Impact/Evidence 查询 | codegraph-adapter |  | M1-10 |
| M1-14 | ☑ | 启动时验证版本与 Capability | codegraph-adapter |  | M1-10 |
| M1-15 | ☑ | 不兼容版本给出可操作错误 | codegraph-adapter |  | M1-14 |
| M1-16 | ☑ | 默认关闭第三方遥测（`DO_NOT_TRACK=1`） | codegraph-adapter |  | — |
| M1-17 | ☑ | 建立 CodeGraph Fixture 与 Mock | codegraph-adapter |  | M0-15 |
| M1-18 | ☑ | 实现 `.archcontext/manifest.yaml` | model-store-yaml |  | M0-01..09 |
| M1-19 | ☑ | 实现最小 L0 Product Model | model-store-yaml |  | M1-18 |
| M1-20 | ☑ | 实现 Node/Relation/Constraint Loader | model-store-yaml |  | M0-01..03 |
| M1-21 | ☑ | 实现 ADR 与 Policy Loader | model-store-yaml |  | — |
| M1-22 | ☑ | 实现 Schema Validation | model-store-yaml |  | M1-20 |
| M1-23 | ☑ | 实现 Generated Projection 清理与重建 | reconcile-engine |  | M1-20 |
| M1-24 | ☑ | 实现 `archctx init` | cli |  | M1-13,18,20 |
| M1-25 | ☑ | 实现 `archctx sync` | cli |  | M1-13 |
| M1-26 | ☑ | 实现 `archctx validate` | cli |  | M1-22 |
| M1-27 | ☑ | 实现 `archctx context` | cli |  | M1-13,20 |
| M1-28 | ☑ | 实现 `archctx status` | cli |  | M1-02 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M1-EG1 | ☑ | 示例项目 5 分钟内首次 Context Query | temp repo e2e：`init && context` < 1s |
| M1-EG2 | ☑ | 无 Cloud 账户公开仓本地功能完整 | 离线 e2e：init/sync/validate/context/status 全通 |
| M1-EG3 | ☑ | `archctx validate` 确定性 | 同输入两次输出一致 |
| M1-EG4 | ☑ | Source 不写入 SQLite 非必要表 | SQLite schema guard 断言无 source/diff/symbol/codegraph body |
| M1-EG5 | ☑ | 删 Local Store 后可重建 | runtime store pending snapshot recovery + Git model reload 测试 |

## M2 · 主动架构控制循环

**目标**：证明 ArchContext 不只是 Search，而会主动改变 Agent 的开发姿态。
**关联 ADR**：0001、0008、0009、0010、0011、0012、0013、0014、0025。 **前置**：M1 Exit Gate 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M2-01 | ◻ | 实现 `prepare_task` | context-compiler |  | M1-13,20 |
| M2-02 | ◻ | 实现 Posture：Normal/Structural/Intervention/Proof Required | refactor-decision |  | M2-07,15 |
| M2-03 | ◻ | 实现 Task Context Budget | context-compiler |  | M2-01 |
| M2-04 | ◻ | 实现 Checkpoint | application |  | M2-01 |
| M2-05 | ◻ | 实现 `complete_task` Gate | review-engine |  | M2-04 |
| M2-06 | ◻ | 任何写入均验证 Snapshot Freshness | runtime-daemon |  | M1-04 |
| M2-07 | ◻ | 检测重复责任 | pressure-engine |  | M1-13 |
| M2-08 | ◻ | 检测多 Lifecycle Owner | pressure-engine |  | M1-13 |
| M2-09 | ◻ | 检测无依据 Wrapper 与 Adapter | pressure-engine |  | M1-13 |
| M2-10 | ◻ | 检测同一业务概念的新旧双轨 | pressure-engine |  | M1-13 |
| M2-11 | ◻ | 检测跨边界数据访问 | pressure-engine |  | M1-20 |
| M2-12 | ◻ | 检测循环依赖与变更热点 | pressure-engine |  | M1-13 |
| M2-13 | ◻ | 检测超期 Migration State | pressure-engine |  | M2-21 |
| M2-14 | ◻ | 压力结果附 Evidence 或标记 Heuristic | pressure-engine |  | M2-07 |
| M2-15 | ◻ | 计算调用方覆盖度 | refactor-decision |  | M1-13 |
| M2-16 | ◻ | 识别 Public Contract/Persisted Data/External Consumer | refactor-decision |  | M1-13 |
| M2-17 | ◻ | 评估测试覆盖与回滚点 | refactor-decision |  | — |
| M2-18 | ◻ | 低信心生成 Proof Point | refactor-decision |  | M2-15 |
| M2-19 | ◻ | 高压力高信心生成 Intervention Proposal | refactor-decision |  | M2-02,20 |
| M2-20 | ◻ | 实现 Target State | architecture-domain |  | M0-04 |
| M2-21 | ◻ | 实现 Migration State | architecture-domain |  | M0-04 |
| M2-22 | ◻ | 实现 Kill List | architecture-domain |  | M2-20 |
| M2-23 | ◻ | 实现 Real/Inherited Constraint 分类 | architecture-domain |  | M0-03 |
| M2-24 | ◻ | 实现 Proof Point 与 Falsifier | architecture-domain |  | M2-18 |
| M2-25 | ◻ | 实现 Benefit Ledger | architecture-domain |  | — |
| M2-26 | ◻ | 实现 Compatibility Contract 创建与复审 | policy-engine |  | M0-05 |
| M2-27 | ◻ | 未绑定真实契约的兼容层触发 Review Finding | review-engine |  | M2-26 |
| M2-28 | ◻ | ChangeSet Plan/Preview/Approve/Apply/Rollback 状态机 | changeset-engine |  | M0-07 |
| M2-29 | ◻ | 写操作限于 Allowlist 路径 | changeset-engine |  | M2-28 |
| M2-30 | ◻ | 拒绝 Path Traversal/Symlink Escape/越权路径 | changeset-engine |  | M2-29 |
| M2-31 | ◻ | 支持 Precondition/Expected Digest/原子替换 | changeset-engine |  | M2-28 |
| M2-32 | ◻ | 人类手写区不被生成器覆盖 | reconcile-engine |  | M1-23 |
| M2-33 | ◻ | Apply 后自动 Validation 与 Projection 重建 | changeset-engine |  | M2-28,32 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M2-EG1 | ◻ | 能区分真实外部契约 vs 内部历史惯性 | Eval `refactor-or-patch` 分类正确 |
| M2-EG2 | ◻ | 高压力低信心进入 Proof Required | Eval `high-pressure-low-confidence` → Posture=ProofRequired |
| M2-EG3 | ◻ | 高/高 不只输出最小 Diff | Eval 断言无"仅最小补丁"建议 |
| M2-EG4 | ◻ | Migration 不被误标 Target | Eval `target-vs-migration` 通过 |
| M2-EG5 | ◻ | 无依据兼容检测 Recall ≥ 85% | `compatibility-debt` eval set 达标 |
| M2-EG6 | ◻ | ChangeSet 可完整回滚 | fault-injection：apply 中断 100% 回滚 |

## M3 · CLI、MCP 与 Coding Agent 集成

**目标**：把架构控制循环嵌入 Agentic Coding Runtime，而非要求用户手动运行分析命令。
**关联 ADR**：0006、0021、0014。 **前置**：M2 Exit Gate 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M3-01 | ◻ | 所有核心 Use Case 有 CLI 入口 | cli |  | M2-* |
| M3-02 | ◻ | 所有命令支持结构化 JSON 输出 | cli |  | M0-12 |
| M3-03 | ◻ | 输出支持 `--max-bytes`/`--max-items`/分页 | cli |  | M3-02 |
| M3-04 | ◻ | 提供 Human + Machine 两套渲染 | cli |  | M3-02 |
| M3-05 | ◻ | CLI 不绕过 Core Service | cli |  | — |
| M3-06 | ◻ | 实现 MCP Server 生命周期 | mcp-local |  | M2-* |
| M3-07 | ◻ | 默认仅暴露 5 个 Workflow Tool | mcp-local |  | M3-06 |
| M3-08 | ◻ | 详细对象通过 Resources 延迟加载 | mcp-local |  | M3-07 |
| M3-09 | ◻ | Tool Description 明确何时调用/不调用 | mcp-local |  | M3-07 |
| M3-10 | ◻ | 写 Tool 声明 Destructive/Idempotent/Read-only 注解 | mcp-local |  | M3-07 |
| M3-11 | ◻ | 写 Tool 要求显式确认或已批准 Plan | mcp-local |  | M2-28 |
| M3-12 | ◻ | MCP 输出不含无预算大段源码 | mcp-local |  | M2-03 |
| M3-13 | ◻ | stdout 仅协议，日志走 stderr/文件 | mcp-local |  | M3-06 |
| M3-14 | ◻ | 编写第一方 Bootstrap Skill | skills |  | M3-07 |
| M3-15 | ◻ | 编写 Develop Skill | skills |  | M3-07 |
| M3-16 | ◻ | 编写 Refactor/Intervention Skill | skills |  | M3-07 |
| M3-17 | ◻ | 编写 Review Skill | skills |  | M3-07 |
| M3-18 | ◻ | Skill 仅编排 Tool，不复制业务逻辑 | skills |  | — |
| M3-19 | ◻ | 生成 Codex/Claude Code/通用 MCP Host 配置 | cli |  | M3-06 |
| M3-20 | ◻ | Agent 编码前自动调用 `prepare_task` | skills |  | M3-14 |
| M3-21 | ◻ | Agent 关键变更后调用 `checkpoint` | skills |  | M3-15 |
| M3-22 | ◻ | Agent 完成前调用 `complete_task` | skills |  | M3-17 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M3-EG1 | ◻ | CLI 与 MCP 同任务语义一致 | 对照快照测试一致 |
| M3-EG2 | ◻ | Agent 不懂内部 Schema 也能同步 | 集成测试通过 |
| M3-EG3 | ◻ | 典型任务 MCP Tool Call 不超预算 | 预算断言 ≤ 阈值 |
| M3-EG4 | ◻ | Agent 不能直写未验证模型 | 安全测试：直写被拒 |
| M3-EG5 | ◻ | 中断后新 Session 从 Task State 恢复 | 恢复测试通过 |

## M4 · ChatGPT App / GPT App

**目标**：把任务上下文/架构决策/Review 安全暴露给 ChatGPT，私有内容不经 SaaS。可按需降级为 v1.1。
**关联 ADR**：0018、0019、0020、0003。 **前置**：M3 Exit Gate 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M4-01 | ◻ | 本地 stdio MCP 保持完整能力 | mcp-local |  | M3-06 |
| M4-02 | ◻ | 本地 Streamable HTTP MCP 与 daemon 共 Core | mcp-local |  | M3-06 |
| M4-03 | ◻ | Streamable HTTP 默认仅绑定 Loopback | mcp-local |  | M4-02 |
| M4-04 | ◻ | Secure MCP Tunnel 启动/停止/状态/撤销 | mcp-local |  | M4-02 |
| M4-05 | ◻ | Tunnel 显式 Opt-in，默认关闭 | mcp-local |  | M4-04 |
| M4-06 | ◻ | SaaS Remote MCP 仅 Account/Billing/GitHub/Device | mcp-cloud-metadata |  | M5-01 |
| M4-07 | ◻ | SaaS Remote MCP 无 Repository Content Proxy | mcp-cloud-metadata |  | M4-06 |
| M4-08 | ◻ | 默认 Read-only Context/Arch/Intervention/Review 摘要 | mcp-local |  | M4-02 |
| M4-09 | ◻ | 大内容只返回摘要 + Resource URI | mcp-local |  | M3-08 |
| M4-10 | ◻ | 默认不向 ChatGPT 暴露 Apply ChangeSet | mcp-local |  | M4-08 |
| M4-11 | ◻ | 启用写入后每次 Apply 仍需本地确认 | mcp-local |  | M2-28 |
| M4-12 | ◻ | 工具返回明确 Data Classification | mcp-local |  | M4-08 |
| M4-13 | ◻ | UI 展示 Repo/HEAD/Dirty 与数据共享提示 | chatgpt-ui |  | M4-08 |
| M4-14 | ◻ | 使用 `_meta.ui.resourceUri` 绑定 UI Resource | chatgpt-ui |  | M4-08 |
| M4-15 | ◻ | 使用标准 `ui/*` Host Bridge | chatgpt-ui |  | M4-14 |
| M4-16 | ◻ | UI：Task Context Card | chatgpt-ui |  | M4-14 |
| M4-17 | ◻ | UI：Pressure/Confidence Matrix | chatgpt-ui |  | M2-02 |
| M4-18 | ◻ | UI：Target 与 Migration 对照 | chatgpt-ui |  | M2-20,21 |
| M4-19 | ◻ | UI：ChangeSet Diff 预览 | chatgpt-ui |  | M2-28 |
| M4-20 | ◻ | UI：Review Findings Summary | chatgpt-ui |  | M2-05 |
| M4-21 | ◻ | 无 UI 的 MCP Host 仍可完整用工具 | mcp-local |  | M4-08 |
| M4-22 | ◻ | Remote MCP 使用 OAuth 2.1 / PKCE | control-plane |  | M5-01 |
| M4-23 | ◻ | Access Token 验证 Audience 与 Scope | control-plane |  | M4-22 |
| M4-24 | ◻ | Local Tunnel Session 使用短期凭证 | mcp-local |  | M4-04 |
| M4-25 | ◻ | Device 与 Tunnel 可在 Dashboard 撤销 | control-plane |  | M5-* |
| M4-26 | ◻ | Tunnel 断开后会话立即失效 | mcp-local |  | M4-04 |
| M4-27 | ◻ | 不把 SaaS Token 透传给 GitHub 等 | control-plane |  | M4-22 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M4-EG1 | ◻ | ChatGPT 可发现并调用 Read-only Tool | 连接器 e2e/手测 |
| M4-EG2 | ◻ | 私有内容不经 Worker/D1/Queue/日志 | 抓包 + 路由审计 |
| M4-EG3 | ◻ | UI 清楚提示数据将发往 OpenAI | Disclosure 截图核对 |
| M4-EG4 | ◻ | 禁写模式任何调用无法改 Repository | 负向测试 |
| M4-EG5 | ◻ | 写模式未本地批准 ChangeSet 不 Apply | 负向测试 |
| M4-EG6 | ◻ | Tunnel 撤销/Token Replay/Scope Escalation 测试通过 | 安全测试套件 |

## M5 · SaaS、计费与 GitHub Attestation

**目标**：建立可收费但不托管代码的最小控制平面。
**关联 ADR**：0003、0015、0016、0017、0023、0024。 **前置**：M2 Exit Gate（Attestation 依赖 Review）；可与 M3/M4 并行。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M5-01 | ◻ | GitHub OAuth 登录 | control-plane |  | — |
| M5-02 | ◻ | Device Authorization / Browser Login | control-plane |  | M5-01 |
| M5-03 | ◻ | 短期 Access + 安全 Refresh Token 存储 | control-plane-client |  | M5-01 |
| M5-04 | ◻ | OS Keychain 集成 | control-plane-client |  | M5-03 |
| M5-05 | ◻ | Public Repository 免费权益 | control-plane |  | M5-01 |
| M5-06 | ◻ | Pro 5 美元/月覆盖个人全部私有仓 | control-plane |  | M5-20 |
| M5-07 | ◻ | Subscription 状态同步 | control-plane |  | M5-22 |
| M5-08 | ◻ | Offline Grace Period | control-plane-client |  | M5-09 |
| M5-09 | ◻ | Entitlement Token 签名与验证 | control-plane |  | M5-05 |
| M5-10 | ◻ | GitHub App 安装与卸载流程 | github-app |  | — |
| M5-11 | ◻ | Repository Selection 同步 | github-app |  | M5-10 |
| M5-12 | ◻ | Pull Request Webhook | github-app |  | M5-10 |
| M5-13 | ◻ | Webhook Signature 验证 | github-app |  | M5-12 |
| M5-14 | ◻ | Delivery ID 幂等 | github-app |  | M5-12 |
| M5-15 | ◻ | 创建 Review Challenge | github-app |  | M5-12 |
| M5-16 | ◻ | 创建 queued Check Run | github-app |  | M5-15 |
| M5-17 | ◻ | 验证 Attestation 后更新 Check Run | attestation |  | M5-15,M2-05 |
| M5-18 | ◻ | 新 Head SHA 自动使旧 Attestation 失效 | github-app |  | M5-17 |
| M5-19 | ◻ | 默认权限不含 Contents | github-app |  | M5-10 |
| M5-20 | ◻ | Stripe Checkout | control-plane |  | M5-01 |
| M5-21 | ◻ | Stripe Customer Portal | control-plane |  | M5-20 |
| M5-22 | ◻ | Subscription Webhook | control-plane |  | M5-20 |
| M5-23 | ◻ | Invoice / Payment 状态映射 | control-plane |  | M5-22 |
| M5-24 | ◻ | 取消、退款与 Past Due 规则 | control-plane |  | M5-22 |
| M5-25 | ◻ | Webhook 幂等与重放保护 | control-plane |  | M5-22 |
| M5-26 | ◻ | Worker CPU/Body/Rate/Timeout 上限 | control-plane |  | — |
| M5-27 | ◻ | D1 Migration | cloud-db |  | — |
| M5-28 | ◻ | 所有高频查询有索引 | cloud-db |  | M5-27 |
| M5-29 | ◻ | Queue 最小消息体 | control-plane |  | — |
| M5-30 | ◻ | 日志 Redaction | control-plane |  | — |
| M5-31 | ◻ | 数据保留 Job | cloud-db |  | M5-27 |
| M5-32 | ◻ | 成本告警 | control-plane |  | — |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M5-EG1 | ◻ | SaaS 无上传 Source/Diff/Model 的 API | 路由清单隐私契约测试（无 upload-code/index/review-detail/embeddings） |
| M5-EG2 | ◻ | GitHub App 权限可公开核验 | 权限截图 + Privacy Audit |
| M5-EG3 | ◻ | Attestation 防伪/防重放 | 负向测试：replay/错SHA/错repo/过期 Challenge 全拒 |
| M5-EG4 | ◻ | 公开仓无订阅可工作 | e2e 通过 |
| M5-EG5 | ◻ | 多私有仓单订阅无新增计费 | e2e 通过 |
| M5-EG6 | ◻ | 取消订阅按规则降级 | e2e：公开能力不受损 |

## M6 · Beta Hardening 与发布

**目标**：跨平台、安全与体验加固，闭合 Launch Gate。
**关联 ADR**：0003（隐私验证）及全部不变量回归。 **前置**：M1–M5 Exit Gate 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| M6-01 | ◻ | macOS/Linux/Windows 基础支持 | cross |  | — |
| M6-02 | ◻ | Node.js LTS 支持矩阵 | cross |  | — |
| M6-03 | ◻ | 大型 Repository 性能测试 | runtime-daemon |  | M1-* |
| M6-04 | ◻ | Dirty Worktree/Merge Conflict/Detached HEAD 测试 | git-adapter |  | M1-04 |
| M6-05 | ◻ | 多 Worktree 与 Monorepo 测试 | runtime-daemon |  | M1-02 |
| M6-06 | ◻ | 崩溃恢复与 DB 损坏恢复文档 | docs |  | M1-09 |
| M6-07 | ◻ | 自动升级与回滚策略 | cli |  | — |
| M6-08 | ◻ | 外部安全审查 / 独立 Threat Review | cross/security |  | M0-17 |
| M6-09 | ◻ | Dependency Audit | cross |  | — |
| M6-10 | ◻ | Secret Scan | cross/security |  | — |
| M6-11 | ◻ | Symlink/Path Traversal/Command Injection 测试 | changeset-engine |  | M2-30 |
| M6-12 | ◻ | MCP Prompt Injection / Tool Poisoning 测试 | mcp-local |  | M3-06 |
| M6-13 | ◻ | OAuth/Webhook/Attestation 渗透测试 | control-plane |  | M5-* |
| M6-14 | ◻ | Secure Defaults 验收 | cross/security |  | — |
| M6-15 | ◻ | 一条命令安装与卸载 | cli |  | — |
| M6-16 | ◻ | 首次运行 Diagnostics | cli |  | M1-14 |
| M6-17 | ◻ | Privacy Audit 页面与 CLI | cli |  | M5-EG1 |
| M6-18 | ◻ | Troubleshooting Guide | docs |  | — |
| M6-19 | ◻ | 示例 Repository | docs |  | M1-* |
| M6-20 | ◻ | 公开 Repository Demo | docs |  | M6-19 |
| M6-21 | ◻ | Schema Upgrade Guide | docs |  | M0-11 |
| M6-22 | ◻ | Data Export / Delete | control-plane |  | M5-* |

**Launch Gate（任一未满足禁止宣称正式可用）**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| M6-EG1 | ◻ | Source 不进 SaaS 技术验证完成 | 全链路抓包 + 路由审计 |
| M6-EG2 | ◻ | ChangeSet 不可越权写文件 | 路径逃逸测试全过 |
| M6-EG3 | ◻ | Review 与 HEAD/Worktree 绑定正确 | 绑定/Stale 测试 |
| M6-EG4 | ◻ | CodeGraph 版本兼容测试完成 | 兼容矩阵 CI |
| M6-EG5 | ◻ | ChatGPT Data Sharing 提示清晰 | Disclosure 走查截图 |
| M6-EG6 | ◻ | Critical/High 安全 Finding 为零 | 安全扫描报告 |
| M6-EG7 | ◻ | 关键 Eval 达 PRD §25.3 目标 | Eval 报告达标 |
| M6-EG8 | ◻ | 崩溃恢复与数据迁移有可重复演练 | Runbook + 演练记录 |
| M6-EG9 | ◻ | 10 分钟内完成安装→初始化→首个任务 | 计时走查 |

---

## Post-MVP（明确不在本 Sprint，防止范围蔓延）

Multi-repo Architecture Context · Organization Runner Attestation · Team/Enterprise Governance · LikeC4/Structurizr 输出 Adapter · Slack/Webhook/Email 通知 Provider · 浏览器 Architecture Explorer · Trusted Execution / Device Integrity · GPT App 发布目录 · Embedding/Vector（默认关闭，需 Eval 通过）。

## Execution Log

Keep this section last; `.ai/harness/scripts/sprint-backlog.sh complete-task` appends rows here。逐条完成时同步更新行状态、「进度总览」完成数与「ADR 实现矩阵」状态。

| When | Task | Plan | Result |
|------|------|------|--------|
| 2026-06-19 | archctx-m0-contracts-freeze | Freeze schemas, ports, error/envelope/digest contract, ADRs, and threat model | Complete; `bun test packages/contracts/test/contracts.test.ts` = 26 pass |
| 2026-06-19 | archctx-m1-local-runtime | Implement local daemon/session/store/codefacts/model/CLI foundation | Complete; `bun test` = 38 pass |
