对，这才是 **ArchContext 最有价值的产品命题**：

> **把软件工程知识编译进 Agent 的开发 SOP，让没有架构经验的开发者，也能持续演进一个复杂的软件产品。**

它不是让用户“更容易写架构文档”，因为绝大多数 Vibe Coding 用户根本不想维护这些文档，也不知道：

* 什么时候应该拆分模块
* 哪些依赖是不合理的
* 什么时候需要 ADR
* 数据应该归哪个模块负责
* 一次修改会影响哪些功能
* 为什么项目越做越难改
* Agent 下一次对话需要知道哪些历史决策

ArchContext 应该让这些事情**自动发生**。

## 真正解决的问题

Vibe Coding 的早期体验通常很好：

```text
需求
  ↓
Agent 生成代码
  ↓
应用可以运行
```

当项目变大后，问题开始出现：

```text
Agent 不知道旧决策
模块责任逐渐重叠
同一功能被实现多次
数据库被任意模块访问
修改一个功能破坏另一个功能
每个新会话重新理解代码库
架构文档落后于代码
开发速度随着规模增长而下降
```

问题不一定是 Agent 不会写代码，而是缺少一个持续存在的软件工程控制层。

所以产品关系应该是：

```text
Coding Agent
= 编写和修改软件

CodeGraph
= 理解现有代码事实

ArchContext
= 维持系统在长期演进中的一致性
```

更准确地说：

> **CodeGraph 让 Agent 看见代码；ArchContext 让 Agent 记得系统，并知道下一步应该怎样安全地改变它。**

---

# ArchContext 不应该要求用户“学习架构”

这是产品设计的关键。

错误体验：

```text
请创建 domain.yaml
请定义 component boundaries
请填写 dependency policy
请维护 ADR
请更新 architecture graph
```

这只是把架构师的工作转交给了一个不懂架构的用户。

正确体验应该是：

```text
用户：
“帮我增加订阅付款功能。”

Agent：
开始开发。

ArchContext 自动：
- 找到用户、订阅、付款相关代码
- 建立任务级架构上下文
- 识别新增的系统职责
- 检查付款数据边界
- 记录服务间依赖
- 必要时生成架构决策
- 更新架构状态
- 完成前执行一致性检查
```

用户不需要知道：

```text
Architecture Node
Architecture Edge
C4 Container
Bounded Context
Dependency Inversion
ADR
Conformance Rule
```

除非出现必须由人决定的问题。

---

# 面向非专家的 Human Gate

当确实需要用户决定时，也不应该向用户展示底层 YAML。

例如不要问：

> 是否批准新增 `service.order -> datastore.payment-db` 的 `reads` Edge？

应该问：

> 订单功能现在会直接读取付款数据库。
> 这会让订单和付款模块紧密绑定。
>
> 推荐方案：订单模块通过付款接口查询状态。
> 是否按推荐方案修改？

提供三个选项：

```text
1. 使用推荐边界
2. 保留当前实现并记录为例外
3. 让我查看详细技术说明
```

也就是说，ArchContext 需要把软件架构决策翻译成用户能理解的：

* 产品责任
* 数据所有权
* 风险
* 长期维护成本
* 可逆性

而不是要求用户成为软件架构师。

---

# Progressive Architecture

简单项目不应该一开始就生成几十个架构文件。

ArchContext 应随着产品复杂度逐步增加治理。

## Level 0：简单网页

```text
一个前端
少量 API
一个数据库
```

ArchContext 只维护：

```text
项目目标
主要功能
关键目录
外部服务
数据存储
少量约束
```

## Level 1：完整应用

```text
认证
付款
后台任务
第三方集成
多个业务模块
```

ArchContext 自动增加：

```text
模块责任
数据所有权
接口关系
安全边界
重要 ADR
```

## Level 2：复杂产品

```text
多个应用
多个服务
异步事件
复杂权限
多人或多 Agent 开发
```

ArchContext 开始维护：

```text
Domain Boundary
Public Interface
Event Contract
Cross-module Policy
Change Impact
Architecture Review
```

## Level 3：规模化系统

```text
多个 Repository
多个团队
独立部署
合规要求
```

再引入：

```text
跨仓库关系
团队所有权
可信 Runner
组织策略
强制 GitHub Gate
```

核心原则是：

> **架构治理的复杂度不能高于当前产品本身的复杂度。**

---

# 这意味着 Schema 必须支持渐进式建模

不应该要求每个项目从第一天就完整描述：

```text
Domain
System
Service
Component
Interface
Data Store
Deployment
Policy
ADR
```

最小合法模型可以只有：

```yaml
schemaVersion: 1

product:
  name: My App
  purpose: Help users manage personal tasks

modules:
  - id: app
    source:
      - src/**
```

随着代码发展，ArchContext 自动建议扩展：

```yaml
modules:
  - id: web
    responsibility:
      - user-interface

  - id: api
    responsibility:
      - application-api

  - id: billing
    responsibility:
      - subscription-management

dataStores:
  - id: primary-db
    owner: api
```

只有当真正需要时，才提升成更严格的架构模型。

这更像数据库的 Schema Evolution，而不是要求用户一次性完成架构设计。

---

# 你的核心产品不是文档，而是“软件工程状态”

文档只是其中一个输出。

ArchContext 真正维护的是：

```text
产品有什么能力
代码由哪些模块组成
每个模块负责什么
数据属于谁
模块之间如何交互
哪些关系被允许
为什么作出某些决策
当前代码是否符合这些决策
当前任务改变了什么
下一次 Agent 必须知道什么
```

内部可以表现成结构化模型，但用户看到的是：

```text
当前任务上下文
开发计划约束
风险提示
架构变更摘要
任务完成检查
```

Markdown、YAML、图表和 ADR 都是投影。

因此产品价值不应描述为：

> 自动维护架构文档。

而应该描述为：

> **在产品不断增长时，让 Agent 保持对系统的长期理解。**

---

# 真正的用户旅程

## 第一次使用

```text
$ archctx init
```

ArchContext 自动：

1. 调用 CodeGraph 索引项目。
2. 识别框架、入口、数据库和外部服务。
3. 推导初始模块。
4. 生成最小架构状态。
5. 让用户确认三到五个产品级问题。
6. 安装对应 Coding Agent 的 Hook、Skill 或 MCP。
7. 从此进入开发 SOP。

用户可能只需要回答：

```text
这个项目主要做什么？
谁是主要用户？
付款功能是否涉及真实资金？
哪些目录是生成代码？
```

而不是填写一套架构模板。

## 日常开发

用户输入：

> 增加团队协作功能。

Runtime 自动执行：

```text
Prepare
→ 告诉 Agent 当前用户、权限、数据模型和相关约束

Implement
→ Agent 编码

Evaluate
→ 检测新增成员关系、权限规则和通知依赖

Synchronize
→ 更新模块责任、数据关系和决策

Verify
→ 检查越权、循环依赖和文档漂移
```

用户只看到必要结果：

```text
团队协作功能已实现。

架构变化：
- 新增 Team Membership 数据模型
- 权限检查现在由 Authorization 模块负责
- Notification 模块新增成员邀请事件

需要你决定：
邀请链接是否在 24 小时后失效？
```

---

# 产品真正提供的是“隐形资深工程师”

这可能是最容易被市场理解的表达：

> **你的 Agent 会写代码，ArchContext 负责让它像一个资深工程团队那样持续开发。**

或者：

> **The software-engineering layer for vibe coding.**

更完整的英文定位：

> **ArchContext embeds software-engineering discipline into agentic coding workflows, so developers can grow a simple app into a complex product without manually managing architecture.**

中文：

> **ArchContext 将软件工程方法嵌入 Agent 开发流程，让开发者无需手工维护架构，也能将简单应用持续演进为复杂产品。**

---

# 与 CodeGraph 的准确关系

可以用这组语言：

```text
CodeGraph is reactive code intelligence.
ArchContext is proactive engineering guidance.
```

但“CodeGraph 是工作”可能更准确表达为：

```text
CodeGraph 是 Agent 的代码感知能力。
ArchContext 是 Agent 开发 SOP 中的架构步骤。
```

运行关系：

```text
Agent 接收任务
  ↓
ArchContext 决定需要理解什么
  ↓
调用 CodeGraph 获取代码事实
  ↓
ArchContext 编译任务上下文
  ↓
Agent 开发
  ↓
ArchContext 再次调用 CodeGraph 检查变化
  ↓
决定继续、同步、询问或阻止
```

所以 CodeGraph 不是一个和 ArchContext 并列展示给用户的工具。

对用户而言：

```text
用户只安装和使用 ArchContext
ArchContext 内部使用 CodeGraph
```

甚至 MCP 中都不必暴露 CodeGraph 的存在，除非调试或高级模式。

---

# 真正困难、也是护城河的部分

最难的不是调用 CodeGraph，也不是生成 YAML，而是让系统可靠完成以下判断：

```text
哪些代码变化属于实现细节？
哪些代码变化属于架构变化？
哪些变化可以自动接受？
哪些变化违反现有意图？
哪些问题必须询问用户？
如何向非专家解释一个架构决策？
如何避免随着时间积累错误的架构事实？
如何让下一次 Agent 使用最小但完整的上下文？
```

这需要建立一套明确的决策分类。

## 自动接受

```text
文件移动但模块责任未改变
内部函数重构
私有实现依赖变化
已有接口的实现更新
```

## 自动同步

```text
新增明确属于现有模块的组件
新增现有模块内部的数据实体
新增符合既有规则的外部 API Client
```

## 询问用户

```text
业务责任从一个模块转移到另一个模块
新的核心领域出现
公开接口发生破坏性变化
数据所有权变化
重要第三方依赖被引入
```

## 阻止流程

```text
权限边界被绕过
模块直接访问他人数据
违反明确的安全约束
未解决的高风险架构冲突
架构状态与当前代码无法对齐
```

这个“自动化决策边界”比架构文件格式重要得多。

---

# 产品北极星指标

不应该只追踪：

```text
生成了多少文档
创建了多少架构节点
调用了多少 MCP Tool
```

更有意义的指标是：

```text
Agent 首次任务上下文准备成功率
无需用户参与完成的架构同步比例
Agent 在后续任务中复用历史决策的比例
架构问题在 Commit 前被发现的比例
随着 Repository 增长，任务完成时间是否保持稳定
用户需要回答的技术问题数量
因错误架构上下文导致的回滚率
```

最强的产品验证是：

> 一个非专业开发者维护同一个项目六个月后，新的 Agent Session 仍能快速、正确地修改系统，而不是重新理解或继续堆积混乱。

---

# 最终产品定义

我会将产品正式定义为：

> **ArchContext 是嵌入 Agentic Coding Runtime 的软件架构控制循环。它利用 CodeGraph 感知代码，在任务开始前准备上下文，在开发过程中判断架构影响，在必要时同步系统状态，并在任务完成前验证一致性。**

对普通用户则只说：

> **从第一个页面到复杂产品，让你的 Agent 始终知道系统应该怎样工作。**

一个很适合首页的组合是：

## **Build beyond the prototype.**

> ArchContext gives coding agents the software-engineering context needed to grow a simple app into a maintainable product.

中文：

## **不止做出原型。**

> ArchContext 把软件工程能力交给你的 Coding Agent，让简单应用可以持续成长为可维护的复杂产品。
