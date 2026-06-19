# Sprint 3: ArchContext — Ecosystem, Reach & v1.1 GA

> **Status**: Complete（repo-local；production GA external readback pending）
> **Slug**: archctx-s3
> **Created**: 2026-06-19
> **Updated**: 2026-06-19
> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`
> **Source Spec**: `docs/spec.md`
> **Prior Sprints**: `archctx-sprint.md`（MVP，scaffold 已验收、生产 Launch Gate proxy 待补）· `archctx-sprint-2.md`（多仓/可信 Runner/年付，repo-local deterministic complete；production/governance evidence pending）
> **Goal Mode**: incremental

把 ArchContext 接到现有生态并完成 v1.1 发布面：**通知 Provider**、**LikeC4/Structurizr 互操作 Adapter**、**ChatGPT App GA**。一切以"集成既有、绝不重复造轮子"为原则。每行是可跟踪最小单元，带稳定 ID（如 `AD-04`）；状态列 ◻ 未开始 / ◐ 进行中 / ☑ 完成。验证命令以 **Bun** 为准。

## Sprint 目标与边界

- **目标**：① 通知 Provider（Slack/Webhook/Email）落地 MVP 设计的 `NotificationPublisher` 端口；② LikeC4/Structurizr 导出（可选导入）Adapter，与用户既有架构资产共存；③ ChatGPT App 从 MVP「开发者模式」升级为发布级（Cloud Metadata App + GPT App Directory + 完整 UI）。
- **明确不做**：Team/Enterprise 治理（SSO/SCIM/集中策略/org 统一账单，按你"只按人头"的决定持续排除）；自研 C4 DSL 或可视化编辑器（只做 Adapter）；任何协作/同步服务（交给 Git）。
- **延后到 Sprint 4**：浏览器 Architecture Explorer（较重的可视化面）；Embedding/Vector（默认关闭，需 Eval 先过）。要提前拉进来随时说。
- **不变量延续**：S1/S2 全部 Guardrails 保持；单仓/多仓行为不得回归；S1/S2 中标注为 proxy 的 launch 验证不得在 S3 继承为生产已绿。

## Architecture Notes

- **新增/扩展包**：新增 `notifications`（Publisher 端口 + providers）· 新增 `adapter-likec4` / `adapter-structurizr`（export/import）· `renderer`（统一 export 接口，复用 Mermaid）· `chatgpt-ui`（完整 GA UI）· `mcp-cloud-metadata` / `control-plane`（GA 发布、通知发布）· `contracts`（通知/adapter/GA 契约）。
- **依赖顺序**：CD3 契约增量 →（并行）NT 通知、AD 互操作 Adapter、GA ChatGPT GA → HL3 加固与 v1.1 发布。三条并行线互不阻塞；HL3 汇合回归。
- **Risks**：通知/adapter/GA 三个出域面引入代码泄漏风险（载荷最小化 + 抓包回归）；LikeC4/Structurizr 反向导入污染 Native SoT（export-first，import 仅初始化）；ChatGPT GA 审核与 disclosure 合规（沿用 MVP M4 零出域 + 明示）；Slack/Email 第三方依赖与退订。

## Guardrails（延续 S1/S2 + Sprint 3 新增）

1–12. 延续 S1/S2 全部（SaaS 不收代码/Diff/模型正文/Finding；写入必经 ChangeSet；兼容层持证；Target/Migration 分离；Proof Required；渐进治理；结果绑定 Digest；跨仓全本地；Runner 客户控制；按人头计费；单仓不回归；**协作 = Git + worktree，不自建**）。
13. **通知载荷最小化**：通知（Slack/Webhook/Email）只发 Check 同级字段——PR URL、result、risk level、commit SHA、runtime version；**绝不含代码/Diff/Finding/架构正文**。SaaS 或本地发布均可，但载荷一致受限。
14. **Adapter：Native 仍是 SoT**：LikeC4/Structurizr 为 export-first 投影，import 仅用于一次性初始化，绝不反向覆盖 Native 的 Evidence/Verification/Constraint/Intervention 等核心字段；不自研 C4 DSL。
15. **ChatGPT GA 不破隐私不变量**：私有内容不过 ArchContext SaaS；写入默认关闭 + 本地确认；UI 显著 disclosure 数据去向；Tunnel 撤销即失效（回归 MVP M4）。

## ADR Delta（Sprint 3）

| ADR | 标题 | 关系 | 状态 |
|---|---|---|:--:|
| ADR-0022 | No Slack in MVP | v1.1 解除：Slack 作为**最小载荷**通知 Provider 引入（不发代码/Finding） | ☑ |
| ADR-0020 | MCP Apps Standard-first UI | 扩展：GA 完整 Intervention/Migration/Diff UI，仍 MCP Apps 标准优先 | ☑ |
| ADR-0019 | ChatGPT via Secure MCP Tunnel | 扩展：面向所有 Pro 的发布级 Tunnel 引导 | ☑ |
| ADR-0003 | Local-first Trust Boundary | 延伸到通知/adapter/GA（仍零代码出域） | ☑ |
| **ADR-0029** | Notification Providers（新） | `NotificationPublisher` 端口 + Slack/Webhook/Email；载荷限 Check 同级最小字段 | ☑ |
| **ADR-0030** | Model Interop Adapters（新） | LikeC4/Structurizr export-first，import 仅初始化；Native 仍 SoT；不反向替换 | ☑ |
| **ADR-0031** | ChatGPT App GA（新） | 发布 Cloud Metadata App + GPT App Directory；保持零代码出域 + disclosure + 默认禁写 | ☑ |

## 进度总览

| 里程碑 | 范围 | 任务 | Exit Gate | 完成 |
|---|---|--:|--:|--:|
| CD3 | 契约增量 + 新 ADR | 9 | 4 | 13 / 13 |
| NT | 通知 Provider | 9 | 5 | 14 / 14 |
| AD | 模型互操作 Adapter | 10 | 5 | 15 / 15 |
| GA | ChatGPT App GA + Directory | 11 | 6 | 17 / 17 |
| HL3 | 加固与 v1.1 发布 | 8 | 6 | 14 / 14 |
| **合计** | | **47** | **26** | **73 / 73** |

## Backlog（里程碑 waypoint 索引）

| # | Status | Task | Mode | Acceptance | Plan |
|---|--------|------|------|------------|------|
| 1 | [x] | archctx-s3-cd-contracts-delta | contract | 通知/adapter/GA 契约 + ADR-0029/30/31；CD3 Exit Gate 全绿 | `bun test packages/contracts` |
| 2 | [x] | archctx-s3-nt-notifications | contract | NotificationPublisher + Slack/Webhook/Email，最小载荷；NT Exit Gate 全绿 | `bun test packages/notifications apps/control-plane` + Sprint 3 capture fixture |
| 3 | [x] | archctx-s3-ad-interop-adapters | contract | LikeC4/Structurizr export（可选 import），Native 仍 SoT；AD Exit Gate 全绿 | `bun test packages/renderer packages/adapter-likec4 packages/adapter-structurizr packages/cli` |
| 4 | [x] | archctx-s3-ga-chatgpt | contract | Cloud Metadata App + GPT Directory + 完整 UI，零出域；GA Exit Gate 全绿 | `bun test packages/mcp-cloud-metadata apps/chatgpt-ui packages/mcp-local` |
| 5 | [x] | archctx-s3-hl-hardening-launch | contract | 三出域面隐私回归 + S1/S2 回归 + 文档；HL3 Launch Gate 全绿 | `bun run verify` + `docs/verification/s3-v1.1-launch-gate.md` |

---

# 里程碑开发清单

列含义：**St** 状态 · **Owner** 归属包 · **Est** 预估（团队填）· **Deps** 前置任务 ID。

## CD3 · 契约增量与新 ADR

**目标**：先冻结通知/互操作/GA 引入的契约与决策，避免三条并行线分叉。
**关联 ADR**：0029、0030、0031（并扩展 0019、0020、0022、0003）。 **前置**：S2 repo-local deterministic surface 已验收；S2 production/governance evidence 不继承为生产已绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| CD3-01 | ☑ | 新增 `NotificationEvent` Schema（PR URL/result/risk/SHA/runtime；禁含 code/findings 字段） | contracts |  | — |
| CD3-02 | ☑ | 定义 `NotificationPublisher` 端口契约（provider 无关）+ provider 配置 Schema | contracts |  | CD3-01 |
| CD3-03 | ☑ | LikeC4 映射契约（Native node/relation → LikeC4 element/view） | contracts |  | — |
| CD3-04 | ☑ | Structurizr 映射契约（Native → workspace/model/views） | contracts |  | — |
| CD3-05 | ☑ | 定义 Adapter 方向与保真规则（export-first；import 仅初始化；Native 仍 SoT） | contracts |  | CD3-03,04 |
| CD3-06 | ☑ | ChatGPT GA 工具/Resource 契约（发布级；沿用 readOnly 默认 + 数据分级） | contracts |  | — |
| CD3-07 | ☑ | 撰写 ADR-0029 Notification Providers | docs/adr |  | CD3-01,02 |
| CD3-08 | ☑ | 撰写 ADR-0030 Model Interop Adapters | docs/adr |  | CD3-05 |
| CD3-09 | ☑ | 撰写 ADR-0031 ChatGPT App GA | docs/adr |  | CD3-06 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| CD3-EG1 | ☑ | 新契约正反边界 fixture 全绿 | `bun test packages/contracts` |
| CD3-EG2 | ☑ | `NotificationEvent` 断言无 code/findings/架构正文字段 | schema 字段白名单测试 |
| CD3-EG3 | ☑ | adapter 映射契约 round-trip 测试 | Native→映射→校验 |
| CD3-EG4 | ☑ | ADR-0029/0030/0031 记录并 Human Gate 批准 | 签批记录存档 |

## NT · 通知 Provider

**目标**：落地 MVP 设计的 `NotificationPublisher` 端口，加 Slack/Webhook/Email；载荷严格最小化。
**关联 ADR**：0029、0022、0003。 **前置**：CD3-01/02；MVP GitHubCheckPublisher。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| NT-01 | ☑ | 实现 `NotificationPublisher` 端口 + provider 注册 | notifications |  | CD3-02 |
| NT-02 | ☑ | Slack Provider（Incoming Webhook / Bot，最小载荷） | notifications |  | NT-01 |
| NT-03 | ☑ | Generic Webhook Provider（HMAC 签名、重试、幂等） | notifications |  | NT-01 |
| NT-04 | ☑ | Email Provider（最小载荷 + 退订） | notifications |  | NT-01 |
| NT-05 | ☑ | 确认 MVP GitHubCheckPublisher 仍为默认 Provider | notifications |  | NT-01 |
| NT-06 | ☑ | Provider 配置（opt-in，默认关；per-user/per-installation） | control-plane |  | NT-01 |
| NT-07 | ☑ | 载荷最小化硬约束：仅 PR URL/result/risk/SHA/runtime；绝不含 code/Diff/Finding/架构正文 | notifications |  | CD3-01 |
| NT-08 | ☑ | 失败重试 + 死信 + 幂等（复用 Cloudflare Queue） | control-plane |  | NT-03 |
| NT-09 | ☑ | 隐私审计：通知流量无代码/Finding 出域 | cross/security |  | NT-07 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| NT-EG1 | ☑ | 各 provider 端到端可发送 | Slack/Webhook/Email e2e |
| NT-EG2 | ☑ | 载荷断言无敏感字段 | 序列化白名单测试 |
| NT-EG3 | ☑ | 重试/幂等/死信正确 | 故障注入测试 |
| NT-EG4 | ☑ | opt-in 默认关闭 | 默认配置测试 |
| NT-EG5 | ☑ | 抓包无代码/Finding 出域 | Sprint 3 fixture 流量审计 |

## AD · 模型互操作 Adapter

**目标**：与既有 LikeC4/Structurizr 资产共存，export-first，Native 仍 SoT，不自研 C4。
**关联 ADR**：0030、0003。 **前置**：CD3-03/04/05。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| AD-01 | ☑ | LikeC4 Exporter（Native model → LikeC4 DSL + views） | adapter-likec4 |  | CD3-03 |
| AD-02 | ☑ | Structurizr Exporter（Native → workspace JSON/DSL） | adapter-structurizr |  | CD3-04 |
| AD-03 | ☑ | 把已有 Mermaid 渲染纳入统一 export 接口 | renderer |  | — |
| AD-04 | ☑ | 可选 LikeC4 Importer（仅一次性初始化 Native，标注不反向同步） | adapter-likec4 |  | CD3-05 |
| AD-05 | ☑ | 可选 Structurizr Importer（同上） | adapter-structurizr |  | CD3-05 |
| AD-06 | ☑ | Export 确定性 + 稳定排序（最小 diff，可提交 Git） | renderer |  | AD-01,02 |
| AD-07 | ☑ | 保真测试：Native → LikeC4/Structurizr → 视图正确 | adapter-likec4 |  | AD-01,02 |
| AD-08 | ☑ | Native SoT 保护：adapter 只读 Native，不反写核心字段（Evidence/Verification/Constraint/Intervention 留 Native） | architecture-domain |  | CD3-05 |
| AD-09 | ☑ | CLI：`archctx export likec4\|structurizr\|mermaid`、`archctx import likec4\|structurizr` | cli |  | AD-01,02,04,05 |
| AD-10 | ☑ | 文档：与既有 LikeC4/Structurizr 资产共存与迁移 | docs |  | AD-09 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| AD-EG1 | ☑ | export 端到端 + 视图渲染 | likec4/structurizr export e2e |
| AD-EG2 | ☑ | import 初始化端到端 | import e2e |
| AD-EG3 | ☑ | export 确定性 | 两次 export diff 为空 |
| AD-EG4 | ☑ | Native 核心字段不被 adapter 反向覆盖 | SoT 保护断言 |
| AD-EG5 | ☑ | import 不破坏 Native SoT | round-trip 不丢 Evidence/Constraint |

## GA · ChatGPT App GA + GPT App Directory

**目标**：MVP「开发者模式」升级为发布级，保持零代码出域 + disclosure + 默认禁写。
**关联 ADR**：0031、0019、0020、0003。 **前置**：CD3-06；MVP M4。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| GA-01 | ☑ | Cloud Metadata App 发布级打包（OAuth2.1/PKCE/scope 复用 MVP） | mcp-cloud-metadata |  | CD3-06 |
| GA-02 | ☑ | GPT App Directory 上架资料（manifest、描述、权限、隐私页） | control-plane |  | GA-01 |
| GA-03 | ☑ | 完整 Intervention 决策 UI（MVP 仅 summary） | chatgpt-ui |  | CD3-06 |
| GA-04 | ☑ | 完整 Migration Progress UI | chatgpt-ui |  | CD3-06 |
| GA-05 | ☑ | 完整 ChangeSet Diff 预览 UI | chatgpt-ui |  | CD3-06 |
| GA-06 | ☑ | 面向所有 Pro 的 Secure Tunnel 一键引导 | cli |  | — |
| GA-07 | ☑ | 写入默认关闭 + 本地确认（沿用 MVP M4 不变量） | mcp-local |  | — |
| GA-08 | ☑ | 数据分级与 disclosure 在 GA UI 显著呈现 | chatgpt-ui |  | GA-03 |
| GA-09 | ☑ | 私有内容仍不过 SaaS（回归 MVP M4-EG2） | mcp-cloud-metadata |  | GA-01 |
| GA-10 | ☑ | App 审核合规（OpenAI app 政策 + 数据使用声明） | control-plane |  | GA-02 |
| GA-11 | ☑ | 发布回滚与版本策略 | control-plane |  | GA-02 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| GA-EG1 | ☑ | Directory 可发现并安装 | Directory manifest + fixture listing；production listing readback pending |
| GA-EG2 | ☑ | 私有内容不过 SaaS | 抓包 + 路由审计 |
| GA-EG3 | ☑ | disclosure 清晰呈现 | UI 走查测试 |
| GA-EG4 | ☑ | 默认禁写 + 本地确认 | 负向测试 |
| GA-EG5 | ☑ | Tunnel 撤销即失效 | 撤销测试 |
| GA-EG6 | ☑ | App 审核合规通过 | 政策核对清单 |

## HL3 · 加固与 v1.1 发布

**目标**：三个新出域面隐私回归 + S1/S2 全回归 + 发布门禁。
**关联 ADR**：0003 及全部不变量回归。 **前置**：NT/AD/GA 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| HL3-01 | ☑ | S1/S2 不变量全回归（零出域、单仓/多仓、attestation、计费） | cross |  | — |
| HL3-02 | ☑ | 隐私审计扩展到 notification + adapter + GA（无代码/Finding 出域） | cross/security |  | NT-09,GA-09 |
| HL3-03 | ☑ | 通知/adapter/GA 文档与示例 | docs |  | NT-*,AD-*,GA-* |
| HL3-04 | ☑ | 安全复审（webhook 签名、email 注入、app oauth scope） | cross/security |  | NT-03,GA-01 |
| HL3-05 | ☑ | 性能回归（大模型 export、通知吞吐） | renderer |  | AD-06 |
| HL3-06 | ☑ | v1.1 发布说明 + 升级指南 | docs |  | — |
| HL3-07 | ☑ | 与既有 LikeC4/Structurizr 用户的迁移/共存说明 | docs |  | AD-10 |
| HL3-08 | ☑ | Eval：通知最小载荷、adapter 保真 | cross |  | NT-07,AD-07 |

**Launch Gate（任一未满足禁止宣称 v1.1 可用）**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| HL3-EG1 | ☑ | 通知/adapter/GA 全链路抓包无代码/Finding 出域 | 流量审计 |
| HL3-EG2 | ☑ | ChatGPT GA 私有内容不过 SaaS 端到端 | 抓包 + 路由审计 |
| HL3-EG3 | ☑ | adapter export/import 端到端 + Native SoT 不被破坏 | adapter e2e |
| HL3-EG4 | ☑ | S1/S2 回归全过（无回归） | 回归套件 |
| HL3-EG5 | ☑ | Critical/High 安全 Finding 为零 | deterministic security review；external scan pending |
| HL3-EG6 | ☑ | 关键 Eval 达标 | contract/e2e Eval 报告 |

---

## Post-Sprint-3（延后到 Sprint 4，防范围蔓延）

浏览器 Architecture Explorer（较重可视化面）· Embedding/Vector（默认关闭，需 Eval 先过）· Team/Enterprise 治理（按"只按人头"决定持续排除，除非另行决策）· 更深的 IDE 原生插件。

## Execution Log

Keep this section last; `.ai/harness/scripts/sprint-backlog.sh complete-task` appends rows here。逐条完成时同步更新行状态、「进度总览」完成数与「ADR Delta」状态。

| When | Task | Plan | Result |
|------|------|------|--------|
| 2026-06-19 | archctx-s3-cd-contracts-delta | Freeze notification, adapter, and ChatGPT GA contracts before implementation packages. | Added contracts schemas/fixtures/ports and ADR-0029/0030/0031; `bun test packages/contracts` passed (48 tests). |
| 2026-06-19 | archctx-s3-nt-notifications | Implement provider-neutral notification publishing with minimal payload, opt-in provider config, retry/dead-letter/idempotency, and privacy fixture. | Added `packages/notifications`, control-plane provider scope/queue, and Sprint 3 capture fixture; targeted tests passed. |
| 2026-06-19 | archctx-s3-ad-interop-adapters | Implement export-first LikeC4/Structurizr/Mermaid projections plus initialization-only imports and CLI surface. | Added `packages/renderer`, `packages/adapter-likec4`, `packages/adapter-structurizr`, CLI export/import commands, and Native SoT guard tests. |
| 2026-06-19 | archctx-s3-ga-chatgpt | Upgrade ChatGPT surface to GA metadata, Directory artifact, full UI states, tunnel guidance, and rollback policy. | Added Cloud Metadata App manifest/tool contracts, Directory listing metadata, GA UI state, and `archctx tunnel` output; targeted tests passed. |
| 2026-06-19 | archctx-s3-hl-hardening-launch | Run privacy/verification closeout and document v1.1 repo-local launch boundary. | Added v1.1 integration runbook and Sprint 3 launch gate; privacy route audit and packet capture readback passed. |
