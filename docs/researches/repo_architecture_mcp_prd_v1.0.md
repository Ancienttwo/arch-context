---
title: "ArchContext 产品需求文档（PRD）"
subtitle: "GitHub App 治理 + 本地 MCP 架构知识运行时"
author: "产品代号：ArchContext"
date: "2026-06-19"
lang: zh-CN
---

> **状态：已被 `plans/prds/20260619-2039-archcontext.prd.md`（ArchContext PRD v2.0）取代（2026-06-19）。** 按"编号大、时间最新者为准"，v2.0 是当前权威 PRD；本 v1.0 保留为历史基线，与 v2.0 冲突处以 v2.0 为准。

# 目录

1. 文档控制与关键决策
2. 产品概述
3. 背景与问题定义
4. 产品愿景与原则
5. 目标用户与场景
6. 产品目标与非目标
7. 产品范围与系统边界
8. 商业模式与权益规则
9. 总体架构
10. 数据边界与隐私
11. 核心用户流程
12. 功能需求
13. Local MCP Runtime 设计
14. 架构模型、文档与数据库
15. Review 模型
16. GitHub App 需求
17. SaaS Control Plane
18. 非功能需求
19. 安全与威胁模型
20. 数据模型
21. UX 与产品文案
22. 成功指标
23. MVP 里程碑
24. 发布验收标准
25. 风险与缓解
26. 发布前待确认项及建议默认值
27. 附录：ChangeSet、CLI 与参考资料

# 文档控制

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 文档状态 | MVP 立项稿 |
| 产品阶段 | Discovery / Definition |
| 目标平台 | GitHub.com、本地 MCP 兼容 Agent |
| 商业模式 | 公开仓库免费；个人开发者 5 美元/月使用全部私有仓库 |
| 数据原则 | 仓库内容与派生代码情报不进入本产品 SaaS |
| 最后更新 | 2026-06-19 |

## 关键决策摘要

1. **产品是本地优先的架构知识系统，不是云端代码分析服务。**
2. **GitHub App 负责仓库安装、PR 事件和 Check；本地 MCP Runtime 负责代码理解、文档读写、索引与 Review。**
3. **CodeGraph 是必需的代码读取与关系查询底座（经 Adapter 软耦合、锁版本）；Architecture Engine 负责架构模型、文档、数据库和策略。**
4. **公开仓库全部核心能力免费。**计费判定按 GitHub `public` 可见性，不检查开源许可证。
5. **个人 Pro 为 5 美元/月/人，解锁该开发者可访问的全部私有仓库。**不按仓库数、Token 数或本地调用量计费。
6. **订阅跟随个人身份，不跟随仓库。**同一个私有仓库的多名开发者分别使用时，每名使用者需要自己的有效订阅。
7. **架构文件是可版本化事实来源；本地 SQLite 是可重建索引。**
8. **实时自动更新索引，默认只建议文档变更；写入采用预览—确认—事务提交。**
9. **PR Check 只接收最小元数据与签名证明。**详细代码、Diff、文件路径、架构关系与 Review 发现默认不经过 SaaS。
10. **MVP 不提供组织级集中治理、可信 CI Runner、跨仓库图谱或 GHES。**

# 1. 产品概述

## 1.1 一句话定义

ArchContext 是一个面向 AI 编程 Agent 的本地架构运行时：它把 CodeGraph 的代码事实和仓库内的架构意图编译成任务上下文、安全变更和可验证 Review，通过 MCP 在日常开发中提供架构上下文，并由 GitHub App 将本地 Review 结果绑定到 Pull Request 的 Commit SHA。目标是把软件工程方法嵌入 Agent 开发流程，让没有架构经验的开发者也能把简单应用持续演进为可维护的复杂产品。

## 1.2 核心价值

当前编程 Agent 通常可以读取代码，却缺少稳定、可审计、持续更新的架构知识层。结果是：

- Agent 每次任务都重复探索仓库，成本高且上下文不一致；
- `ARCHITECTURE.md`、ADR、服务边界和依赖图容易过期；
- PR Review 很难确认代码变更是否同步更新了架构说明；
- 私有仓库用户通常不能接受代码、索引或架构图被上传到第三方 SaaS；
- 云端平台很难既提供治理，又不持有客户代码。

本产品把执行面放在用户本地，把控制面放在 SaaS：

```text
本地执行面
CodeGraph + Architecture Engine + Local DB + MCP + Review

远程控制面
OAuth + 订阅 + GitHub App + PR Check + 最小化 Attestation
```

## 1.3 产品承诺

> 你的代码、代码 Diff、CodeGraph、架构文档和架构索引不会被本产品上传到 SaaS。

边界说明：本地 MCP 会把用户请求所需的上下文返回给用户选择的 Agent。若该 Agent 使用云端模型，相关上下文可能由该 Agent 供应商处理；本产品只能保证这些内容不进入本产品的 SaaS、日志或计费系统。

# 2. 背景与问题定义

## 2.1 用户问题

### P1：代码知识与架构知识割裂

CodeGraph 能回答“谁调用了这个函数”“哪些模块依赖这个包”，但不能天然表达业务域、系统责任、架构约束、ADR、所有权和允许/禁止的依赖方向。

### P2：架构文档不可持续

手工文档的更新依赖开发者记忆。自动生成文档又常常缺少稳定 ID、证据和人工确认，最终变成无法信任的噪声。

### P3：Agent 缺少日常架构上下文

在功能设计、重构、修复 Bug 和 Review 期间，Agent 需要同时理解：

- 当前代码结构；
- 声明式架构模型；
- 历史 ADR；
- 依赖与数据边界政策；
- 本次变更影响范围。

这些信息目前通常分散在多个 Markdown、Wiki、Issue 和人的记忆中。

### P4：私有代码不能进入供应商基础设施

个人开发者和企业用户都可能拒绝把源代码、Embedding、符号图或架构关系上传到外部服务。传统 SaaS Worker 模型与该约束冲突。

### P5：GitHub 上缺少可验证闭环

即使本地 Agent 做了 Review，GitHub 仍需要知道：

- Review 对应哪个 PR 和 Head SHA；
- 使用了哪个策略版本；
- 是否通过；
- 新 Commit 到来后旧结果是否失效。

# 3. 产品愿景与原则

## 3.1 愿景

让每个代码仓库拥有一套可被人和 Agent 共同使用、可随代码演进、可在 Git 中 Review 的架构知识系统，同时不要求用户把私有代码交给平台。

## 3.2 产品原则

### 原则 A：Local-first

所有仓库内容处理默认在用户设备完成。MCP 使用本地 `stdio` 运行模式；MCP 官方架构区分本地 stdio Server 与远程 Streamable HTTP Server，本产品 MVP 选择前者以保持代码执行面在本地。[R1]

### 原则 B：Repository as Source of Truth

架构模型、ADR、策略和生成文档必须存放在仓库内，可随代码分支、Review、合并和回滚。

### 原则 C：Graph underneath, Tree as a View

文档可以展示为架构树，但底层模型必须支持多对多关系，例如调用、发布、订阅、读写、所有权和决策引用。

### 原则 D：Evidence before assertion

Agent 新增或修改架构结论时，必须关联源代码证据、配置证据或 ADR；没有证据的内容只能标为“待确认”。

### 原则 E：Suggest automatically, write deliberately

文件保存后自动更新 CodeGraph 和派生索引；架构文档默认生成建议，不在每次保存时自动改写。所有写入必须先显示 ChangeSet，再确认执行。

### 原则 F：Least privilege

GitHub App 不申请 Contents 权限。GitHub 官方建议 GitHub App 仅选择完成任务所需的最小权限。[R3]

### 原则 G：Simple, predictable pricing

公开仓库免费；个人开发者每月 5 美元即可使用全部私有仓库。用户无需估算仓库数量、Token 或 Review 次数。

### 原则 H：Progressive governance

架构治理的复杂度不能高于产品本身的复杂度。简单项目只维护最小模型，随代码增长（Level 0→3）才逐步引入域边界、公开接口、事件契约和强制 Gate。这更像数据库 Schema Evolution，而不是要求用户一次性完成架构设计。

### 原则 I：Invisible to non-experts

产品定位是"vibe coding 的软件工程层"：把软件工程方法嵌入 Agent 开发流程，让没有架构经验的开发者也能持续演进复杂产品。用户不需要理解 Architecture Node、Bounded Context、ADR 等术语；架构同步默认自动发生，只有必须由人决定时才介入，且用产品语言（责任、数据所有权、风险、可逆性）而非 YAML 提问。

# 4. 目标用户与场景

## 4.1 主要用户画像

### Persona A：开源维护者

- 维护一个或多个公开仓库；
- 希望贡献者和 Agent 快速理解架构；
- 需要自动检测架构文档漂移；
- 对免费、低安装门槛和跨 Agent 兼容性敏感。

### Persona B：个人私有项目开发者

- 使用个人或客户私有仓库；
- 同时使用多个 AI Coding Agent；
- 需要代码不进入额外 SaaS；
- 愿意为简单、固定且低价的私有仓库能力付费。

### Persona C：小团队中的个人开发者

- 对组织私有仓库有访问权限；
- 个人希望在本地获得架构上下文和 Review；
- 团队尚未采购集中治理平台；
- 接受订阅跟随个人，而不是一个账号解锁全团队。

### Persona D：仓库维护者 / Reviewer

- 需要判断 PR 是否改变服务边界、公开 API、事件或数据流；
- 希望 GitHub Check 与 Head SHA 绑定；
- 不希望平台读取仓库内容。

### Persona E：Vibe-coding 独立开发者（日益核心）

- 用 Agent 从零搭应用，缺少正式架构经验；
- 不想手工维护架构文档，也不知道何时该拆模块、加 ADR 或限制依赖；
- 需要系统自动保持长期一致性，并在关键处用产品语言提示决策；
- 核心诉求是"项目做大后仍然好改"，而不是"更容易写架构文档"。

## 4.2 Jobs to Be Done

1. 当我开始一个开发任务时，我希望 Agent 能快速给出相关服务、依赖、ADR 和证据，以减少重复探索。
2. 当我修改代码时，我希望索引自动保持最新，并知道哪些架构节点可能受影响。
3. 当架构发生变化时，我希望 Agent 生成可 Review 的文档 ChangeSet，而不是直接写入不可信内容。
4. 当我提交 PR 时，我希望本地 Review 能生成与 Head SHA 绑定的 GitHub Check。
5. 当我使用私有仓库时，我希望一次 5 美元/月订阅覆盖我所有私有仓库，而不需要逐仓库购买。
6. 当我停止订阅时，我希望数据仍留在本地，公开仓库能力继续可用，私有仓库写入与 Review 在付费期结束后停止。
7. 作为没有架构经验的开发者，我希望在不学习架构术语的前提下，系统能自动保持项目长期可维护，并只在关键决策处用我能懂的语言问我。

# 5. 产品目标与非目标

## 5.1 MVP 目标

- 在主流 MCP Agent 中通过本地 stdio 运行；
- 从 CodeGraph 获取文件、符号、调用、依赖与影响范围；
- 初始化并维护结构化架构模型；
- 生成架构树、组件目录、依赖图和漂移报告；
- 提供日常开发读取、分析、写入和 Review 工具；
- 公开仓库无需付费；
- 个人 Pro 5 美元/月覆盖全部私有仓库；
- GitHub App 在不读取 Contents 的情况下管理 PR Check；
- SaaS 仅处理身份、订阅、GitHub 元数据和签名证明；
- 新 PR Commit 自动使旧 Review 失效。

## 5.2 非目标

- 不替代编译器、LSP、静态安全分析器或 CodeGraph；
- 不提供云端代码搜索或云端向量数据库；
- 不自动 Merge、绕过 Branch Protection 或直接写 Main；
- 不在 MVP 建立跨仓库企业架构图；
- 不在 MVP 提供团队统一结算、SSO、SCIM、审计导出和可信 Runner；
- 不保证自动生成的架构说明无需人工 Review；
- 不保证用户选择的 Agent/模型不会处理 MCP 返回的上下文；
- 不支持 GitLab、Bitbucket 或 GitHub Enterprise Server；
- 不对“开源”进行许可证合规判定。

# 6. 产品范围与系统边界

## 6.1 MVP 支持范围

| 维度 | MVP 范围 |
|---|---|
| 代码托管 | GitHub.com |
| 仓库类型 | Git 仓库；公开、私有；个人与组织仓库 |
| MCP 传输 | 本地 stdio |
| 操作系统 | macOS、Linux、Windows |
| 架构模型 | YAML/JSON Schema + Markdown ADR |
| 本地数据库 | SQLite |
| 代码理解 | CodeGraph Adapter |
| 文档视图 | Markdown、Mermaid、JSON Graph |
| PR 集成 | GitHub App + Checks API |
| 付费 | Stripe 月度订阅 |
| 币种 | USD |

## 6.2 后续范围

- GitHub Enterprise Server；
- Remote MCP Account Server；
- 组织团队套餐与集中策略；
- 客户侧可信 Runner；
- 跨仓库服务图谱；
- 代码事实来源扩展（SCIP / Language Server）作为补充，而非替换 CodeGraph；
- Web 架构浏览器；
- IDE 原生插件；
- 组织级架构变更审批流。

# 7. 商业模式与权益规则

## 7.1 定价方案

| 方案 | 价格 | 适用范围 | 核心权益 |
|---|---:|---|---|
| Public | 0 美元 | 所有 GitHub 公开仓库 | 本地索引、架构读取/写入、漂移检测、本地 Review、GitHub Check |
| Individual Pro | 5 美元/月/人 | 该开发者可访问的全部 GitHub 私有仓库 | Public 全部能力 + 私有仓库能力，不限仓库数和本地调用量 |

Stripe 可用 Flat Rate Recurring Price 表达该单一月度订阅，不需要按仓库数量或用量计费。[R7]

## 7.2 计费单位

计费单位是**个人开发者账号**，不是仓库、组织、安装实例或设备。

```text
1 个付费开发者
= 5 美元/月
= 该开发者可访问的全部私有仓库
```

## 7.3 多人使用同一私有仓库

订阅不向仓库“赋权”，而向人赋权：

- Alice 订阅 Pro，可在她能访问的全部私有仓库使用；
- Bob 若也要在私有仓库使用，需要自己的 Pro；
- Alice 的订阅不能作为组织共享账号或授权 Bob；
- GitHub App 的安装不等于所有组织成员自动获得私有仓库权益。

## 7.4 仓库可见性判定

1. 计费规则以 GitHub `visibility` 为准；
2. `public`：免费；
3. `private`：需要有效 Individual Pro；
4. 本地无 GitHub Remote 或无法确认可见性：按 private 处理；
5. `public` 转 `private`：下一次私有操作触发权益检查；
6. `private` 转 `public`：立即恢复免费能力；
7. 不分析 LICENSE，也不区分 OSI Open Source 与 Source Available。

## 7.5 权益缓存与离线使用

- 公共仓库不依赖在线权益；
- Pro 登录后获取最长 7 天有效的签名 Entitlement；
- 设备在线时自动刷新；
- 暂时离线可继续使用至 Entitlement 到期；
- 付款失败进入 7 天宽限期，之后私有仓库仅允许读取现有架构文件，不允许重新索引代码、生成新内容或提交 Review；
- 取消订阅默认在当前计费周期末生效。Stripe 支持 `cancel_at_period_end` 的周期末取消方式。[R8]

## 7.6 设备与账号共享控制

MVP 默认每个账号最多注册 5 台活跃设备：

- 用户可在 Dashboard 自助撤销设备；
- 更换设备不额外收费；
- 同一设备的多个 Agent Host 共用本地 Runtime 身份；
- 不允许共享账号、转售或作为团队公共 Token；
- 设备上限是反滥用措施，不是按设备收费。

## 7.7 试用与退款

- MVP 不提供私有仓库免费试用；公开仓库即完整产品体验渠道；
- 用户首次订阅立即生效；
- 退款政策由服务条款定义，产品默认通过 Billing Portal 取消下个周期续费。

# 8. 总体架构

## 8.1 组件图

```text
┌──────────────────────── 用户本地环境 ────────────────────────┐
│                                                              │
│  MCP Host / Coding Agent                                     │
│            │ stdio                                           │
│            ▼                                                 │
│  Local Architecture MCP Runtime                              │
│   ├─ CodeGraph Adapter ── CodeGraph / Local Code DB          │
│   ├─ Architecture Engine ── YAML / Markdown / Policies       │
│   ├─ Architecture Store ── Local SQLite                      │
│   ├─ File Watcher / Incremental Index                        │
│   ├─ Git Adapter / Diff / SHA                                │
│   ├─ Review Engine                                           │
│   └─ OAuth Client / Device Key                               │
│                                                              │
└───────────────┬───────────────────────┬───────────────────────┘
                │ 最小化账户请求        │ Git push / 可选本地评论
                ▼                       ▼
       SaaS Control Plane          GitHub Repository
       OAuth / Billing             Code + Architecture Files
       Entitlement / Device                 ▲
       Attestation / GitHub App             │ Webhook / Check
                └───────────────────────────┘
```

## 8.2 职责分配

| 组件 | 负责 | 不负责 |
|---|---|---|
| Local MCP Runtime | 代码与架构读取、索引、文档写入、Review | 计费、GitHub App 私钥 |
| CodeGraph | AST、符号、调用、导入、影响查询 | 架构责任、ADR、业务边界 |
| Architecture Engine | 架构节点/边、策略、Evidence、文档生成 | 深层语言解析 |
| GitHub App | 安装、Webhook、PR Check | Clone 仓库、读取代码、运行模型 |
| SaaS | OAuth、订阅、权益、设备、Attestation、Check 更新 | 保存代码、Diff、架构图或本地索引 |
| GitHub Repository | 版本化代码和架构文件 | 本地派生数据库 |

## 8.3 CodeGraph 依赖假设

CodeGraph 是**必需依赖**（按 `peer-research2.md` 的修正，从早期"可替换 Provider"改为硬依赖）。其公开资料说明它能在本地用 Tree-sitter 建立 SQLite 代码图，并通过文件事件增量更新，再以公开 Node API 和 MCP 工具提供符号、调用和影响查询。[R6]

硬依赖、软耦合：精确锁定 npm 版本，只通过 `CodeFacts` Adapter 接口访问，禁止耦合其内部数据库表或实现，禁止 MCP 套 MCP，不向用户暴露其原始工具，升级 CodeGraph 时只改 Adapter。

# 9. 数据边界与隐私

## 9.1 永不发送至 SaaS 的数据

- 源代码与二进制文件；
- Git Diff 与 Patch；
- 文件路径、符号名和代码片段；
- CodeGraph 节点、边和查询结果；
- 架构节点、依赖边、ADR 正文和生成图；
- Embedding、向量、全文索引；
- Agent Prompt、模型输出和详细 Review Findings；
- 本地数据库文件；
- 环境变量、Secret、Git 凭据。

## 9.2 SaaS 可处理的最小数据

- SaaS User ID；
- GitHub User ID、Login、头像 URL；
- 订阅、支付状态和 Stripe Customer ID；
- 设备公钥、设备标签、最后活动时间；
- GitHub App Installation ID；
- Repository ID、Owner/Name、Visibility（GitHub App 操作所需元数据）；
- PR Number、Base SHA、Head SHA、Check Run ID；
- Policy Digest、Architecture Digest、Runtime Version；
- Review 结果、严重级别计数、时间戳和签名；
- 不含仓库内容的错误码与性能指标。

## 9.3 隐私表述规范

允许的营销表述：

> We never upload your repository content or derived code intelligence to our SaaS.

禁止的绝对表述：

> Your code never leaves your machine.

原因是用户选择的云端 Coding Agent 可能接收 MCP 返回的上下文；这一行为不由本产品控制。

## 9.4 日志与保留

- GitHub Webhook 原始 Body 仅在内存中验证和提取，不写应用日志；
- 使用 GitHub Delivery ID 去重；
- PR 最小元数据在 PR 关闭后保留 90 天；
- Attestation 保留 180 天；
- 账户与账单数据按支付、税务和法律要求保留；
- 用户删除账号后，非必要产品数据在 30 天内删除；
- 本地数据库与架构文件由用户自行管理，SaaS 无删除能力。

# 10. 核心用户流程

## 10.1 公开仓库首次使用

```text
用户安装 Local MCP
→ 在 Agent 中启用 Server
→ 打开公开 GitHub 仓库
→ Runtime 验证 public 可见性
→ 执行 architecture.init
→ CodeGraph 建立本地索引
→ 生成 .archcontext/ 初始结构
→ Agent 可查询、更新和 Review
```

验收结果：无需订阅和支付；本地功能完整可用。

## 10.2 私有仓库首次使用

```text
用户在私有仓库调用工具
→ Runtime 发现缺少有效 Pro Entitlement
→ 返回登录/订阅链接
→ 浏览器完成 SaaS OAuth 与 GitHub 身份绑定
→ 未订阅则进入 Stripe Checkout
→ SaaS 签发短期 Access Token 与 7 天 Entitlement
→ Runtime 存入 OS Keychain
→ 私有仓库全部功能解锁
```

本地 stdio MCP 不采用 HTTP MCP Server 的授权协议；Runtime 自身作为 OAuth Public Client，通过浏览器 Authorization Code + PKCE 登录 SaaS。MCP 规范也指出 stdio Transport 不应套用 HTTP MCP Authorization，而应从本地环境获取凭据。[R2]

## 10.3 日常开发

```text
Agent 接收开发任务
→ architecture.context 返回相关节点、ADR、Policy 和 Evidence
→ 用户/Agent 修改代码
→ File Watcher 增量更新 CodeGraph 与本地索引
→ architecture.impact 计算受影响架构节点
→ architecture.plan_update 生成 ChangeSet 和 Diff
→ 用户确认
→ architecture.apply_changeset 事务写入模型与文档
→ architecture.validate 与 architecture.review
→ 代码和架构文件一起 Commit
```

## 10.4 Pull Request Review

```text
PR opened / synchronize
→ GitHub App 收到 Webhook
→ SaaS 创建 Pending Check，绑定 Head SHA
→ 开发者在 PR 对应本地 Checkout 执行 architecture.review_pr
→ Runtime 验证本地 HEAD 与 PR Head SHA 一致
→ 本地执行 Drift / Policy / Evidence Review
→ 生成签名 Attestation，仅上传结果和 Digest
→ SaaS 验证订阅、设备、签名和 SHA
→ GitHub App 更新 Check Run
→ 新 Commit 到来后旧 Check 自动失效
```

GitHub Checks API 可将 Check 绑定到指定 Commit；写入 Checks 需要相应的 GitHub App Checks 权限。[R4]

## 10.5 详细 Review 结果发布

默认：

- 详细 Findings 只在本地显示；
- SaaS Check 显示 Pass/Fail、计数、Runtime 版本和策略摘要；
- 不显示文件路径、代码摘录和架构详情。

可选“发布到 GitHub”模式：

- Local Runtime 使用用户本机已有的 `gh`/GitHub 凭据直接发布 PR Comment 或 Review；
- 内容从本地直接发到 GitHub，不经过 SaaS；
- 发布前必须显示预览并获得确认。

# 11. 功能需求

优先级：P0 = MVP 必须；P1 = Beta 需要；P2 = 后续增强。

## 11.1 安装、登录与权益

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-A01 | P0 | 提供跨平台 Local MCP 安装方式 | macOS/Linux/Windows 可启动 stdio Server，`doctor` 能验证依赖 |
| FR-A02 | P0 | 支持 Agent Host 自动/手工配置 | 至少为 3 类主流 MCP Host 提供配置文档与示例 |
| FR-A03 | P0 | 公共仓库无需登录即可使用 | 未登录状态可完成 init、index、query、write、review |
| FR-A04 | P0 | 私有仓库触发 OAuth 登录 | 浏览器 PKCE 流程完成后凭据保存在 OS Keychain，不写明文配置 |
| FR-A05 | P0 | 5 美元/月 Pro 解锁全部私有仓库 | 有效订阅用户切换不同私有仓库时不产生新增购买或仓库计数 |
| FR-A06 | P0 | 权益离线缓存 | 有效用户断网 7 天内仍可使用私有功能；过期后给出明确状态 |
| FR-A07 | P1 | 设备管理 | Dashboard 可查看、命名和撤销最多 5 台设备 |
| FR-A08 | P0 | 取消与付款失败处理 | 周期末取消；失败后宽限期；状态变化在下次刷新时生效 |

## 11.2 Repository 初始化与索引

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-R01 | P0 | 自动识别 Git 根目录和 Worktree | 在普通 Clone、子目录启动和 Git Worktree 中定位正确 Root |
| FR-R02 | P0 | 判断仓库可见性 | public 免费；private/未知需要 Pro；判定不依赖向 SaaS 上传仓库内容 |
| FR-R03 | P0 | 初始化架构目录 | 创建 Schema、Model、ADR、Policy、Generated、Manifest，不覆盖已有文件 |
| FR-R04 | P0 | CodeGraph Provider 健康检查 | 显示版本、支持语言、索引状态；不可用时进入降级模式 |
| FR-R05 | P0 | 初始索引 | 忽略 Git ignore、二进制、Vendor、Build 输出；进度可见且可取消 |
| FR-R06 | P0 | 增量更新 | 文件保存后自动更新受影响的代码图和派生索引 |
| FR-R07 | P0 | 可重建 | 删除本地 DB 后可从代码和架构文件完整重建，不丢声明式数据 |
| FR-R08 | P1 | Monorepo Scope | 可为 Workspace/Package 配置边界，避免每次扫描整个 Monorepo |

## 11.3 架构读取与上下文

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-Q01 | P0 | 查询架构概览 | 返回域、系统、服务、组件、接口、数据存储和状态 |
| FR-Q02 | P0 | 任务上下文组装 | 根据任务文本返回相关节点、依赖、ADR、Policy 和 Source Evidence |
| FR-Q03 | P0 | 依赖与影响查询 | 支持上游、下游、调用、发布/订阅、读/写、所有权关系 |
| FR-Q04 | P0 | Evidence 定位 | 每个结论可返回本地路径、Symbol 和行范围；不要求传到 SaaS |
| FR-Q05 | P0 | Commit-aware Snapshot | 查询结果标注当前 Git SHA、Dirty 状态和索引时间 |
| FR-Q06 | P1 | MCP Resources | 提供稳定 URI 读取摘要、节点、ADR 和最新 Review |

## 11.4 架构写入与文档生成

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-W01 | P0 | 两阶段写入 | `plan_update` 返回 ChangeSet/Diff；`apply` 必须引用未过期 ChangeSet ID |
| FR-W02 | P0 | Schema Validation | 任何无效节点、边或字段都不得写入磁盘 |
| FR-W03 | P0 | Evidence Requirement | 新增架构事实至少包含一条 Evidence，或明确标记 `needs_confirmation` |
| FR-W04 | P0 | 事务写入 | 多文件修改要么全部成功，要么全部回滚 |
| FR-W05 | P0 | 并发保护 | 文件在预览后被外部修改时，拒绝应用并要求重新生成 |
| FR-W06 | P0 | 确定性渲染 | 相同模型和生成器版本产生稳定排序和最小 Diff |
| FR-W07 | P0 | ADR 草稿 | 高风险变化可创建 Draft ADR；不得自动标记 Accepted |
| FR-W08 | P1 | 自动草稿模式 | 文件保存后可生成未应用建议，但默认关闭自动写盘 |
| FR-W09 | P0 | 安全撤销 | 保存 ChangeSet 元数据，可撤销最近一次由工具执行的架构修改 |

## 11.5 Drift、Policy 与 Review

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-V01 | P0 | 检测文档漂移 | 发现代码接口/依赖变化但模型未更新时给出 Finding |
| FR-V02 | P0 | 检测无证据事实 | Evidence 路径、Symbol 不存在或范围失效时标记 |
| FR-V03 | P0 | 依赖政策 | 支持 Allow/Deny、层级方向、跨域依赖和循环依赖规则 |
| FR-V04 | P0 | 风险分级 | Findings 至少分 Info/Warning/Error；Policy 可配置失败阈值 |
| FR-V05 | P0 | Review 对应 Git Diff | 支持 Working Tree、Staged、Commit Range 和 PR Base..Head |
| FR-V06 | P0 | Review 可复现 | 结果包含 Runtime、Provider、Schema、Policy 和 SHA 版本 |
| FR-V07 | P1 | Baseline | 可接受已知历史问题，只阻断新增问题 |
| FR-V08 | P1 | Review 报告 | 可在本地输出 Markdown/JSON；默认不自动提交到 Git |

## 11.6 GitHub App 与 PR Check

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-G01 | P0 | Public GitHub App | 任意 GitHub.com 用户可安装到个人或组织账号 |
| FR-G02 | P0 | 最小权限 | Metadata Read、Pull Requests Read、Checks Write；无 Contents 权限 |
| FR-G03 | P0 | Repository 选择 | 安装者可选择全部或指定仓库；GitHub 支持安装后调整仓库访问范围。[R5] |
| FR-G04 | P0 | Webhook 验证 | 校验签名、时间窗口与 Delivery ID；重复事件幂等 |
| FR-G05 | P0 | PR Pending Check | opened/reopened/synchronize 后为 Head SHA 创建或重置 Check |
| FR-G06 | P0 | Attestation 提交 | 仅在用户、设备、订阅、仓库访问和 SHA 全部有效时接受 |
| FR-G07 | P0 | Stale 防护 | Attestation Head SHA 不等于当前 PR Head 时拒绝并保留 Pending |
| FR-G08 | P0 | Check 结论 | Pass→success；阻断 Finding→failure；工具错误→action_required |
| FR-G09 | P1 | Re-run | GitHub Rerequest 或本地命令可创建新 Review Attempt |
| FR-G10 | P1 | 本地直发详情 | 用户确认后可用本机 GitHub 凭据发布详细 Review，不经过 SaaS |

## 11.7 SaaS Dashboard 与计费

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-S01 | P0 | GitHub 身份登录 | 一个 SaaS 账号绑定一个主要 GitHub User ID |
| FR-S02 | P0 | 订阅页 | 显示 Free/Pro、5 美元价格、状态、续费日期和管理入口 |
| FR-S03 | P0 | Stripe Checkout/Portal | 可购买、更新支付方式、查看发票、取消订阅 |
| FR-S04 | P0 | GitHub 安装列表 | 显示安装账号、仓库数量和权限，不显示代码或架构内容 |
| FR-S05 | P0 | PR Check 状态 | 显示最小元数据、当前 SHA、状态与最近 Attestation |
| FR-S06 | P1 | 隐私中心 | 显示平台保存的数据类别、下载/删除账号入口 |
| FR-S07 | P0 | Webhook 计费同步 | Stripe 事件幂等更新 Entitlement，避免客户端自行声明付费状态 |

## 11.8 工程治理与决策自动化

| ID | 优先级 | 需求 | 验收标准 |
|---|---|---|---|
| FR-E01 | P0 | 渐进式建模 | 最小合法模型（product + 一个 module）即可启动；随代码增长按需建议升级，不强制一次性完整建模 |
| FR-E02 | P0 | 变更分类 | 每次架构相关变化归入 auto-accept / auto-sync / ask-user / block 之一，分类规则可配置 |
| FR-E03 | P0 | 非专家 Human Gate | 需要用户决定时用产品语言（责任、数据所有权、风险、可逆性）提问并给出推荐选项，不展示原始 YAML |
| FR-E04 | P1 | 决策记忆 | 用户在 Gate 处的选择被记录为可复用决策，后续任务和新 Session 自动沿用 |
| FR-E05 | P0 | 默认隐形 | 常规开发中架构同步自动发生，仅在 ask-user/block 时打断用户 |

# 12. Local MCP Runtime 设计

## 12.1 MCP 工具集合

**薄 MCP 原则**：默认只向 Agent 暴露 5 个 `archcontext_*` 工具，避免工具过多导致选择成本和上下文浪费。CodeGraph 的原始工具在 Adapter 之后，不对 Agent 暴露。

```text
archcontext_context        # 为任务组装最小相关上下文
archcontext_impact         # 计算受影响架构节点
archcontext_plan_update    # 生成 ChangeSet/Diff，不写盘
archcontext_apply_update   # 确认后事务应用
archcontext_review         # 本地 Review（含 PR 绑定）
```

下列各表是 Runtime 的完整能力面，主要以 **CLI 子命令**或**非默认/opt-in 工具**形式提供，并通过 MCP Resources 读取单个对象；它们不计入默认 5 个 MCP 工具。

### 读取工具

| Tool | 用途 |
|---|---|
| `architecture_status` | 仓库、索引、Schema、Git 和权益状态 |
| `architecture_context` | 为开发任务组装最小相关上下文 |
| `architecture_search` | 搜索节点、ADR、接口、数据存储和文档 |
| `architecture_get_node` | 获取单一节点及 Evidence |
| `architecture_dependencies` | 查询上下游和关系路径 |
| `architecture_decisions` | 搜索和读取 ADR |
| `architecture_diff` | 对比两个架构 Snapshot |

### 分析工具

| Tool | 用途 |
|---|---|
| `architecture_impact` | 根据文件、Symbol、Git Diff 计算影响范围 |
| `architecture_detect_drift` | 对比代码图与声明式模型 |
| `architecture_validate` | Schema、链接、Evidence 和 Policy 校验 |
| `architecture_review` | 对 Working Tree/Range 执行本地 Review |
| `architecture_review_pr` | 绑定 PR 与 Head SHA，生成 Attestation |

### 写入工具

| Tool | 用途 |
|---|---|
| `architecture_plan_update` | 创建 ChangeSet 和文件 Diff，不写盘 |
| `architecture_apply_changeset` | 确认后事务应用 |
| `architecture_create_adr` | 创建 Draft ADR |
| `architecture_render_docs` | 从模型生成确定性文档 |
| `architecture_revert_changeset` | 撤销工具最近一次写入 |

### 账户工具

| Tool | 用途 |
|---|---|
| `account_status` | 登录、方案、权益到期和设备状态 |
| `account_login` | 启动浏览器 OAuth |
| `account_logout` | 清除本地 Token 和 Entitlement |
| `account_manage_subscription` | 打开 Billing Portal |

## 12.2 MCP Resources

```text
architecture://repo/summary
architecture://repo/tree
architecture://node/{node_id}
architecture://decisions
architecture://policies
architecture://review/latest
architecture://changeset/{changeset_id}
```

## 12.3 双阶段写入协议

`architecture_plan_update` 返回：

```json
{
  "changeset_id": "cs_01J...",
  "base_tree_hash": "sha256:...",
  "expires_at": "2026-06-19T15:10:00Z",
  "files": [
    {
      "path": ".archcontext/model/nodes/service-order.yaml",
      "operation": "modify",
      "diff": "..."
    }
  ],
  "validation": {
    "schema": "pass",
    "policy": "pass",
    "evidence": "warning"
  }
}
```

`architecture_apply_changeset` 必须验证：

- ChangeSet 未过期；
- Repository Root 未变化；
- 当前文件 Hash 与计划时一致；
- 写入路径处于 Allowlist；
- 用户/Host 已确认；
- 私有仓库权益有效；
- Schema 和阻断 Policy 通过。

## 12.4 降级模式

当 CodeGraph 不可用时：

- 可读取已有架构文件和 ADR；
- 可执行 Schema、链接和文档渲染；
- 禁止声称完成代码影响分析；
- `impact` 和 `drift` 返回 `degraded`，明确缺失能力；
- 不自动切换到向 SaaS 上传代码的替代方案。

# 13. 架构模型、文档与数据库

## 13.1 Repository 目录结构

```text
repository/
├── AGENTS.md
├── .archcontext/
│   ├── manifest.yaml
│   ├── model/
│   │   ├── nodes/
│   │   │   ├── domains/
│   │   │   ├── systems/
│   │   │   ├── services/
│   │   │   ├── components/
│   │   │   ├── interfaces/
│   │   │   └── data-stores/
│   │   ├── edges.yaml
│   │   └── ownership.yaml
│   ├── decisions/
│   │   └── ADR-0001-*.md
│   ├── policies/
│   │   ├── dependencies.yaml
│   │   ├── evidence.yaml
│   │   └── review.yaml
│   ├── generated/
│   │   ├── ARCHITECTURE.md
│   │   ├── TREE.md
│   │   ├── COMPONENTS.md
│   │   ├── DEPENDENCIES.md
│   │   ├── dependencies.mmd
│   │   └── drift-report.md
│   └── schemas/
│       ├── node.schema.json
│       ├── edge.schema.json
│       └── policy.schema.json
└── .gitignore
```

## 13.2 Source of Truth 分层

| 层 | 角色 | 是否提交 Git |
|---|---|---:|
| Source Code | 实现事实 | 是 |
| `.archcontext/model` | 声明式架构事实 | 是 |
| `.archcontext/decisions` | 决策与原因 | 是 |
| `.archcontext/policies` | 约束与 Review 规则 | 是 |
| `.archcontext/generated` | 可读视图，可重建 | 是 |
| Local Architecture DB | 查询、快照、缓存、Review 历史 | 否 |
| SaaS DB | 身份、计费、最小 PR 元数据、Attestation | 不含仓库内容 |

## 13.3 节点模型

```yaml
id: service.order-management
kind: service
name: Order Management
status: active
criticality: high

parent: system.commerce-platform
owner:
  team: commerce-platform

source:
  include:
    - services/order/**
  exclude:
    - services/order/tests/**

interfaces:
  provides:
    - api.order.v1
    - event.order-created.v1
  consumes:
    - api.payment.v1

data:
  reads:
    - datastore.order-db
  writes:
    - datastore.order-db

evidence:
  - path: services/order/src/api/order-controller.ts
    symbol: OrderController
    type: implementation

last_verified_sha: abc123
```

## 13.4 边模型

核心关系：

```text
contains
implements
calls
depends_on
publishes
subscribes
reads
writes
owned_by
decided_by
governed_by
```

每条边至少包含：

- 稳定 ID；
- Source Node；
- Target Node；
- Relation Type；
- 可选 Direction/Protocol；
- Evidence；
- Status；
- Last Verified SHA。

## 13.5 本地 SQLite

建议表：

```text
repositories
codegraph_snapshots
architecture_nodes
architecture_edges
source_evidence
document_snapshots
commit_snapshots
index_chunks
policy_results
review_runs
review_findings
changesets
```

DB 必须满足：

- WAL 模式；
- 迁移版本化；
- 每个 Repository 独立 Namespace；
- 不提交 Git；
- 内容 Hash 去重；
- 删除文件产生 Tombstone；
- 可通过 `architecture rebuild` 重建。

# 14. Review 模型

## 14.1 Review 类型

1. **Schema Review**：模型与 Policy 格式是否合法；
2. **Evidence Review**：声明是否有存在且可定位的证据；
3. **Drift Review**：代码图变化是否未反映到模型；
4. **Dependency Review**：是否违反层级、域边界或循环规则；
5. **Interface Review**：公开 API、事件和数据契约是否改变；
6. **Documentation Review**：Generated Views 是否与模型一致；
7. **ADR Review**：高风险变化是否需要新 ADR；
8. **Freshness Review**：索引、文档和 Review 是否对应当前 SHA。

## 14.2 风险分级

| 风险 | 示例 | 默认处理 |
|---|---|---|
| Low | 内部重构、私有 Symbol 移动 | Warning，可通过 |
| Medium | 新内部依赖、组件责任变化 | 需要更新模型；未更新则失败 |
| High | 公共 API 破坏、数据所有权变化、认证授权变化、跨域依赖 | 必须更新模型并创建/更新 ADR |
| Critical | 绕过策略、无法验证 Evidence、Review SHA 不匹配 | Check 失败 |

## 14.3 Finding 结构

```json
{
  "rule_id": "ARCH-DEP-001",
  "severity": "error",
  "category": "dependency-policy",
  "message": "Domain A 不允许直接依赖 Domain B 的数据库",
  "evidence": [
    {
      "path": "services/a/src/repository.ts",
      "symbol": "BDatabaseClient"
    }
  ],
  "suggested_action": "改为调用 api.b.v1，或更新 ADR 并申请例外"
}
```

上述完整内容只在本地存在。提交给 SaaS 的 Attestation 仅包含规则结果摘要与计数。

## 14.4 变更分类与自动化边界

Review 与 ChangeSet 的判定核心是把每次代码变化归入四条处理通道（对应 14.2 的风险分级）：

| 通道 | 触发 | 处理 |
|---|---|---|
| auto-accept | 文件移动但责任未变、内部重构、私有实现依赖变化、已有接口实现更新 | 不打扰用户，仅更新索引 |
| auto-sync | 新增明确属于现有模块的组件、模块内新增数据实体、符合既有规则的外部 API Client | 自动生成并应用模型 ChangeSet |
| ask-user | 业务责任跨模块转移、新核心领域出现、公开接口破坏性变化、数据所有权变化、引入重要第三方依赖 | 用产品语言提问，等待确认 |
| block | 绕过权限边界、模块直接访问他人数据、违反安全约束、高风险冲突未解决、架构状态与代码无法对齐 | Review 失败，Check 阻断 |

这条边界比架构文件格式更重要，是产品的核心难点与护城河。

# 15. GitHub App 需求

## 15.1 权限

```text
Repository Permissions
- Metadata: Read
- Pull requests: Read
- Checks: Read & Write
- Contents: No access
```

GitHub App 安装者可以选择全部或指定仓库，并可在安装后修改访问范围。[R5]

## 15.2 Webhook

订阅：

```text
installation
installation_repositories
pull_request
check_run (rerequested)
```

处理的 Pull Request Actions：

```text
opened
reopened
synchronize
closed
```

## 15.3 Check 状态机

```text
created
  → pending_local_review
  → attestation_received
      → success
      → failure
      → action_required

任何新的 head_sha
  → superseded
  → 创建新的 pending_local_review
```

## 15.4 Check 展示内容

允许：

- “Architecture Review passed/failed”；
- Head SHA；
- Review 时间；
- Runtime/Policy 版本；
- Error/Warning 数量；
- “详细结果保存在本地”提示；
- 本地执行命令。

禁止：

- 文件路径；
- Symbol 名；
- 代码片段；
- 架构节点名和依赖关系；
- ADR 内容；
- 模型 Prompt/Response。

# 16. SaaS Control Plane

## 16.1 服务模块

```text
Auth Service
Entitlement Service
Billing Service
Device Registry
GitHub App Gateway
Webhook Processor
PR Check Service
Attestation Verifier
User Dashboard
Audit/Security Event Service
```

## 16.2 OAuth

Local Runtime 是无 Client Secret 的 Public Client：

- Authorization Code + PKCE；
- 浏览器登录；
- HTTPS 或 localhost Loopback Redirect；
- 短期 Access Token；
- Refresh Token Rotation；
- Token Audience 绑定到 SaaS API；
- Token 存储在 OS Keychain；
- 不把 GitHub Token 透传给 Runtime。

如果未来提供 Remote MCP，则应遵循 MCP HTTP Authorization 规范中的资源服务器发现、PKCE、Resource Indicator 和 Audience Validation。[R2]

## 16.3 核心 API

```text
GET  /.well-known/oauth-authorization-server
GET  /oauth/authorize
POST /oauth/token
POST /oauth/revoke

GET  /v1/me
GET  /v1/entitlement
GET  /v1/devices
POST /v1/devices/register
DELETE /v1/devices/{id}

POST /v1/attestations
GET  /v1/review-jobs/current

POST /github/webhooks
GET  /v1/github/installations

POST /v1/billing/checkout-session
POST /v1/billing/portal-session
POST /stripe/webhooks
```

## 16.4 Attestation

```json
{
  "version": 1,
  "user_id": "usr_123",
  "github_user_id": 123456,
  "device_key_id": "devkey_789",
  "github_repository_id": 987654,
  "pull_request": 42,
  "base_sha": "abc123",
  "head_sha": "def456",
  "architecture_digest": "sha256:...",
  "policy_digest": "sha256:...",
  "runtime_version": "1.0.0",
  "provider_version": "codegraph-x.y.z",
  "result": "pass",
  "counts": {
    "error": 0,
    "warning": 2,
    "info": 4
  },
  "started_at": "2026-06-19T15:00:00Z",
  "completed_at": "2026-06-19T15:00:12Z",
  "nonce": "...",
  "signature": "..."
}
```

验证条件：

- 用户 Token 有效；
- 设备未撤销；
- 设备签名有效；
- Nonce 未使用；
- 时间窗口有效；
- PR 当前 Head SHA 一致；
- 私有仓库用户 Pro 有效；
- 用户对仓库具有 GitHub 访问权限；
- Runtime/Schema/Policy 版本满足最低要求。

# 17. 非功能需求

## 17.1 性能

| 指标 | MVP 目标 |
|---|---:|
| MCP Server 冷启动 | P95 < 3 秒，不含首次 CodeGraph 索引 |
| 架构读取查询 | P95 < 1 秒 |
| 关系/影响查询 | P95 < 3 秒 |
| 文件保存到索引可查询 | P95 < 5 秒 |
| 文档 ChangeSet 预览 | P95 < 10 秒，不含模型推理时间 |
| 10,000 文件初始架构派生索引 | < 5 分钟，CodeGraph 时间单独显示 |
| 本地 DB 重建 | 可中断、可恢复、显示进度 |
| Attestation 到 Check 更新 | P95 < 10 秒 |

## 17.2 可靠性

- SaaS 月可用性目标 99.9%；
- SaaS 不可用时，公共仓库和仍在离线 Entitlement 期内的私有仓库继续本地工作；
- 本地写入使用临时文件 + fsync + 原子 Rename；
- Webhook、Stripe Event、Attestation 必须幂等；
- Check 更新失败可重试且不会重复创建无穷 Check；
- 数据库损坏时可安全重建。

## 17.3 兼容性

- Git Worktree；
- Monorepo；
- Submodule 只作为独立 Root 处理；
- Case-sensitive/insensitive 文件系统；
- Unicode 文件名；
- Windows 长路径；
- 代理服务器和企业 TLS；
- Agent Host 不支持 MCP Elicitation 时，仍可用两阶段 Tool 调用确认。

## 17.4 可观测性

允许上报：

- Runtime 版本、OS、CPU 架构；
- 工具调用名称和耗时桶；
- 成功/失败错误码；
- Entitlement 刷新状态；
- 不含内容的 Index 数量级。

禁止上报：

- Repository 名称、路径、文件名；
- 查询文本；
- Tool 参数和返回内容；
- 架构节点、代码或 Review 详情。

非必要遥测默认关闭；鉴权、计费和安全事件不属于可选遥测。

# 18. 安全与威胁模型

## 18.1 主要威胁

| 威胁 | 示例 | 控制 |
|---|---|---|
| 代码外泄 | 日志记录 Tool 参数 | 全链路 Redaction、内容禁止入 SaaS |
| 路径逃逸 | `../../`、Symlink 指向 Root 外 | Canonical Path、Root Allowlist、拒绝外部 Symlink |
| Prompt Injection | 仓库文档诱导 Agent 泄露 Secret | 仓库内容视为不可信数据，工具不暴露环境 Secret |
| 任意命令执行 | MCP Tool 拼接 Shell | 不提供通用 Shell；参数化进程调用；命令 Allowlist |
| Token 窃取 | 明文保存 Refresh Token | OS Keychain、短期 Token、Refresh Rotation |
| Webhook 重放 | 重复 GitHub Delivery | HMAC 验证、Delivery ID 幂等、时间窗口 |
| Attestation 伪造 | 修改客户端结果 | 设备密钥签名、Nonce、版本和 SHA 验证 |
| Stale Review | 新 Commit 沿用旧 Pass | Check 与 Head SHA 强绑定 |
| 账号共享 | 多人共用一份 Pro | GitHub 身份、设备注册、异常并发检测 |
| 客户端篡改 | 修改开源/本地二进制绕过 Review | 明确信任等级；个人模式是 Developer Attestation，不宣称独立 CI |

## 18.2 信任声明

个人本地设备由用户控制，因此本地 Attestation 证明的是：

> 某个已注册设备上的客户端声明，它对指定 SHA 执行了指定版本的 Review。

它不能证明设备、二进制或工作区未被用户篡改。强制、不可绕过的组织治理需要未来的客户控制 Trusted Runner 产品。

# 19. 数据模型

## 19.1 SaaS 主要实体

```text
users
- id
- github_user_id
- github_login
- status
- created_at

subscriptions
- user_id
- stripe_customer_id
- stripe_subscription_id
- plan
- status
- current_period_end

entitlements
- user_id
- feature_set
- issued_at
- expires_at
- signature_version

devices
- id
- user_id
- public_key
- label
- status
- last_seen_at

github_installations
- installation_id
- account_id
- account_type
- status

repositories
- github_repository_id
- installation_id
- owner
- name
- visibility
- active

pull_request_checks
- repository_id
- pr_number
- head_sha
- check_run_id
- status

attestations
- id
- user_id
- device_id
- repository_id
- pr_number
- head_sha
- result
- digests
- signature
- completed_at
```

## 19.2 数据隔离

- 用户只可访问自己的账户、设备和订阅；
- Installation 访问受 GitHub Account/Organization 权限控制；
- Attestation 更新 Check 前需验证用户与 Repository 的关系；
- SaaS 管理员后台不得显示 Repository 内容，因为系统不保存这些内容；
- Repository Owner/Name 在数据库中加密或字段级保护；
- 支付卡信息不进入产品数据库，由支付服务商处理。

# 20. UX 与产品文案

## 20.1 首页主文案

**Build beyond the prototype.** — The software-engineering layer for vibe coding.

ArchContext gives coding agents the software-engineering context needed to grow a simple app into a maintainable product. *Your code stays local. Your architecture stays current.*

Public repositories are free. Private repositories are $5/month for one developer, with unlimited private repos. Your repository content and derived code intelligence are processed locally and never uploaded to our SaaS.

（备选副标题：Architecture context for every coding agent.）

## 20.2 私有仓库 Paywall

```text
This repository is private.

Individual Pro costs $5/month and covers every private repository you can access.
No per-repo fees. No token billing.

[Sign in] [Subscribe] [Learn about privacy]
```

## 20.3 Check Pending 文案

```text
Architecture Review is waiting for a local attestation.

Run in a checkout of this PR:
  arch review-pr 42

No repository content is sent to the SaaS.
```

## 20.4 过期权益

```text
Your offline entitlement expired.
Existing architecture files remain available.
Reconnect to refresh your subscription status, or switch to a public repository.
```

# 21. 成功指标

## 21.1 North Star

**Weekly Active Developers completing at least one architecture context, update, or review action.**

## 21.2 激活指标

- 安装后 10 分钟内完成首次 `architecture_context` 的比例；
- 完成 `architecture_init` 的仓库比例；
- 首周至少执行一次 ChangeSet 的用户比例；
- GitHub App 安装后成功提交一次 Attestation 的比例。

## 21.3 质量指标

- ChangeSet Schema 失败率；
- Apply 后回滚率；
- Review 误报被用户标记的比例；
- Evidence 无效比例；
- Stale Attestation 接受数必须为 0；
- 发生仓库内容进入 SaaS 日志的事件必须为 0。

## 21.4 商业指标

- Public 活跃用户到 Pro 转化率；
- Pro 月度留存；
- 付款失败恢复率；
- 每名付费用户支持工单量；
- 5 美元方案的支付手续费和支持成本占比。

## 21.5 MVP 发布目标

| 指标 | 目标 |
|---|---:|
| 首次价值时间 | 中位数 < 10 分钟 |
| Public 首周激活率 | ≥ 35% |
| Private Paywall 到订阅转化 | ≥ 8% |
| Pro 第 2 月留存 | ≥ 70% |
| PR Attestation 成功率 | ≥ 95% |
| 内容泄漏安全事件 | 0 |

上述目标是发布假设，用于迭代，不是对外 SLA。

## 21.6 工程有效性指标（vibe-coding 定位）

除上述指标外，追踪产品是否真正"维持长期可维护性"：

- 首次任务上下文准备成功率；
- 无需用户参与即完成的架构同步比例；
- 后续任务复用历史决策的比例；
- 架构问题在 Commit 前被发现的比例；
- Repository 增长时任务完成时间是否保持稳定；
- 用户需要回答的技术问题数量；
- 错误架构上下文导致的回滚率。

最强验证：非专业开发者维护同一项目六个月后，新的 Agent Session 仍能快速、正确地修改系统，而不是重新理解或继续堆积混乱。

# 22. MVP 里程碑

## M0：技术验证

- 一个 Local MCP Server；
- CodeGraph Adapter；
- 读取现有架构文件；
- SQLite 本地索引；
- `context`、`impact`、`status` 三个 Tool；
- 网络抓包证明无仓库内容进入 SaaS。

退出条件：在 3 个真实仓库上完成端到端查询。

## M1：Local Architecture Core

- `architecture init`；
- Node/Edge Schema；
- ChangeSet 两阶段写入；
- Generated Docs；
- Drift/Policy Review；
- Public 仓库完整免费体验。

退出条件：开发任务可在本地完成“查询—修改—更新文档—Review”。

## M2：Identity 与 Billing

- GitHub 登录；
- PKCE；
- Stripe 5 美元月度订阅；
- Entitlement 与离线缓存；
- 设备注册；
- Dashboard。

退出条件：一个订阅可跨多个私有仓库工作，不产生仓库计数。

## M3：GitHub App 与 PR Check

- App 安装；
- Webhook；
- Pending Check；
- Signed Attestation；
- Head SHA 校验；
- Check Pass/Fail。

退出条件：新 Commit 会使旧结果失效，SaaS 不接收详细 Findings。

## M4：Beta Hardening

- Windows；
- Worktree/Monorepo；
- 网络代理；
- 安全审计；
- 隐私测试；
- 文档和示例仓库；
- 支付失败与删除账号流程。

# 23. 发布验收标准

## 23.1 产品验收

- [ ] 公开仓库未登录即可使用全部本地核心功能；
- [ ] 付费用户能在至少 20 个不同私有仓库切换使用，账单仍为单一 5 美元月费；
- [ ] 第二名开发者不能使用第一名用户的权益，除非共享账号或设备密钥；
- [ ] 私有仓库内容不出现在 SaaS 请求、日志、数据库或错误追踪中；
- [ ] Local DB 删除后可完整重建；
- [ ] 文档写入必须有可见 Diff 和确认；
- [ ] 无 Evidence 的架构事实被标记或阻断；
- [ ] GitHub App 无 Contents 权限；
- [ ] PR Check 与 Head SHA 一致；
- [ ] Stale Attestation 被拒绝；
- [ ] 取消订阅后在周期末撤销私有写入/Review 权益；
- [ ] 公共仓库能力不受取消影响。

## 23.2 隐私验收

使用代理抓包和日志扫描执行以下测试：

- [ ] 索引 1 GB 私有仓库时，SaaS 流量中无路径、文件名、代码和架构正文；
- [ ] 运行 `context`、`impact`、`review` 时，SaaS 仅接收授权或 Attestation 请求；
- [ ] 故意触发崩溃时，Crash Report 不含 Tool 参数和本地路径；
- [ ] GitHub Webhook 原始 Payload 不被持久化；
- [ ] 详细 Review 发布到 GitHub 时，流量从本地直达 GitHub，不经过 SaaS。

## 23.3 安全验收

- [ ] Symlink/Traversal 无法读写 Root 外文件；
- [ ] Repository 中的恶意 Prompt 无法读取环境 Secret；
- [ ] OAuth 使用 PKCE，Refresh Token 轮换；
- [ ] Webhook 签名、重放和幂等测试通过；
- [ ] 设备撤销后 Attestation 立即失效；
- [ ] Nonce 重放被拒绝；
- [ ] 低版本或被禁 Runtime 无法提交有效 Attestation；
- [ ] Git SHA 不一致时 Check 不会成功。

# 24. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自动架构更新质量不稳定 | 用户不信任文档 | Evidence、ChangeSet、默认不自动写盘、独立 Review |
| CodeGraph Provider 变化 | 核心能力被单一项目绑架 | Adapter、Capability Negotiation、降级模式 |
| 本地客户端可被修改 | PR Check 可被伪造 | 明确信任等级；签名与版本控制；未来 Trusted Runner |
| 5 美元账号被团队共享 | 收入损失 | GitHub 身份、设备限制、并发异常；保持低摩擦 |
| 用户误解“本地” | 云端 Agent 仍处理上下文 | 清晰数据边界与隐私文案；提供上下文最小化 |
| GitHub App 无 Contents 权限 | 无法云端独立复核 | 产品设计即本地 Attestation；不伪装为云 CI |
| PR Check 长期 Pending | 合并体验受阻 | 清晰命令、Rerequest、可配置超时和非阻断模式 |
| Monorepo 索引慢 | 首次价值时间变长 | Scope、增量、缓存、进度、可取消 |
| 架构文件 Merge Conflict | 协作成本 | 稳定排序、小文件拆分、稳定 ID、最小 Diff |
| 支付系统故障 | 私有功能误锁 | 7 天 Entitlement、宽限期、Webhook 重试 |

# 25. 发布前待确认项及建议默认值

| 决策 | 建议默认 |
|---|---|
| 产品正式名称 | 本文使用 ArchContext（已与后续研究统一品牌） |
| 设备上限 | 5 台活跃设备 |
| 离线 Entitlement | 7 天 |
| 支付失败宽限 | 7 天 |
| PR Pending 超时 | 24 小时后 `action_required` |
| 组织私有仓库 | 个人可本地使用；组织集中强制与统一结算后续提供 |
| Public 是否需登录 | 本地不需要；GitHub Check 需要绑定 GitHub 身份 |
| 架构文件默认提交 | Model/ADR/Policy/Generated 提交；Local DB 忽略 |
| 自动写入 | 默认关闭；只自动更新索引和生成建议 |
| 详细 PR Findings | 默认本地；用户确认后本地直发 GitHub |

# 附录 A：ArchitectureChangeSet Schema 示例

```json
{
  "version": 1,
  "id": "cs_01J...",
  "repository_fingerprint": "local:sha256:...",
  "base_commit": "abc123",
  "base_tree_hash": "sha256:...",
  "reason": "新增订单取消后的退款重试流程",
  "evidence": [
    {
      "path": "services/payment/src/refund/worker.ts",
      "symbol": "RefundWorker",
      "content_hash": "sha256:..."
    }
  ],
  "operations": [
    {
      "op": "upsert_node",
      "node_id": "component.refund-worker",
      "patch": {}
    },
    {
      "op": "upsert_edge",
      "edge_id": "service.order-publishes-event.refund-requested",
      "patch": {}
    }
  ],
  "generated_files": [
    ".archcontext/generated/TREE.md",
    ".archcontext/generated/DEPENDENCIES.md"
  ]
}
```

# 附录 B：建议 CLI

```text
arch login
arch logout
arch status
arch doctor
arch init
arch index
arch rebuild
arch context "add refund retry"
arch impact --staged
arch drift
arch review --staged
arch review-pr 42
arch render
arch billing
arch devices
```

# 附录 C：参考资料

- **[R1] Model Context Protocol — Architecture overview.** 说明 MCP Host/Client/Server、stdio 与 Streamable HTTP。https://modelcontextprotocol.io/docs/learn/architecture
- **[R2] Model Context Protocol Specification 2025-11-25 — Authorization.** 说明 HTTP Transport OAuth、PKCE、Audience、以及 stdio 不采用该 HTTP 授权流程。https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- **[R3] GitHub Docs — Choosing permissions for a GitHub App.** 说明 GitHub App 默认无权限并应采用最小权限。https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- **[R4] GitHub Docs — REST API endpoints for check runs.** 说明创建 Check Run、Commit 绑定及 Checks 写权限。https://docs.github.com/en/rest/checks/runs
- **[R5] GitHub Docs — Reviewing and modifying installed GitHub Apps.** 说明安装者可以选择全部或指定仓库并调整访问范围。https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps
- **[R6] CodeGraph official site.** 说明本地 Tree-sitter、SQLite Code Graph、MCP 工具和文件事件增量更新。https://codegraph.codes/
- **[R7] Stripe Docs — Recurring pricing models.** 说明 Flat Rate、Per-seat、Usage-based 等订阅定价模型。https://docs.stripe.com/products-prices/pricing-models
- **[R8] Stripe Docs — Cancel subscriptions.** 说明计费周期末取消。https://docs.stripe.com/billing/subscriptions/cancel
