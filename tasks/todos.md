# Deferred Goal Ledger

> **Status**: Backlog
> **Updated**: 2026-06-20
> **Scope**: Medium/long-term goals deferred from active plan execution

Current plan tasks live in the active plan's `## Task Breakdown`.
Do not duplicate that execution checklist here. Record only work intentionally deferred beyond this slice, with the tradeoff and revisit trigger.

## Deferred Goals

| Goal | Why Deferred | Tradeoff | Revisit Trigger |
|------|--------------|----------|-----------------|
| 浏览器 Architecture Explorer（本地只读架构浏览面） | Sprint 3 延后：较重可视化面，且 LikeC4/Structurizr/Mermaid export 已覆盖"看图"需求 | 暂无内置交互式浏览；靠导出的 LikeC4/Structurizr/Mermaid 查看 | Sprint 4；或导出投影无法满足本地交互式浏览需求时 |
| Embedding / Vector 检索（默认关闭） | Sprint 4 eval 未显示相对 FTS5 的明确胜出 | 继续使用 FTS5 + CodeGraph；embedding 保持 off，不引入本地向量索引或混合检索复杂度 | 新代表性 eval 显示 embedding 同时满足 ADR-0033 决策门：context recall lift、constraint recall lift、irrelevant ratio、tool-call 不回退 |
