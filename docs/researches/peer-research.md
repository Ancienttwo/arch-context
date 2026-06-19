# ArchContext 深度竞品分析

**研究日期：2026 年 6 月 19 日**

> **精度修正（后续）**：本篇关于 CodeGraph 的"可选 Provider / Tier 0–3 / Builtin 兜底 / 无 CodeGraph 也能工作"等结论，已被编号更新的 `peer-research2.md` 推翻——CodeGraph 改为硬依赖（仅经 adapter 软耦合），架构模型改为 Agent-first YAML、目录 `.archcontext/`。本篇作为竞品分析快照保留；凡与 `peer-research2.md`、`prd-appendix.md` 冲突处，以编号大、时间最新者为准。

## 一、核心结论

这个市场并非空白，而且正在快速收敛。

ArchContext 计划中的能力，已经分别被不同产品占据：

| 能力层                  | 当前代表产品                          |
| -------------------- | ------------------------------- |
| Architecture as Code | LikeC4、Structurizr、Archyl       |
| 从代码发现架构              | Archyl、Corbell、Softagram        |
| 本地 Code Graph        | CodeGraph、Corbell               |
| Agent 架构上下文          | Archyl、Corbell、LikeC4、Architext |
| PR 架构审查              | Archyl、Softagram                |
| AI PR Review         | GitHub Copilot、Greptile         |
| 可视化 C4 协作            | IcePanel、DiagramGuru            |
| Repo 内规范驱动开发         | Architext、GitHub Spec Kit       |

其中：

* **Archyl 是最完整的直接商业竞争对手。**
* **Corbell 是最接近 ArchContext 本地技术路线的开源竞争对手。**
* **LikeC4 和 Structurizr 是架构模型与 DSL 层面的替代品。**
* **CodeGraph 是最适合合作、也最不值得重复开发的底层能力。**
* **最大的隐形竞争对手不是单一产品，而是免费组合：CodeGraph + LikeC4 + Agent Skill + GitHub Actions。**

因此，ArchContext 不能只定位成：

> AI 自动生成和维护架构文档。

这已经不足以构成差异化。

更有机会的定位是：

> **让任何 Coding Agent 在本地获得可验证、持续同步的架构上下文，并在代码不离开用户环境的前提下完成 GitHub 架构审查。**

---

# 二、市场地图

可以把竞品放在两个维度中：

```text
                        持续代码感知与治理
                               ▲
                               │
           Corbell             │             Archyl
           CodeGraph           │             Softagram
           ArchContext         │
              目标位置          │
本地 / Repo-native ────────────┼──────────── 云端 / Hosted
                               │
           LikeC4              │             DiagramGuru
           Structurizr Local   │             IcePanel
           Architext           │             Compass
                               │
                               ▼
                        静态建模与文档
```

ArchContext 的目标区域并非无人占领。Corbell 已经占据“本地代码图谱 + 架构上下文 + MCP”，Archyl 已经占据“代码发现 + 架构模型 + Agent + PR 治理”。

真正相对空缺的位置是：

```text
本地数据平面
+
Repo-native 架构模型
+
日常 Agent Context
+
安全的 Architecture Writer
+
GitHub SaaS Attestation
+
极简个人定价
```

---

# 三、最重要的直接竞争者

## 1. Archyl：最强直接竞争者

### 已有能力

Archyl 已经覆盖了你大部分长期产品路线：

* C4 Architecture Model
* `archyl.yaml` Architecture as Code
* 从源代码自动发现架构
* 增量分析代码变更
* Architecture Drift Score
* 确定性 Conformance Rules
* ADR、API Contract、Technology Radar
* MCP Server
* Agent Skills
* GitHub Actions PR Gate
* Managed Agent Runs
* On-premise 部署

Archyl 的 GitHub Actions 已支持 PR Conformance Check、Drift Score、生成 Agent Context、自动创建 Architecture Change Request 和同步 `archyl.yaml`。其 Agent Skills 覆盖开发前检查、开发、Review、CI、发布后同步和多 Agent 协调，并公开宣称提供 200 多个 MCP 工具。([Archyl][1])

Archyl 的 AI Discovery 可以连接 GitHub、GitLab、Bitbucket 等代码库，从代码中发现 Systems、Containers、Components、Code Elements 和 Relationships；也可以通过 Webhook 或 GitHub Actions在每次 Push 后增量更新。([Archyl][2])

### 它的弱点，也是 ArchContext 的窗口

Archyl 的默认产品路径是云端连接仓库和服务端分析。它的 Conformance MCP 接口会把 `changedFiles` 和 `fileContents` 发送给 Archyl API；Managed Agent Run 也会把仓库 Clone 到 Archyl 管理的隔离 Workspace。虽然它提供 On-premise，但默认架构并不是“代码永不进入供应商环境”。([Archyl][3])

此外，200 多个 MCP 工具代表功能完整，但也意味着：

* Tool Selection 成本高
* Agent 容易选错工具
* 使用者学习成本高
* 产品范围非常宽
* 日常开发流程可能显得重量级

### 威胁等级

**5 / 5**

Archyl 能够最快复制 ArchContext 的功能列表。ArchContext 不能和它进行“功能数量竞争”，而应该强调：

```text
Archyl：
云端架构管理平台，支持本地化部署

ArchContext：
本地架构 Runtime，云端永远不拥有代码访问能力
```

---

## 2. Corbell：最接近的开源技术竞争者

Corbell 是 Apache 2.0 开源项目，核心能力包括：

* 多仓库 Architecture Graph
* Service、Method、Call Graph
* HTTP、Database、Queue 依赖
* Git Change Coupling
* 本地 SQLite
* 可选 Neo4j
* 本地 Embedding
* MCP Server
* HLD/LLD Design Spec 生成
* Spec Review
* Architecture Constraints
* Jira、Linear、Notion Export
* Ollama 全离线模式

Corbell 明确强调没有 SaaS、没有服务器、无需账户；Graph、Embedding、UI 均可在本地运行。它的 MCP 默认暴露四个核心工具，分别处理 Graph Query、Architecture Context、Code Search 和 Service List。([GitHub][4])

### 与 ArchContext 的重叠

```text
本地执行                  高度重叠
SQLite                    高度重叠
多仓库图谱                高度重叠
MCP                       高度重叠
架构上下文                高度重叠
设计文档生成与 Review      高度重叠
Code Evidence             部分重叠
```

### ArchContext 仍有机会的部分

Corbell 当前更像：

> 本地 Multi-repo Code Graph + Design Spec Generator。

公开产品中尚未形成 ArchContext 所计划的完整治理闭环：

```text
Declared Architecture
Observed Architecture
Verified Architecture
Architecture ChangeSet
事务化文档写入
GitHub App Installation
Head-SHA Review Challenge
Signed Local Attestation
个人 SaaS Entitlement
```

Corbell 有 CI Spec Lint，但公开文档中未展示独立 GitHub App、最小权限安装、基于 Commit SHA 的本地签名审查，以及由 SaaS 发布 Check Run 的机制。([GitHub][4])

### 威胁等级

**5 / 5**

Corbell 证明：

> “本地、私密、MCP、架构图谱”本身已经不是独特卖点。

ArchContext 必须把竞争重点放在**架构状态管理、文档变更治理和 GitHub 验证协议**，而不是 Code Graph。

---

## 3. LikeC4：最危险的 Schema 替代品

LikeC4 是 MIT 开源 Architecture-as-Code 工具，提供：

* 自定义 Architecture DSL
* 单一模型生成多个 View
* 本地 Preview
* IDE 支持
* Git Versioning
* Model Validation
* GitHub Actions
* Mermaid、D2、DOT、Draw.io 等导出
* MCP Server
* Agent Skills
* API 和可编程模型遍历

LikeC4 已经将“架构模型是 Git 中的单一事实来源”作为核心定位，并通过 MCP 让 Agent 查询架构模型。([GitHub][5])

### 对 ArchContext 的影响

ArchContext 不应该重新发明一个功能比 LikeC4 更弱的 C4 DSL。

否则用户会问：

```text
为什么不用 LikeC4？
为什么我要学习 archcontext.yaml？
为什么不能直接查询现有 .c4 文件？
```

### 推荐关系

不是直接替代 LikeC4，而是把它作为 Provider：

```text
ArchitectureModelProvider
├── Native ArchContext Markdown/YAML
├── LikeC4 Provider
└── Structurizr Provider
```

ArchContext 应该增加：

```text
archctx import likec4
archctx export likec4
archctx context --model-provider likec4
archctx review --model-provider likec4
```

### 威胁等级

**4 / 5**

如果 ArchContext 强制使用自己的完整建模 DSL，威胁等级是 5；如果把 LikeC4 当作可插拔模型来源，它反而是重要的生态伙伴。

---

## 4. Structurizr：架构模型的参考标准

Structurizr 是 C4 Model 作者创建的参考实现，强调 Models as Code、Git 协作、模型与 View 分离、Markdown/AsciiDoc、ADR、CI/CD 和开放数据格式。官方甚至直接将 AI Agent 自动生成模型、PR 更新、ADR 一致性检查和 Drift Detection 列为 Architecture-as-Code 的适用场景。([Structurizr][6])

Structurizr Cloud 当前为每 Workspace 每月 5 美元，但最少购买 5 个 Workspace；本地和大多数命令可免费使用。([Structurizr][7])

它不会直接完成 ArchContext 的本地代码索引和 Agent 工作流，但会成为用户已有的架构资产格式。

### 战略含义

ArchContext Schema 必须具备：

* 可映射到 C4
* 支持 Structurizr Import / Export
* 不依赖特定渲染器
* Model 与 View 分离
* 不把图形坐标混入语义节点
* 不强制用户迁移全部既有模型

---

## 5. Softagram：PR 架构影响竞争者

Softagram 的核心价值是：

* 每个 PR 自动分析依赖影响
* 展示 Transitive Dependency
* 检查 Architecture Boundary
* Security 和 SBOM
* GitHub、GitLab、Bitbucket 集成
* PR Check
* MCP
* Cloud、Desktop 和 On-premise 路径

其公开定价为每个活跃开发者每月 19 美元，不限制 Repository 数量。([Softagram][8])

### 与 ArchContext 的区别

Softagram 更偏：

```text
代码依赖分析
PR Impact
Security
Enterprise Governance
```

ArchContext 应偏：

```text
架构上下文
架构决策
Agent 日常开发
Repo-native 文档
架构模型更新
本地写入与验证
```

不要把 ArchContext 做成另一个 Dependency Analyzer。否则会进入 Softagram 已经成熟的竞争区。

### 威胁等级

**4 / 5**

尤其在企业 PR Gate 市场中，Softagram 比 ArchContext 更成熟。

---

# 四、视觉建模与协作型竞品

## DiagramGuru

DiagramGuru 通过 MCP 让 Agent 创建和维护 C4 Model、Flow 和多层 Architecture Diagram。其免费版支持 1 个编辑者和 2 个项目；Growth 为每月 39 美元，Scale 为每月 149 美元。([DiagramGuru][9])

它的优势是：

* 可视化体验直接
* C4 语义清晰
* MCP-native
* 团队分享
* 上手成本低

但公开定位更偏托管 Architecture Diagram 和协作，并未强调本地 Code Evidence、Repo 内架构文件、GitHub Attestation 或严格的零代码出域。

## IcePanel

IcePanel 是成熟的 C4 建模平台，支持单一模型、多 View、Documentation、Decision Record、Version、Inaccuracy Score、API 和 MCP。当前 Growth 价格为每个编辑者每月 40 美元，Scale 为每个编辑者每月 80 美元。([IcePanel][10])

IcePanel 的竞争优势是：

* 成熟视觉编辑
* 非技术人员更容易参与
* 团队协作和历史管理
* 企业支持

ArchContext 不应在 MVP 开发自己的大型 Canvas 或 C4 图形编辑器。视觉输出可先交给：

```text
LikeC4
Mermaid
Structurizr
Graphviz
```

---

# 五、Repo 文档与 Spec-driven 竞品

## Architext

Architext 将需求、架构、任务和验收标准保存在 `.architext/` 中，通过 Agent Commands 和 Skills 执行：

```text
init
plan
code
review
change
map sync
```

它强调文档持久化、Agent 切换后上下文不丢失，并面向个人开发者和中小型应用。项目采用 MIT License。([Architext][11])

### 与 ArchContext 的区别

Architext 是：

> Document-driven Software Development Protocol。

ArchContext 应是：

> Verified Architecture Context Runtime。

Architext 更关注从需求到实现，ArchContext 更关注：

* 系统边界
* 架构节点
* 依赖关系
* Source Evidence
* Architecture Drift
* 架构变更
* PR Attestation

但对于普通独立开发者，二者的用户感知可能很接近。因此首页不能只写：

> 让 Agent 记住你的架构。

这正是 Architext 已经在表达的价值。

---

# 六、CodeGraph 与本地代码智能竞品

CodeGraph 当前提供：

* Tree-sitter AST
* 本地 SQLite + FTS5
* 自动增量同步
* Symbol、Call、Import、Inheritance Graph
* Context、Trace、Impact、Affected Tests
* CLI
* MCP
* 多 Agent 自动安装
* 完全本地

其自有 Benchmark 声称平均减少 57% Token、71% Tool Calls，并降低约 35% 成本；这些数字是项目方自己的测试，不应作为独立验证结论，但足以说明其产品定位非常明确。([GitHub][12])

此外，市场上已经出现大量类似本地 Code Graph MCP，例如 CodeGraphContext、code-review-graph、code-graph-mcp 和多个 Rust 实现。([GitHub][13])

### 结论

**ArchContext 不应该把 Code Graph 当作核心护城河。**

应该坚持：

```text
CodeGraph
= 可替换的代码事实提供者

ArchContext
= 架构语义、证据、文档、状态转换与治理
```

最合理的策略：

```text
Builtin Provider
只提供 Git、File Tree、Manifest、简单依赖分析

CodeGraph Provider
提供 Symbol、Call Graph、Impact 和精确 Evidence

未来 Provider
SCIP / Sourcegraph / Softagram / Language Server
```

---

# 七、通用 AI Review 的替代威胁

## GitHub Copilot

GitHub Copilot Pro 当前为每月 10 美元，并已包括 Code Review、Cloud Agent 和 MCP。自 2026 年 6 月 1 日起，Copilot Code Review 同时消耗 AI Credits 和 GitHub Actions 分钟。([GitHub Docs][14])

Copilot Code Review 支持 Repository 和 Path-specific Instructions，但每个 Instruction 文件只读取前 4,000 个字符。([GitHub Docs][15])

这恰好暴露 ArchContext 的机会：

```text
Copilot Instructions
= 非结构化、长度有限的静态说明

ArchContext Context
= 按任务裁剪、带关系、Evidence、ADR 和 Policy 的结构化上下文
```

但 ArchContext 绝不能宣传为普通 AI Code Reviewer，因为 Copilot 已经被 GitHub 原生捆绑。

## Greptile

Greptile 建立完整代码图谱，并用 Agent 执行 PR Review。当前 Pro 定价为每席位每月 30 美元，包含每席位 50 次 Review，额外 Review 每次 1 美元；Enterprise 支持自托管。([Greptile][16])

Greptile 的核心是：

```text
找 Bug
理解全代码库
Review PR
```

ArchContext 的核心应是：

```text
是否违反已声明的架构
架构文档是否需要变化
架构变更是否有证据
Agent 是否获得正确的约束
```

---

# 八、完整能力对比

说明：

* ✅：核心能力
* ◐：部分支持或不是核心
* —：公开资料未显示

| 产品                 |      本地优先 |         Repo 架构事实源 |        从代码发现 |    MCP |      写架构模型/文档 |    Drift / PR Gate |
| ------------------ | --------: | -----------------: | -----------: | -----: | ------------: | -----------------: |
| **ArchContext 规划** |         ✅ |                  ✅ |        ✅ 可插拔 |      ✅ |             ✅ |                  ✅ |
| **Archyl**         | ◐ On-prem |    ✅ `archyl.yaml` |            ✅ |      ✅ |             ✅ |                  ✅ |
| **Corbell**        |         ✅ |   ◐ Spec/Workspace |            ✅ |      ✅ | ✅ Design Spec |        ◐ Spec Lint |
| **LikeC4**         |         ✅ |                  ✅ |            — |      ✅ |       ✅ Model | ◐ Model Validation |
| **Structurizr**    |     ✅ 可本地 |                  ✅ |            — | ◐ 生态集成 |   ✅ Model/ADR |               ◐ CI |
| **Softagram**      |         ◐ |                  — |            ✅ |      ✅ |             — |                  ✅ |
| **DiagramGuru**    |         — |     ◐ Hosted Model |   ◐ Agent 驱动 |      ✅ |          ✅ C4 |                  — |
| **IcePanel**       |         — | ◐ Hosted Model/API | ◐ Inaccuracy |      ✅ |      ✅ C4/ADR |                  ◐ |
| **Architext**      |         ✅ |        ✅ Repo Docs |            ◐ |      — |             ✅ |                  ◐ |
| **CodeGraph**      |         ✅ |       — Derived DB |            ✅ |      ✅ |             — |           ◐ Impact |

---

# 九、价格竞争分析

这些产品解决的问题不同，不能完全横向比较，但用户会自然进行价格对照。

| 产品                 |                  公开价格 |
| ------------------ | --------------------: |
| **ArchContext 规划** |     **$5/月，个人全部私有仓库** |
| CodeGraph          |                  免费开源 |
| Corbell            |                  免费开源 |
| LikeC4             |                  免费开源 |
| Architext          |                  免费开源 |
| Structurizr Cloud  | $5/Workspace/月，最低 5 个 |
| GitHub Copilot Pro |      $10/用户/月，另有使用量机制 |
| Compass Standard   |            $7.67/用户/月 |
| Softagram          |           $19/活跃开发者/月 |
| Greptile           |              $30/席位/月 |
| DiagramGuru Growth |                 $39/月 |
| IcePanel Growth    |             $40/编辑者/月 |

Compass 提供 Component Catalog、Dependencies、Ownership 和 Configuration as Code，Standard 当前为每用户每月 7.67 美元，但仅提供 Cloud。([atlassian.com][17])

### 对 $5 定价的判断

$5 很有吸引力，但**低价不是主要护城河**，因为最接近的本地工具基本都是免费开源。

用户不会问：

> ArchContext 比 Archyl 便宜多少？

用户更可能问：

> 为什么不用 CodeGraph + LikeC4，都是免费的？

因此，$5 必须购买的是“组合后的完整体验”：

```text
一条命令安装
一个薄 MCP
自动读取已有架构
安全更新架构文件
跨 Agent 通用
Schema 自动升级
GitHub App
Signed Attestation
PR Architecture Check
无需自己拼 GitHub Actions
```

---

# 十、真正最大的竞争对手：DIY 免费组合

高级开发者可以自行拼出：

```text
CodeGraph
    +
LikeC4 / Structurizr
    +
Markdown ADR
    +
GitHub Actions
    +
自定义 Agent Skill
    +
Spec Kit / Architext
```

这套方案具备：

* 本地代码图谱
* Git 中的架构模型
* MCP
* 架构图
* Agent Instructions
* PR Validation
* 全部免费

问题是它需要用户自己解决：

* Schema 对齐
* Code → Architecture Evidence
* 增量同步
* 文档安全写入
* Drift 算法
* 多工具 Context 重复
* Agent Tool Selection
* GitHub Check
* 更新和兼容性
* Review 与当前 Head SHA 的绑定

因此 ArchContext 的产品价值不是创造每一个底层能力，而是：

> **把碎片化工具组合成一个可靠、低摩擦、可验证的本地架构工作流。**

---

# 十一、ArchContext 应该建立的差异化

## 1. 零代码出域必须是技术事实

不是隐私政策中的一句话，而是架构可证明：

```text
GitHub App 无 Contents 权限
SaaS 不提供代码上传 Endpoint
本地 Runtime 默认 Network Deny
Attestation 仅含 Digest、SHA 和 Result
公开数据流图
提供 Network Audit 命令
```

建议提供：

```bash
archctx privacy audit
archctx privacy trace
archctx privacy verify-permissions
```

输出：

```text
GitHub Contents Permission: NONE
Repository content uploaded: NO
Source file endpoints: NONE
Local index: ~/.local/share/archcontext/...
Allowed remote data:
- user identity
- subscription entitlement
- repository numeric ID
- commit SHA
- signed review result
```

这是 Archyl、DiagramGuru、Greptile 等默认云端方案难以直接复制的差异。

## 2. Declared / Observed / Verified 三层模型

这是最值得形成产品语言和 Schema 的部分：

```text
Declared
团队希望系统如何运作

Observed
代码实际如何运作

Verified
有代码 Evidence 支持且未发生 Drift 的架构事实
```

每个 Relationship 都应能够表达：

```yaml
id: relation.order-calls-payment
source: service.order
target: service.payment
type: calls

declared:
  status: active
  source: architecture/nodes/service-order.md

observed:
  status: present
  confidence: 0.98
  provider: codegraph
  evidenceCount: 7

verification:
  status: verified
  verifiedAtCommit: abc123
```

这比单纯 C4 Diagram 或 Code Graph 更有产品意义。

## 3. Evidence-first Architecture

Agent 输出的每项架构结论必须附带：

```text
Node ID
Relation ID
Source Selector
File
Symbol
Commit SHA
Provider
Confidence
```

ArchContext 不应该声称：

> AI 认为 Order Service 依赖 Payment Service。

而应该输出：

```text
Declared relation:
service.order -> service.payment

Observed evidence:
services/order/src/payment/client.ts
PaymentClient.authorize()
HEAD abc123

Verification:
MATCHED
```

## 4. Context Compiler，而不是 Architecture Search

最有价值的 MCP Tool 应是：

```text
archcontext_context(task)
```

一次返回：

* 相关架构节点
* 允许与禁止的依赖
* ADR
* 受影响的接口
* 关键 Source Evidence
* 更新要求
* Context Budget

目标不是让 Agent 继续调用 20 个工具，而是让它用 1～2 次调用开始工作。

## 5. GitHub Signed Local Review

这是 ArchContext 最有辨识度的云端功能：

```text
本地执行完整 Review
        ↓
生成绑定 Head SHA 的签名证明
        ↓
SaaS 只验证身份、订阅和签名
        ↓
GitHub App 发布 Check
```

这使产品同时获得：

* 本地隐私
* GitHub 可见治理
* SaaS 订阅
* 不需要代码上传

需要诚实命名：

```text
个人电脑执行：
Developer-attested Architecture Review

未来客户 Runner：
Organization-attested Architecture Review
```

---

# 十二、应该自研和应该集成的边界

## 必须自研

| 能力                         | 原因                 |
| -------------------------- | ------------------ |
| Architecture Schema        | 产品核心语义             |
| Declared/Observed/Verified | 核心差异化              |
| Evidence Mapping           | Code Graph 与架构模型桥梁 |
| ChangeSet Engine           | 安全文档写入             |
| Drift Engine               | 产品核心               |
| Context Compiler           | Agent 使用价值         |
| Review Result Schema       | GitHub 治理基础        |
| Signed Attestation         | SaaS 商业核心          |
| GitHub App                 | 收费和 PR 分发          |
| Entitlement                | $5 订阅能力            |

## 应该集成

| 能力                  | 建议                           |
| ------------------- | ---------------------------- |
| Symbol / Call Graph | CodeGraph Provider           |
| C4 Visualization    | LikeC4 / Structurizr Adapter |
| Markdown Diagram    | Mermaid                      |
| Git                 | 调用系统 Git                     |
| Agent Workflow      | 第一方 Skill                    |
| LLM                 | 使用用户当前 Agent，不自建推理平台         |
| Auth / Billing      | GitHub OAuth + Stripe        |
| Cloud               | Cloudflare Workers + D1      |

## 不应在 MVP 开发

```text
大型 Architecture Canvas
自有通用 Code Graph Parser
托管 Vector Database
通用 AI Code Review
Slack Bot
Managed Coding Agent
企业 Software Catalog
DORA Metrics
跨组织 Architecture Dashboard
200 个 MCP Tools
```

---

# 十三、对当前产品架构的具体调整建议

## 1. Schema 不要只支持自有格式

建议：

```text
Canonical Internal Graph
         ▲
         │ adapters
         │
├── ArchContext Markdown/YAML
├── LikeC4
├── Structurizr DSL
├── Mermaid
└── Future: Backstage / Compass
```

自有格式主要承载 LikeC4/Structurizr 不擅长的部分：

* Evidence
* Verification 状态
* Source Selectors
* Review Policies
* Agent Context Metadata
* ChangeSet

C4 Model 本身不需要完全重造。

## 2. CodeGraph 保持可选

```text
Tier 0：Git + File Tree + Manifest
Tier 1：Built-in Import Parser
Tier 2：CodeGraph
Tier 3：Enterprise Provider
```

这样避免：

* 第三方版本变化阻塞产品
* 用户必须安装两个复杂产品
* CodeGraph License 或维护状态变化
* 语言支持差异导致 ArchContext 不可用

## 3. 薄 MCP 是正确选择

Archyl 暴露 200 多个工具，Corbell 暴露四个核心工具，CodeGraph 当前公开约十个主要 MCP 工具。([Archyl][18])

ArchContext 建议保持五个：

```text
archcontext_context
archcontext_impact
archcontext_plan_update
archcontext_apply_update
archcontext_review
```

其余能力通过 CLI 或 MCP Resources 提供。

## 4. Slack 继续排除 MVP

Slack 不是个人开发者的关键购买因素，也不是直接竞品形成优势的必要能力。

先保留：

```typescript
interface NotificationPublisher {
  publish(event: ProductEvent): Promise<void>;
}
```

MVP 仅实现 GitHub Check Publisher。

---

# 十四、MVP 路线应该怎样调整

## P0：必须证明产品独特性

```text
[ ] 本地 Runtime 完全运行
[ ] GitHub App 无 Contents 权限
[ ] Repo 架构文件可作为 Source of Truth
[ ] Declared / Observed / Verified 状态可查询
[ ] Context 一次返回任务所需架构
[ ] ChangeSet 可以安全修改文件
[ ] Review 绑定具体 Head SHA
[ ] SaaS 仅接收签名 Attestation
```

## P1：降低免费组合的安装摩擦

```text
[ ] 一条命令安装 CLI + MCP
[ ] 自动识别 Claude Code / Cursor / Codex
[ ] 自动发现 LikeC4 / Structurizr / Markdown ADR
[ ] 自动识别 CodeGraph
[ ] 无 CodeGraph 也能工作
[ ] 五分钟内完成首次 Architecture Context Query
```

## P2：建立开放生态

```text
[ ] 开源 Architecture Schema
[ ] 开源 JSON Schema Validators
[ ] 开源 LikeC4 Adapter
[ ] 开源 Structurizr Adapter
[ ] 发布 MCP Resources 规范
[ ] 为公开仓库生成 ArchContext Badge
```

## 后置

```text
[ ] 多仓库 Graph
[ ] 可视化浏览器
[ ] Team Billing
[ ] Organization Runner
[ ] Slack
[ ] Enterprise Policy Distribution
```

---

# 十五、主要风险

## 风险 1：Archyl 推出本地 Runtime

这是最现实的竞争风险。

缓解方式不是追赶功能，而是形成：

* GitHub App 无代码权限
* 开放 Schema
* Local-first 品牌心智
* 极简 MCP
* $5 个人定价
* 跨 Agent 中立
* LikeC4 / Structurizr 兼容

## 风险 2：Corbell 增加 GitHub App

Corbell 已经拥有本地 Graph、Spec、Review 和 MCP，增加 GitHub Check 并不困难。

ArchContext 必须更快建立：

* Architecture ChangeSet
* Verified Model
* Attestation Protocol
* Repo-native Node Schema
* Entitlement 和 GitHub 安装体验

## 风险 3：自有 Schema 没人采用

如果用户必须重写已有 LikeC4 或 Structurizr 模型，采用率会降低。

应允许：

```text
原生使用现有模型
+
ArchContext 只附加 Verification Metadata
```

## 风险 4：本地签名证明的可信度有限

开发者控制自己的电脑，因此本地签名不能证明 Runtime 未被修改。

必须清楚区分：

```text
个人版：
Developer Attestation

企业版：
Trusted Runner Attestation
```

## 风险 5：$5 ARPU 太低

$5 可以支撑自动化、低支持成本的个人产品，但无法承担高触达支持。

因此个人版必须：

* 无人工 Onboarding
* 不托管代码和索引
* 不按调用计费
* 默认异步自助支持
* 后续增加 $50 年付
* Team / Enterprise 单独定价

---

# 十六、最终竞争战略

## 不要成为

```text
另一个 AI 架构图工具
另一个 Code Graph
另一个 PR Bug Reviewer
另一个 Spec-driven Framework
另一个企业架构 Dashboard
```

## 应该成为

> **Coding Agent 的本地、可验证架构上下文层。**

完整定位：

> **ArchContext keeps architecture synchronized with code, gives every coding agent the right context, and verifies architectural changes on GitHub—without your source code leaving your environment.**

中文：

> **ArchContext 在本地持续同步代码与架构，为每个 Coding Agent 提供准确上下文，并在不上传代码的情况下完成 GitHub 架构审查。**

## 最有竞争力的一句话

> **Your code stays local. Your architecture stays current.**

## 我的最终判断

这个产品**值得做**，但应把范围从“完整的 AI Architecture Platform”缩小为：

```text
Local Architecture Runtime
+
Verified Architecture Context
+
GitHub Attestation Service
```

其中最核心的三项不是图形界面，也不是 Code Graph，而是：

1. **Declared / Observed / Verified Schema**
2. **Evidence-grounded Context 与 ChangeSet**
3. **零代码出域的 GitHub Review Attestation**

缺少这三项，ArchContext 会变成较小的 Corbell 或 Archyl。

建立这三项后，它会拥有一个目前竞品尚未完整占据、并且与你的隐私架构和 $5 定价高度一致的位置。

[1]: https://www.archyl.com/docs/features/github-actions?utm_source=chatgpt.com "GitHub Actions Integration - Archyl Docs"
[2]: https://www.archyl.com/docs/features/ai-discovery?utm_source=chatgpt.com "AI-Powered Discovery - Archyl Docs"
[3]: https://www.archyl.com/docs/features/managed-agent-runs?utm_source=chatgpt.com "Managed Agent Runs - Archyl Docs"
[4]: https://github.com/Corbell-AI/Corbell "GitHub - Corbell-AI/Corbell: AI-powered spec generation and review using multi-repo code graph intelligence for backend teams that ship to production. · GitHub"
[5]: https://github.com/likec4/likec4/blob/main/packages/likec4/README.md?utm_source=chatgpt.com "likec4/packages/likec4/README.md at main · likec4/likec4 · GitHub"
[6]: https://docs.structurizr.com/as-code?utm_source=chatgpt.com "Why “as code”? | Structurizr"
[7]: https://structurizr.com/help/cloud-service?utm_source=chatgpt.com "Structurizr - Pricing"
[8]: https://softagram.com/en/softagram-analyzer/pricing?utm_source=chatgpt.com "Pricing | Softagram"
[9]: https://www.diagramguru.com/?utm_source=chatgpt.com "DiagramGuru - Architecture Diagrams Built and Maintained by AI"
[10]: https://icepanel.io/pricing?utm_source=chatgpt.com "Pricing Plans | IcePanel"
[11]: https://architext.cn/?utm_source=chatgpt.com "Architext — The AI Architecture Protocol"
[12]: https://github.com/colbymchenry/codegraph/blob/main/README.md?utm_source=chatgpt.com "codegraph/README.md at main · colbymchenry/codegraph · GitHub"
[13]: https://github.com/sdsrss/code-graph-mcp?utm_source=chatgpt.com "GitHub - sdsrss/code-graph-mcp: AST knowledge graph MCP server for Claude Code — semantic search, call graph traversal, HTTP route tracing, impact analysis. Auto-indexes 10 languages via Tree-sitter. · GitHub"
[14]: https://docs.github.com/copilot/reference/copilot-billing/models-and-pricing?utm_source=chatgpt.com "Models and pricing for GitHub Copilot - GitHub Docs"
[15]: https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review?utm_source=chatgpt.com "Using GitHub Copilot code review - GitHub Docs"
[16]: https://www.greptile.com/pricing?utm_source=chatgpt.com "Greptile Pricing - AI Code Review Enterprise Plans"
[17]: https://www.atlassian.com/software/compass/pricing.?utm_source=chatgpt.com "Compass - Pricing | Atlassian"
[18]: https://www.archyl.com/docs/guides/agent-skills?utm_source=chatgpt.com "Coding Agent Skills - Archyl Docs"
