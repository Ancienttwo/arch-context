# ArchContext

[English](README.md) | [简体中文](README.zh-CN.md)

> 写代码，架构师随时待命。

ArchContext 是嵌入 Agentic Coding Runtime 的软件架构控制循环。它在任务前编译架构上下文，在开发中检测结构压力，在必要时推动有证据的重构，并在任务完成前同步与验证系统状态。

当前仓库是 ArchContext MVP 的产品、架构与执行契约骨架，并包含 contracts、local runtime、surfaces 和 cloud governance scaffold。

## 产品形态

- Local Core 是产品的核心：一次 `archctx` 安装即可提供 CLI、`archctxd`、MCP stdio adapter、本地 RPC schema、本地 SQLite migrations、CodeGraph adapter 兼容性，以及运行时溯源。
- GitHub App 是可选的治理层，负责安装元数据、PR 生命周期事件、Challenge、Attestation 验证与 Check 投递；它不克隆仓库、不读取 PR 文件、不执行 review，也不承载 LLM provider。
- 开发者与组织两条结果线彼此独立：`ArchContext / Developer Review` 由开发者 attest；`ArchContext / Organization Runner` 由客户侧 runner attest，是唯一适用于组织 required checks 的 context。

## ChangeSet 与 Ledger 完整性

- ChangeSet apply 全程 fail-closed：无效 model 会被拒绝并回滚，而不是照常提交；文件写入意图会先于任何破坏性 rename 写入 journal；draft 的 precondition 会比对宣告的 HEAD/worktree/model base digest；ledger append 与 journal commit 共享同一个 SQLite transaction（`PRAGMA synchronous=FULL`）。
- `.archcontext/` 下的写入由 realpath 父目录解析围堵，symlink 写入目标无法逃出仓库范围；ledger 持久化层执行统一的 privacy gate，secret 样式、raw diff 或自由文本 payload 会在落库前被拒绝。
- `ledger project` 与 rollback 和其他写入一样走同一条 ChangeSet journal；ledger 到 YAML 的 round trip 会保留 schema 宣告字段，而不是把它们塞进不透明的 `metadata` blob。
- ledger 的 state、replay、FTS 与 snapshot 均按完整的 worktree cursor（repository、worktree、branch、HEAD、digest）分区，append 时强制执行 base/resulting graph digest 的 CAS；崩溃恢复按 journal entry 逐条隔离，启动时的 cleanup 工作量每次运行都有界。

## Practice Assets 信任边界

ArchContext Practice Assets v1 刻意区分两类输入：

- Static Practice Assets: 随产品发布的带版本 YAML 资产，加上 `.archcontext/practices/`
  下显式声明的 repo overlay。它们是确定性的、经过溯源核验、打包进 npm tarball，
  并可通过 `archctx practices list/show/validate/sources` 离线使用。
- Dynamic Documentation References: 可选的 Context7 资源，只能通过显式的
  `archctx docs resolve|pin|fetch` 命令加 `--allow-network` 获取。它们作为外部、
  未经核验、仅供参考的资源被缓存，不能构成 complete 阶段的强制项。

Local Core 运行 practice matching、checkpoint、complete 或 MCP 都不需要 GitHub App、
ArchContext Cloud、LLM provider 或 Context7。默认情况下不会有源码正文、diff、prompt、
模型输出、secret 或未脱敏路径被发往任何 documentation provider。repo practice 撰写、
enforcement 升级、waiver、hook、Context7 pinning、source 更新、rollout 与 rollback
操作见 `docs/runbooks/practice-assets-v1.md`。

## 仓库地图

- `docs/spec.md`: 稳定产品真值。
- `docs/runbooks/local-core-quickstart.md`: Local Core 首次运行路径。
- `docs/runbooks/practice-assets-v1.md`: Practice Assets v1 的资产撰写、隐私、
  rollout 与 rollback 操作。
- `plans/prds/20260619-2039-archcontext.prd.md`: ArchContext PRD v2.0。
- `plans/prds/20260620-0236-archcontext-local-github-governance.prd.md`: 本地产品与 GitHub 治理的后续 PRD。
- `plans/sprints/archctx-local-github-governance-sprint.md`: 治理后续工作的执行 checklist。
- `plans/sprints/archctx-sprint.md`: MVP M0-M6 执行 backlog。
- `docs/researches/`: 研究资料与历史 PRD 基线。
- `docs/architecture/`: 架构索引、图表和后续快照入口。
- `packages/contracts/`: M0 契约类型、Envelope、Digest、路径守卫和最小 JSON Schema validator。
- `AGENTS.md` / `CLAUDE.md`: Codex 与 Claude 的根工作契约。

## 当前状态

- Repo-harness 的 workflow/context/task gate 已完成初始化。
- CodeGraph 项目索引已建立，用于源码导航。
- `bun test` 与 `bun run verify` 是目前本地的 code gate。
- Repo-harness 的 runtime helper 来自全局 `repo-harness` CLI；`scripts/` 下本地生成的 wrapper 属于被忽略的兼容文件，可能不存在。请使用 `repo-harness run <helper>`。
