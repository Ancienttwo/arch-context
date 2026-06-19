你这个纠正是对的。我之前的竞品分析**过度依据官网功能清单和 README**，高估了这些项目的产品成熟度，没有充分区分“声明支持某功能”和“真正形成可靠系统”。

应当重新定义：

> **ArchContext 不是架构文档工具，也不是架构画图工具，而是 Agent-native Architecture Runtime。**

### 重新划分产品边界

* **CodeGraph**：底层代码事实引擎，是明确依赖。
* **ArchContext**：把代码事实编译为架构语义、约束、上下文和可执行变更。
* **LikeC4**：面向人类的建模与可视化工具，可作为输出适配器，不是核心竞品。
* **Archyl 等产品**：只能作为市场需求信号，不应作为技术或产品基准。

CodeGraph 已经提供本地 Tree-sitter 解析、Symbol/Call Graph、Impact、File Tree、增量更新、SQLite/FTS5 和公开 Node API，正好承担 ArchContext 不应该重复开发的代码智能层。([GitHub][1])

LikeC4 的核心仍然是 DSL、模型、视图和图形输出；虽然它增加了 MCP 和 Agent Skill，但其 MCP 主要用于查询和编辑 LikeC4 模型，本质仍是 Architecture-as-Code 与可视化工具链。([GitHub][2])

## 应该这样描述两者关系

> **CodeGraph 告诉 Agent：代码是什么、在哪里、如何调用。**
> **ArchContext 告诉 Agent：系统为什么这样设计、哪些边界不能破坏、当前任务应该如何修改架构。**

例如 CodeGraph 可以返回：

```text
OrderController
  → OrderService
  → PaymentClient
  → POST /payments/authorize
```

ArchContext 应当进一步返回：

```text
service.order 调用 service.payment

允许：
- 通过 interface.payment-api 调用
- 只保存 payment_reference

禁止：
- 直接访问 payment 数据库
- 保存支付凭证
- 从 order domain 发布 payment-authorized 事件

相关决策：
- ADR-0012 Payment Boundary
- ADR-0018 Payment Retry Ownership

本次任务：
修改退款重试逻辑

需要同步更新：
- component.refund-worker
- relation.order-calls-payment
- ADR-0018（仅当重试责任发生变化）
```

这才是产品核心。

# CodeGraph 应该是硬依赖，但保持软耦合

我会修正之前“CodeGraph 作为可选 Provider”的建议。

MVP 可以直接规定：

```text
ArchContext requires CodeGraph.
```

但代码结构上仍保留内部接口：

```typescript
export interface CodeFacts {
  ensureIndexed(root: string): Promise<void>;

  getTaskContext(input: {
    root: string;
    task: string;
    budget: ContextBudget;
  }): Promise<CodeContext>;

  getChangedSymbols(input: {
    root: string;
    baseRef: string;
    headRef?: string;
  }): Promise<ChangedSymbol[]>;

  getImpact(input: {
    root: string;
    files?: string[];
    symbols?: string[];
  }): Promise<CodeImpact>;

  getEvidence(input: {
    root: string;
    selectors: SourceSelector[];
  }): Promise<CodeEvidence[]>;
}
```

这不是为了支持多个 CodeGraph Provider，而是为了：

* 防止 CodeGraph API 变化渗透整个项目
* 编写 Mock 和 Fixture 测试
* 固定 ArchContext 所依赖的最小能力
* 以后升级 CodeGraph 时只改 Adapter
* 避免读取其内部 SQLite Schema

## 推荐集成方式

MVP 优先直接依赖其公开 Node API：

```json
{
  "dependencies": {
    "@colbymchenry/codegraph": "固定精确版本"
  }
}
```

ArchContext 自己管理：

```text
CodeGraph.init/open
CodeGraph index/sync
CodeGraph context
CodeGraph impact
CodeGraph symbol query
CodeGraph lifecycle
```

CodeGraph README 已公开 Node Library 用法，包括 `init`、`open`、`searchNodes`、`getCallers`、`buildContext`、`getImpactRadius` 和 watcher，因此可以作为正式集成面。([GitHub][1])

建议策略：

```text
产品依赖：硬依赖
npm 版本：精确锁定
源码耦合：只通过 CodeGraphAdapter
数据库耦合：禁止
MCP 耦合：禁止 MCP 套 MCP
用户可见工具：不暴露原始 CodeGraph 工具
```

Agent 只看到 ArchContext MCP，不需要同时理解十个 CodeGraph Tool 和五个 ArchContext Tool。

# 新的核心架构

```text
Coding Agent
      │
      ▼
Thin ArchContext MCP
      │
      ▼
ArchContext Application Core
      │
      ├── Context Compiler
      ├── Architecture Resolver
      ├── Evidence Matcher
      ├── Constraint Engine
      ├── ChangeSet Engine
      └── Review Engine
             │
             ├── CodeGraph Adapter
             │      └── Code facts / symbols / impact
             │
             ├── Architecture Model Store
             │      └── intent / boundaries / ownership
             │
             ├── Local SQLite
             │      └── evidence / verification / snapshots
             │
             └── Repository Files
                    └── versioned architecture source
```

对应关系：

```text
CodeGraph
= Observed Code Facts

Repository Architecture Model
= Declared Architecture Intent

ArchContext Resolver
= Declared ↔ Observed Matching

ArchContext Context Compiler
= Task-specific Agent Context

ArchContext ChangeSet Engine
= Safe Architecture Mutation

ArchContext Review Engine
= Architecture Verification
```

# Schema 也应该从“人类文档优先”改成“Agent 优先”

之前建议用 Markdown + YAML Frontmatter 作为主要模型，现在我认为需要调整。

对于 Agent-native 产品，核心事实应该是紧凑、规范、确定性的结构化数据；Markdown 是投影，而不是模型本身。

推荐：

```text
.archcontext/
├── manifest.yaml
│
├── model/
│   ├── domains.yaml
│   ├── systems.yaml
│   ├── components.yaml
│   ├── interfaces.yaml
│   ├── data-stores.yaml
│   ├── relationships.yaml
│   ├── constraints.yaml
│   └── ownership.yaml
│
├── decisions/
│   ├── ADR-0001.md
│   └── ADR-0002.md
│
├── policies/
│   ├── dependency-boundaries.yaml
│   ├── change-policy.yaml
│   └── review-policy.yaml
│
└── generated/
    ├── ARCHITECTURE.md
    ├── TREE.md
    ├── DEPENDENCIES.md
    └── architecture.mmd
```

这里：

```text
model/*.yaml
= Agent 和验证器消费的 Source of Truth

decisions/*.md
= 需要自然语言解释的架构决策

generated/*
= 面向人的可读投影

CodeGraph DB
= 代码事实

ArchContext SQLite
= 匹配、证据、状态和缓存
```

## 不应把 CodeGraph Evidence 提交到 Git

下面这些变化频率太高：

```text
symbol ID
line number
blob SHA
call edge
confidence
last observed commit
```

它们应该保存在本地数据库：

```text
architecture_node
      │
      ├── source selector
      │       └── services/order/**
      │
      └── observed evidence
              ├── OrderController
              ├── OrderService.create
              ├── PaymentClient.authorize
              └── commit abc123
```

Git 中只保存稳定意图：

```yaml
id: service.order
kind: service
name: Order Service

source:
  include:
    - services/order/**

responsibilities:
  - manage-order-lifecycle
  - coordinate-order-cancellation

constraints:
  - id: no-payment-database-access
  - id: no-payment-credential-storage
```

# LikeC4 应该如何处理

不要在 MVP 把 LikeC4 作为依赖，也不要围绕它设计 Schema。

未来只提供：

```text
LikeC4Exporter
ArchContext Model → LikeC4 Model / Views
```

或者可选：

```text
LikeC4Importer
LikeC4 Elements / Relationships → Initial ArchContext Model
```

但 ArchContext 中 LikeC4 不具备的核心内容包括：

```text
Task Context
Source Evidence
Verification State
ChangeSet
Constraint Enforcement
Agent Write Policy
Review Finding
Attestation
```

因此 LikeC4 最多是一个 View Engine。

# 真正的竞争对手

现在看，ArchContext 的主要竞争对手并不是这些现有 Repo，而是：

1. **Agent 直接读取整个 Repository**
2. **Agent + CodeGraph，但没有显式架构语义**
3. **团队自己维护 CLAUDE.md、AGENTS.md 和 ADR**
4. **未来 Claude Code、Codex、Cursor 或 GitHub 原生增加架构记忆层**
5. **用户认为 CodeGraph 已经够用，不需要额外架构层**

因此 ArchContext 必须证明：

```text
只有 CodeGraph：
Agent 知道代码如何工作

加入 ArchContext：
Agent知道代码为什么这样工作、
哪些变化被允许、
哪些架构文件必须同步更新、
以及修改是否违反架构意图
```

# 真正的护城河

不应该是：

```text
代码解析
架构图
C4 DSL
Markdown 生成
MCP Server
```

这些都容易复制。

应该是：

```text
1. Architecture Context Compiler
   根据任务生成最小且完整的架构上下文

2. Declared / Observed / Verified Model
   将意图、代码事实和验证状态统一起来

3. Evidence Resolver
   将 CodeGraph 节点映射到架构语义

4. Safe ChangeSet
   Agent 不直接乱改文档，而是提交结构化架构变更

5. Architecture Review Protocol
   判断代码变化是否要求架构变化

6. Local Attestation
   不上传代码也能完成 GitHub Check

7. Schema Evolution
   架构模型可长期升级而不破坏 Repository
```

# 修正后的产品定位

不再强调：

> AI architecture documentation.

应该强调：

> **Architecture memory and constraints for coding agents.**

或者更完整：

> **ArchContext is the architecture runtime for coding agents. It turns CodeGraph facts and repository decisions into task-specific context, safe architecture changes, and verifiable reviews.**

中文：

> **ArchContext 是 Coding Agent 的架构运行时：将 CodeGraph 的代码事实与仓库中的架构意图编译为任务上下文、安全变更和可验证 Review。**

这次校正之后，产品结构清晰很多：

```text
CodeGraph
= 必须依赖的代码智能底座

ArchContext
= 真正需要自研的架构语义与 Agent Runtime

LikeC4
= 可选的人类可视化输出

GitHub App
= 治理与收费入口
```

[1]: https://github.com/colbymchenry/codegraph/blob/main/README.md?utm_source=chatgpt.com "codegraph/README.md at main · colbymchenry/codegraph · GitHub"
[2]: https://github.com/likec4/likec4/blob/main/packages/likec4/README.md?utm_source=chatgpt.com "likec4/packages/likec4/README.md at main · likec4/likec4 · GitHub"
