# Deferred Goal Ledger

> **Status**: Backlog
> **Updated**: (archive-workflow)
> **Scope**: Medium/long-term goals deferred from active plan execution

Current plan tasks live in the active plan's `## Task Breakdown`.
Do not duplicate that execution checklist here. Record only work intentionally deferred beyond this slice, with the tradeoff and revisit trigger.

## Deferred Goals

| Goal | Why Deferred | Tradeoff | Revisit Trigger |
|------|--------------|----------|-----------------|
| Design partner / opt-in beta / team collaboration rollout | 当前发布目标收窄到个人用户可安装、可本地 no-cloud 使用；合作 rollout 需要跨账号/跨组织 cohort、观察窗口和支持流程，超出当前 slice | 个人用户 Beta 可以先闭环；暂不声明 design partner 灰度、opt-in beta 或多人协作 verified | 个人用户 Launch Gate 通过后，重新批准 collaboration scope，并准备真实 design partner installation、至少 1 天观察数据、opt-in beta installation 和支持/回滚 telemetry |
| Production GA external readback（部署端点 / Directory / provider delivery / capture / security scan） | 当前机器没有已部署 production/staging endpoint、GPT App Directory 证据、真实 provider delivery 证据、外部 packet capture 或外部 security scan | Sprint 1-4 只能声明 repo-local deterministic 完成；不得宣称 production GA verified | 配置 `ARCHCONTEXT_PRODUCTION_BASE_URL` 或 staging URL，并提交 Directory/provider/capture/security-scan 证据后，跑 `bun run readback:ga`、`node scripts/privacy-capture-manifest.mjs readback --require-external`、`node scripts/security-scan-manifest.mjs readback --require-external` |
| Embedding / Vector 检索（默认关闭） | Sprint 4 eval 未显示相对 FTS5 的明确胜出 | 继续使用 FTS5 + CodeGraph；embedding 保持 off，不引入本地向量索引或混合检索复杂度 | 新代表性 eval 显示 embedding 同时满足 ADR-0033 决策门：context recall lift、constraint recall lift、irrelevant ratio、tool-call 不回退 |
| Git-authority focus totals 的增量化 | 当前 focused Explorer 输出与 source-read budget 已有边界，但 totals 仍遍历完整 Git graph；本次发布不声明所有 Git-authority 写读路径具备广义 10x bounded latency | 结果与 authority correctness 不受影响；超大图下首先增加读取延迟与内存峰值 | 代表性 Git graph 达到 100k nodes/relations，或 focus totals p95 超出 Explorer benchmark budget 时，由 `packages/local-runtime/local-store-sqlite` / runtime-daemon owner 切增量 totals 索引 |
| Evidence current-state fold 的增量化 | event append 目前为构建 current evidence state 执行全量 fold；本次发布优先保证 append-only migration history 与事务正确性 | evidence history 增长后，append 锁持有时间与延迟会线性增加；不影响已提交状态正确性 | 单 scope evidence events 达到 100k，或 append p95 超过 50ms 时，由 `packages/local-runtime/local-store-sqlite` owner 引入 snapshot-anchored fold checkpoint |
| Derived architecture feed 异步 drain | post-commit drain 已保证失败不会把 durable mutation 误报为失败，且未 ack feed 可在后续读路径重放；本次不扩大为独立 worker lifecycle | 大 backlog 会增加 mutation latency，但不再破坏 correctness；当前不声明广义 10x write latency | 单次待消费 feed 超过 10k records，或 mutation p95 超过 100ms 时，由 runtime-daemon owner 将 drain 移到受监督的 bounded worker，并保留 checkpoint/replay 不变量 |
