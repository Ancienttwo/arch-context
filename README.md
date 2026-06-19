# ArchContext

> Code with an architect on standby.

ArchContext 是嵌入 Agentic Coding Runtime 的软件架构控制循环。它在任务前编译架构上下文，在开发中检测结构压力，在必要时推动有证据的重构，并在任务完成前同步与验证系统状态。

当前仓库是 ArchContext MVP 的产品、架构与执行契约骨架，并包含 M0 `contracts` 包的最小启动代码。

## Repository Map

- `docs/spec.md`: 稳定产品真值。
- `plans/prds/20260619-2039-archcontext.prd.md`: ArchContext PRD v2.0。
- `plans/sprints/archctx-sprint.md`: MVP M0-M6 执行 backlog。
- `docs/researches/`: 研究资料与历史 PRD 基线。
- `docs/architecture/`: 架构索引、图表和后续快照入口。
- `packages/contracts/`: M0 契约类型、Envelope、Digest、路径守卫和最小 JSON Schema validator。
- `AGENTS.md` / `CLAUDE.md`: Codex 与 Claude 的根工作契约。

## Current State

- Repo-harness workflow/context/task gates are initialized.
- CodeGraph project index is initialized; current index has zero files because the repo is documentation-first.
- `bun test` and `bun run verify` are the current local code gates.
- Runtime helper wrappers under `scripts/` are local generated compatibility files and are ignored by Git.
