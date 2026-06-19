完全正确。这把 ArchContext 的核心从“架构记忆”又推进了一层：

> **ArchContext 不只负责告诉 Agent 系统现在是什么，还要在关键节点主动打断局部修补，推动 Agent重新判断系统应该变成什么。**

Codex 这类 Agent 的保守行为，表面上像谨慎，机制上其实是**局部最优**：

```text
不知道真实外部契约
不知道哪些历史代码可以删除
不知道当前结构是不是临时状态
不知道团队是否接受大规模修改
不知道重构后的目标模型
```

在这些信息缺失时，最安全的动作自然是：

```text
保留旧接口
新增一层 wrapper
增加 fallback
同时支持新旧字段
复制一套逻辑
避免改动调用方
```

单次任务看起来风险最低，连续十次以后就变成：

```text
V1 / V2 并存
legacy adapter
compatibility helper
deprecated 但不能删除
多个生命周期 owner
一处修改需要同步五个路径
```

所以真正的问题不是“Agent 不会重构”，而是：

> **Agent 没有足够的系统证据、目标状态和决策授权，无法证明重构比打补丁更安全。**

## `geju` 的价值在哪里

这个 Skill 的关键不是“鼓励大胆”，而是把大胆判断组织成了一套可验证的方法：

* 先定义正确目标，而不是从最小补丁开始。
* 把当前实现、迁移困难和兼容恐惧视为需要定价的约束。
* 区分真实契约与历史惯性。
* 明确指出应该删除、合并、拆分或重塑什么。
* 将干净目标与迁移路径分开。
* 给出第一个证明点、证伪条件和收益账单，而不是鲁莽地直接重写。([GitHub][1])

尤其值得吸收的是它对约束的分类：

```text
真实约束
├── 公开 API
├── 持久化数据
├── 已文档化集成
├── 用户承诺
├── 部署约束
└── 合规要求

不足以阻止重构的理由
├── 内部调用方很多
├── 旧包结构已经存在
├── 历史命名使用很久
├── 半成品实现已经写了
└── Diff 看起来很大
```

这应该成为 ArchContext 的**运行时决策规则**，而不仅是一段 Prompt。`geju` 还明确要求默认不保留无真实契约支撑的兼容 shim，并把目标设计和迁移方案分开。([GitHub][1])

# ArchContext 应该把“格局”变成自动 SOP

`geju` 是一种思考姿态。

ArchContext 应该把这种姿态变成：

> **何时触发、用什么证据判断、如何执行、如何验证、什么时候必须清理旧路径的工程控制循环。**

完整 SOP 应该是：

```text
任务进入
  ↓
编译架构上下文
  ↓
检测结构压力
  ↓
决定：
  ├── 局部修改
  ├── 自动结构调整
  ├── 架构重构
  └── 先做证明性实验
  ↓
给出目标状态
  ↓
审计真实约束
  ↓
生成迁移方案
  ↓
Agent 实现
  ↓
验证目标状态
  ↓
删除临时兼容路径
  ↓
同步架构状态
```

重点在于：**不是让 Agent 每次都大胆重构，而是让它在必要时有证据地大胆。**

# 两个关键指标：结构压力与重构信心

ArchContext 可以在内部维护两个判断。

## 1. Architecture Pressure

表示继续打补丁的代价是否已经超过重构。

信号可以来自 CodeGraph 和历史任务：

```text
同一个业务概念存在多个名称
同一个生命周期存在多个 owner
出现纯透传 wrapper
同一依赖存在新旧两条路径
模块跨边界直接读写数据
新增代码不断修改同一个热点区域
多个任务反复绕过同一个结构问题
调用链或依赖环持续增长
旧接口已无真实消费者但仍然保留
一个简单需求需要修改大量不相关模块
```

## 2. Refactor Confidence

表示 Agent 是否具备足够证据执行重构。

```text
调用方是否已被 CodeGraph 完整识别
公开接口是否已盘点
持久化数据迁移是否明确
测试是否覆盖关键行为
架构目标是否明确
回滚点是否清楚
是否能够在一个小范围先证明方向
```

将两者组合：

| 结构压力 | 重构信心 | 动作                   |
| ---- | ---- | -------------------- |
| 低    | 低或高  | 正常局部开发               |
| 高    | 低    | 不继续缝补；先做 Proof Point |
| 低    | 高    | 不为重构而重构              |
| 高    | 高    | 主动推荐或执行结构性重构         |

这就避免了两个极端：

```text
Codex 式过度保守
Agent 式无脑重写
```

# 在任务开始时返回“修改姿态”

`archcontext_context` 不应该只返回相关文件和 ADR，还应该告诉 Agent当前应采用什么工程姿态：

```json
{
  "task": "统一订阅状态和付款状态处理",
  "mode": "refactor",
  "architecturePressure": "high",
  "refactorConfidence": "medium",
  "reason": [
    "subscription lifecycle currently has two owners",
    "three compatibility paths have no external consumers",
    "the same state transition exists in four modules"
  ],
  "targetState": {
    "owner": "module.subscription",
    "singleLifecycle": true,
    "publicContract": "interface.subscription-status"
  },
  "realConstraints": [
    "existing persisted subscription_status values",
    "public webhook payload consumed by two integrations"
  ],
  "inheritedConstraints": [
    "internal SubscriptionManagerV1 callers",
    "legacy package naming",
    "deprecated status mapper"
  ],
  "killList": [
    "SubscriptionManagerV1",
    "legacyStatusMapper",
    "dual write to plan_state"
  ],
  "firstProofPoint": {
    "scope": "move one complete state transition to the new owner",
    "success": "all callers pass through one lifecycle implementation"
  },
  "falsifiers": [
    "an untracked external consumer requires the legacy payload",
    "current data cannot be migrated without downtime"
  ]
}
```

Agent 得到的不是一句“考虑重构”，而是：

```text
为什么需要重构
最终目标是什么
什么可以删除
什么必须兼容
应该先证明什么
什么证据会推翻这个方向
```

这才会真正改变 Agent 行为。

# 兼容性代码必须“持证上岗”

这是 ArchContext 可以非常鲜明的一条产品规则：

> **任何兼容层都必须绑定一个真实契约、移除条件和过期时间。**

例如：

```yaml
compatibilityContract:
  id: compat.subscription-webhook-v1
  protects:
    type: external-integration
    consumers:
      - partner.acme
      - partner.example

  legacyPath:
    - src/subscription/webhook-v1.ts

  removalCondition:
    remainingConsumers: 0

  owner: integration.subscription
  expiresAfter: 2026-09-30
  migrationIssue: GH-482
```

下面这种理由不合法：

```yaml
reason: "为了安全起见先保留"
```

合法理由必须能回答：

```text
保护谁？
保护什么公开契约？
谁负责迁移？
怎样判断可以删除？
最迟什么时候重新审查？
```

ArchContext Review 可以直接失败：

```text
Unjustified Compatibility Path

legacyStatusMapper was introduced in this change,
but no public API, persisted data, documented integration,
deployment constraint or user commitment was identified.

Recommended action:
Update internal callers and remove the compatibility mapper.
```

这会显著压制技术债的无意识积累。

# 必须把“目标状态”和“迁移状态”分开

Agent 经常出现一个问题：

> 因为迁移必须分阶段，所以把中间状态误当成了最终架构。

例如：

```text
最终目标：
一个 Subscription 生命周期 owner

分阶段迁移：
暂时双写旧状态与新状态

错误结果：
双写成为永久架构
```

ArchContext Schema 应明确区分：

```yaml
targetState:
  lifecycleOwner: module.subscription
  statusStore: datastore.subscription

migrationState:
  temporaryDualWrite: true
  remainingConsumers: 3

completionCriteria:
  - remainingConsumers == 0
  - oldColumnReadCount == 0
  - oldStatusMapperDeleted == true
```

Review 不能只检查“代码能不能运行”，还要检查：

```text
迁移有没有继续推进
临时路径有没有超期
旧概念有没有删除
当前实现距离目标状态还有多远
```

否则每次 Agent 都会说：

> 先保留兼容路径，后续再清理。

而“后续”永远不会发生。

# 新增一个一等对象：Architecture Intervention

ADR 记录的是已经接受的重要决定，但不足以管理重构过程。

建议 ArchContext 增加：

```text
Architecture Intervention
```

Schema 可以是：

```yaml
schemaVersion: 1
id: intervention.subscription-lifecycle-unification

status: proposed
trigger:
  task: unify-subscription-state
  pressure: high
  signals:
    - duplicate-lifecycle-owner
    - unjustified-compatibility-path
    - repeated-hotspot-change

thesis:
  module.subscription should become the only owner
  of the subscription lifecycle.

targetState:
  owners:
    subscriptionLifecycle: module.subscription
  removedConcepts:
    - SubscriptionManagerV1
    - legacyStatusMapper
    - plan_state

constraints:
  real:
    - persisted-status-values
    - public-webhook-v1
  inherited:
    - internal-v1-callers
    - legacy-package-layout

options:
  conservative:
    decision: reject
    reason: adds another compatibility layer

  clean:
    decision: target
    reason: correct final model

  staged:
    decision: recommended
    reason: reaches clean target while migrating persisted data

proofPoint:
  description: migrate cancellation transition end-to-end
  successCriteria:
    - one lifecycle owner
    - all tests pass
    - no fallback path

falsifiers:
  - untracked external consumer of internal API
  - migration requires unacceptable downtime

cleanup:
  required:
    - delete SubscriptionManagerV1
    - delete legacyStatusMapper
    - remove plan_state column
```

这不是给普通用户填写的，而是 Runtime 生成和维护的。

# Agentic Runtime 中应有三种模式

## Normal Mode

适合真正局部的修改：

```text
内部实现
样式调整
小型 Bug
不改变责任和依赖
```

## Structural Mode

允许 Agent 自动进行有限结构调整：

```text
重命名内部概念
移动内部调用方
删除无消费者 wrapper
合并重复 helper
调整模块内边界
```

不需要用户逐项批准。

## Intervention Mode

遇到以下情况自动触发：

```text
数据 owner 变化
核心模块责任变化
公开接口变化
跨模块依赖重组
长期兼容路径
重复架构失败
现有设计明显无法支持下一阶段产品
```

这时 Agent 必须先给出：

```text
目标模型
Kill List
真实约束
迁移路径
Proof Point
Falsifier
收益账单
```

这正是 `geju` 的原则，但由 ArchContext 根据代码和架构状态自动触发，而不是等待用户说“格局打开一点”。该 Skill 本身也要求在讨论过度保守、过度兼容或被重构难度绑架时主动触发，而非只能由明确命令调用。([GitHub][1])

# 不要把 `geju` 作为核心外部依赖

它非常适合作为设计参考和可选 Skill，但 ArchContext 不能把这项能力只放在 Prompt 中。

推荐关系：

```text
geju Skill
= 高质量的推理与输出姿态

ArchContext
= 触发机制、事实输入、状态模型、执行控制和完成验证
```

可以支持：

```text
内置策略：
architecture-reframe

可选表达层：
geju
```

也就是说：

```text
ArchContext 判断现在需要一次高位重构判断
        ↓
生成真实约束、结构压力、CodeGraph 证据
        ↓
可调用 geju 组织 Thesis、Kill List 和验证路径
        ↓
结果写回 Architecture Intervention
        ↓
ArchContext 负责执行、跟踪和清理
```

即使用户没有安装 `geju`，核心能力也必须存在。

# CodeGraph 在这里的真正价值

CodeGraph 不只是帮助 Agent 查代码，而是帮助它回答那些决定“敢不敢重构”的问题：

```text
这个内部接口到底有哪些调用方？
旧 wrapper 是否真的还有消费者？
这两个实现是否承载同一个职责？
删除这个模块会影响哪些路径？
新旧数据路径分别在哪里被读取？
重构的最小可验证切片是什么？
```

因此关系可以进一步定义为：

```text
CodeGraph
= 重构证据系统

ArchContext
= 重构判断与控制系统
```

没有 CodeGraph，Agent只能凭感觉大胆。

只有 CodeGraph，没有 ArchContext，Agent又往往只会被动查找，不会主动判断“现在应该重构”。

二者组合后才是：

> **有证据的架构勇气。**

# 这应成为 ArchContext 的核心卖点

之前的表达：

> Architecture context that stays current.

还不够强。

更准确的产品定义是：

> **ArchContext gives coding agents the context and authority to make the right structural change—not just the smallest safe patch.**

中文：

> **ArchContext 让 Coding Agent 不只会打最安全的小补丁，而能在正确的节点，有依据地完成必要的结构性改变。**

首页甚至可以更直接：

## **Stop patching. Keep evolving.**

> ArchContext gives your coding agent the architectural context to know when a patch is enough—and when the system needs to change.

中文：

## **不再缝缝补补，让产品持续进化。**

> ArchContext 让 Agent 知道什么时候应该局部修改，什么时候必须重构，以及如何安全抵达正确的目标架构。

这比“自动维护架构文档”更接近真正的产品护城河。

[1]: https://github.com/hylarucoder/hai-stack/blob/main/skills/geju/SKILL.zh_CN.md "hai-stack/skills/geju/SKILL.zh_CN.md at main · hylarucoder/hai-stack · GitHub"
