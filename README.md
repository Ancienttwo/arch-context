# ArchContext

> Code with an architect on standby.

ArchContext 是嵌入 Agentic Coding Runtime 的软件架构控制循环。它在任务前编译架构上下文，在开发中检测结构压力，在必要时推动有证据的重构，并在任务完成前同步与验证系统状态。

当前仓库是 ArchContext MVP 的产品、架构与执行契约骨架，并包含 contracts、local runtime、surfaces 和 cloud governance scaffold。

## Product Shape

- Local Core is the product center: one `archctx` install ships CLI, `archctxd`, MCP stdio adapter, local RPC schema, local SQLite migrations, CodeGraph adapter compatibility, and runtime provenance.
- GitHub App is optional governance. It handles installation metadata, PR lifecycle events, Challenge, Attestation verification, and Check delivery. It does not clone repositories, read PR files, run review, or host an LLM provider.
- Developer and organization results are separate: `ArchContext / Developer Review` is developer-attested; `ArchContext / Organization Runner` is customer-runner-attested and is the only context intended for organization required checks.

## Repository Map

- `docs/spec.md`: 稳定产品真值。
- `plans/prds/20260619-2039-archcontext.prd.md`: ArchContext PRD v2.0。
- `plans/prds/20260620-0236-archcontext-local-github-governance.prd.md`: Local product and GitHub governance follow-up PRD.
- `plans/sprints/archctx-local-github-governance-sprint.md`: Follow-up governance execution checklist.
- `plans/sprints/archctx-sprint.md`: MVP M0-M6 执行 backlog。
- `docs/researches/`: 研究资料与历史 PRD 基线。
- `docs/architecture/`: 架构索引、图表和后续快照入口。
- `packages/contracts/`: M0 契约类型、Envelope、Digest、路径守卫和最小 JSON Schema validator。
- `AGENTS.md` / `CLAUDE.md`: Codex 与 Claude 的根工作契约。

## Current State

- Repo-harness workflow/context/task gates are initialized.
- CodeGraph project index is initialized for source navigation.
- `bun test` and `bun run verify` are the current local code gates.
- Repo-harness runtime helpers come from the global `repo-harness` CLI; local generated wrappers under `scripts/` are ignored compatibility files and may be absent. Use `repo-harness run <helper>`.
