# Deferred Goal Ledger

> **Status**: Backlog
> **Updated**: 2026-06-20
> **Scope**: Medium/long-term goals deferred from active plan execution

Current plan tasks live in the active plan's `## Task Breakdown`.
Do not duplicate that execution checklist here. Record only work intentionally deferred beyond this slice, with the tradeoff and revisit trigger.

## Deferred Goals

| Goal | Why Deferred | Tradeoff | Revisit Trigger |
|------|--------------|----------|-----------------|
| Design partner / opt-in beta / team collaboration rollout | 当前发布目标收窄到个人用户可安装、可本地 no-cloud 使用；合作 rollout 需要跨账号/跨组织 cohort、观察窗口和支持流程，超出当前 slice | 个人用户 Beta 可以先闭环；暂不声明 design partner 灰度、opt-in beta 或多人协作 verified | 个人用户 Launch Gate 通过后，重新批准 collaboration scope，并准备真实 design partner installation、至少 1 天观察数据、opt-in beta installation 和支持/回滚 telemetry |
| Production GA external readback（部署端点 / Directory / provider delivery / capture / security scan） | 当前机器没有已部署 production/staging endpoint、GPT App Directory 证据、真实 provider delivery 证据、外部 packet capture 或外部 security scan | Sprint 1-4 只能声明 repo-local deterministic 完成；不得宣称 production GA verified | 配置 `ARCHCONTEXT_PRODUCTION_BASE_URL` 或 staging URL，并提交 Directory/provider/capture/security-scan 证据后，跑 `bun run readback:ga`、`node scripts/privacy-capture-manifest.mjs readback --require-external`、`node scripts/security-scan-manifest.mjs readback --require-external` |
| Embedding / Vector 检索（默认关闭） | Sprint 4 eval 未显示相对 FTS5 的明确胜出 | 继续使用 FTS5 + CodeGraph；embedding 保持 off，不引入本地向量索引或混合检索复杂度 | 新代表性 eval 显示 embedding 同时满足 ADR-0033 决策门：context recall lift、constraint recall lift、irrelevant ratio、tool-call 不回退 |
