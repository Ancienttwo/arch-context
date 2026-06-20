# Sprint: ArchContext Local Product + GitHub Governance

> **Status**: Executing — FG1 In Progress
> **Slug**: archctx-local-github-governance  
> **Created**: 2026-06-20  
> **Updated**: 2026-06-20  
> **Source PRD**: `plans/prds/20260620-0236-archcontext-local-github-governance.prd.md`  
> **Parent Sprint**: `plans/sprints/archctx-sprint.md`  
> **Goal Mode**: contract-correction → real integration → staging verification  
> **Default Branch**: `main`  
> **Document Language**: 简体中文  

本 Sprint 将 Follow-up PRD 转化为可执行开发清单。它不继承 Parent Sprint 中以接口、Mock、内存实现或仓库内代理测试获得的“完成”状态。现有实现可以作为起点，但每个条目必须重新满足本文定义的证据成熟度和 Exit Gate。

---

# 1. Sprint 目标

本 Sprint 交付以下完整产品链路：

```text
Local Core
archctx CLI / MCP
        │ local versioned RPC
        ▼
     archctxd
        │
        ├── Git / exact clean worktree
        ├── CodeGraph
        ├── deterministic review
        ├── local persistence
        └── device signer

Optional GitHub Governance
GitHub App webhook
        │
        ▼
Challenge Service ──> Developer Runtime or Customer Runner
        │                          │
        └──────── Attestation <────┘
                    │
                    ▼
             Check Publisher
```

必须达到的产品结果：

1. 用户只安装一个版本一致的本地产品，即可使用 CLI、Daemon 和 MCP Surface；
2. Local Core 在没有 GitHub App、SaaS 和 LLM Provider 时完整工作；
3. GitHub App 是可选治理桥梁，不是代码执行器；
4. Developer Review 与 Organization Runner 使用不同 Check Context 和不同信任语义；
5. ArchContext SaaS 不请求、不处理、不保存源码、Diff、Patch、Symbol 或详细 Review 内容；
6. Organization Runner 由客户控制，required check 不依赖 LLM；
7. 普通单仓库和单仓库 Monorepo 都可使用，Multi-repo 不进入本 Sprint。

---

# 2. 完成口径与证据成熟度

## 2.1 任务状态

| 标记 | 含义 |
|---|---|
| ◻ | 未开始 |
| ◐ | 进行中，或只达到低于目标的证据级别 |
| ☑ | 达到该任务要求的目标证据级别，且证据已提交 |
| ⛔ | 被依赖、风险或产品决策阻塞 |

## 2.2 证据成熟度

| 等级 | 名称 | 最低证据 |
|---|---|---|
| E0 | Specified | PRD、Schema、ADR 或接口已定义并评审 |
| E1 | Implemented | 真实实现及单元测试；不得只包含 Mock 或常量字符串 |
| E2 | Integrated | 跨进程、跨模块或真实依赖集成测试通过 |
| E3 | Staging Verified | 在真实 GitHub App、真实测试仓库、真实 Runner 或真实部署环境完成 readback |
| E4 | Production Verified | 生产灰度、监控、回滚和安全证据完成 |

规则：

- 表中的 `Target` 是任务标记为 ☑ 的最低证据等级；
- `E1` 不得由“类型存在”“内存 Map 可工作”“SQL 字符串存在”替代；
- `E2` 涉及 Daemon 时必须包含独立进程，不接受同一进程内对象调用；
- `E3` 涉及 GitHub 时必须使用真实 GitHub App installation 和真实 Repository；
- 发布 Gate 中指定为 `E4` 的条目不得由 staging 证据替代；
- 每个 ☑ 条目必须在 `docs/verification/` 中有证据链接，或被对应 Milestone Gate 文档引用。

## 2.3 Definition of Done

单个任务只有同时满足以下条件才可标记 ☑：

1. 代码、测试和必要文档在同一 PR 中完成；
2. 失败路径、权限边界和回滚路径已覆盖；
3. 未引入跨包 `../../other-package/src` 导入；
4. Production Composition Root 未注入 Mock；
5. 日志和指标没有源码、Diff、Patch、Symbol、Context 正文或详细 Finding；
6. 对外契约变更包含 Schema Version 与 migration；
7. 对应验证命令可在干净 checkout 中执行；
8. Evidence 文件记录 commit SHA、环境、命令、结果和已知限制。

---

# 3. 范围与非范围

## 3.1 本 Sprint 范围

- Follow-up PRD 的产品文案、ADR、Schema 和状态机修订；
- 单一安装包和薄 CLI/MCP Surface；
- GitHub App 最小权限、Webhook、API Allowlist 和 Privacy Contract；
- Review Challenge v2 与 Attestation v2；
- exact clean worktree 的 Developer Review；
- 客户控制的 GitHub-hosted / self-hosted Organization Runner；
- Challenge、Attestation、Runner Identity 和 Check Delivery 的持久化；
- 真实 GitHub staging 验收；
- 安全、隐私、可靠性、可观测性和发布 Gate。

## 3.2 明确不在范围

- ArchContext 托管 Runner；
- GitHub App 或 SaaS 中配置 LLM Provider；
- 云端 checkout、代码分析、Embedding 或详细 Review 存储；
- Multi-repo 架构图；
- Slack Bot；
- Agent 自动合并 PR；
- 用 LLM 输出直接决定 required check 的 pass/fail；
- 把 Developer Attestation 宣称为不可篡改远程 CI 证明；
- 依赖 `gh` CLI 才能使用 Local Core 或 GitHub App 模式。

---

# 4. Guardrails

1. **Local Core 独立**：没有 GitHub App、Cloud Account 或 LLM 时，`init/sync/context/review/validate/status` 仍可工作。
2. **GitHub App 可选**：安装 App 不能成为本地产品首次运行的前置条件。
3. **不读取代码执行 Review**：GitHub App 和 SaaS 不 checkout、不拉取 PR Files、不请求 Diff/Patch。
4. **最小 GitHub API**：业务层只可调用 `GitHubGovernancePort` 暴露的方法，不得持有通用 Octokit Client。
5. **无云端 LLM**：App、Control Plane 和 Check Publisher 不得加载模型 SDK 或 Provider Credential。
6. **确定性结论**：Check conclusion 只能由确定性 Runtime 规则计算；Agent 不能传入 `pass`。
7. **信任隔离**：`ArchContext / Developer Review` 不能满足要求 Organization Runner 的策略。
8. **精确代码身份**：Attestation 必须绑定 Repository、PR、Head、Base、Tree、Policy、Model、Runtime Build 和一次性 Nonce。
9. **干净执行树**：GitHub Check 只能由 exact `headSha` 的 detached clean worktree 或 CI checkout 生成。
10. **Fork 安全**：默认不得使用 `pull_request_target` 在不受信任的 Fork 代码上执行带 Secret 的 Review。
11. **单一生产组合根**：Production Runtime 只能由 `archctxd` 创建真实 Store、CodeGraph、Review 和 Signer Adapter。
12. **普通 Repository 优先**：不要求用户采用 Monorepo；Monorepo 只是一个 Repository 内的 scope 扩展。
13. **状态不可伪造**：不能使用 GitHub 不允许 App 设置的 `stale` conclusion；旧 Head 使用领域状态 `SUPERSEDED`。
14. **隐私文案准确**：不得声称 Pull Requests Read 权限在技术上绝对无法获得 Diff；承诺由 API 白名单、运行时拦截、日志投影和审计共同保证。

---

# 5. 前置依赖与阻塞条件

本 Sprint 不重做整个 Local Runtime，但以下条件是 Developer/Organization Review 的硬前置。任何一项不满足时，对应 GitHub Gate 必须标记 ⛔。

| ID | 条件 | 最低证据 | 验证 |
|---|---|---:|---|
| PRE-01 | `archctxd` 是真实长驻进程并提供版本化本地 RPC | E2 | 两个独立 CLI 进程访问同一 Session |
| PRE-02 | Runtime State 使用真实 SQLite 持久化，而不是 Map | E2 | Daemon 重启后 Challenge/Review 状态仍存在 |
| PRE-03 | Production Composition 使用真实 CodeGraph Adapter | E2 | fixture repo 返回真实 symbol/impact/evidence |
| PRE-04 | ChangeSet 和 Review Gate 不接受零值或占位 Digest | E2 | mismatch、stale、zero digest 反向测试 |
| PRE-05 | CLI 和 MCP 都是 Daemon RPC 薄客户端 | E2 | 同一任务通过两个 Surface 读取同一状态 |
| PRE-06 | 六平台/版本 CI 安装门禁恢复为绿色 | E2 | Linux/macOS/Windows × 支持的 Node/Bun 矩阵 |

前置条件的实现可以来自 Parent Sprint 的修复 PR，但必须重新附真实集成证据，不能只引用旧复选框。

---

# 6. ADR 实现矩阵

状态：◻ 未开始 / ◐ 进行中 / ☑ 达到本文要求的证据等级。

| ADR | 动作 | 主里程碑 | Target | St |
|---|---|---|:---:|:---:|
| ADR-0015 | 修订为 GitHub Governance API Allowlist without Contents Permission | FG0 · FG2 | E2 | ◐ |
| ADR-0016 | 增加 Attestation v2、exact worktree、runtime build 和签名边界 | FG0 · FG3 | E2 | ◐ |
| ADR-0024 | 强制 Developer / Organization Check Context 与 requiredTrust 隔离 | FG0 · FG3 · FG4 | E3 | ◐ |
| ADR-0027 | 增加客户 Runner、Key Lifecycle、Workflow Ref 与 Fork 策略 | FG0 · FG4 | E3 | ◐ |
| ADR-0034 | One-package Local Product Distribution | FG0 · FG1 | E2 | ◐ |
| ADR-0035 | GitHub Governance Privacy Contract | FG0 · FG2 | E3 | ◐ |
| ADR-0036 | Deterministic Gate, LLM Advisory | FG0 · FG3 · FG4 | E3 | ◐ |

---

# 7. 进度总览

| 里程碑 | 范围 | Tasks | Exit Gates | 当前 |
|---|---|---:|---:|---:|
| FG0 | 契约修订与可信台账 | 18 | 5 | 23 / 23 |
| FG1 | 单一安装与本地 Surface | 18 | 6 | 9 / 24 |
| FG2 | GitHub 隐私治理平面 | 20 | 7 | 0 / 27 |
| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 0 / 32 |
| FG4 | 客户控制 Organization Runner | 21 | 8 | 0 / 29 |
| FG5 | Control Plane 持久化与 Check Delivery | 20 | 7 | 0 / 27 |
| FG6 | Staging、加固与发布 | 20 | 10 | 0 / 30 |
| **合计** | | **141** | **51** | **32 / 192** |

> 进度必须按 `Tasks + Exit Gates` 同时统计。Milestone Tasks 全部完成但 Exit Gate 未通过时，里程碑仍为未完成。

---

# 8. Backlog Waypoint 索引

| # | Status | Waypoint | Mode | Acceptance | Evidence Plan |
|---:|:---:|---|---|---|---|
| 1 | [x] | `archctx-fg0-contract-correction` | contract | 文案、ADR、Schema、状态机和信任等级一致 | `docs/verification/fg0-contract-correction-gate.md` |
| 2 | [ ] | `archctx-fg1-one-install-local-product` | integration | 一个安装交付 CLI/Daemon/MCP；普通 repo 可独立使用 | `docs/verification/fg1-local-product-gate.md` |
| 3 | [ ] | `archctx-fg2-github-privacy-plane` | security | 真实 App 下只使用白名单 API；代码内容路由为零 | `docs/verification/fg2-github-privacy-gate.md` |
| 4 | [ ] | `archctx-fg3-developer-attestation-v2` | integration | exact clean worktree 生成 Developer Attestation 和独立 Check | `docs/verification/fg3-developer-review-gate.md` |
| 5 | [ ] | `archctx-fg4-organization-runner` | integration | 客户 Runner 无 LLM 完成确定性 required check | `docs/verification/fg4-organization-runner-gate.md` |
| 6 | [ ] | `archctx-fg5-control-plane-delivery` | integration | Challenge、Attestation、Key、Queue、重试和审计真实持久化 | `docs/verification/fg5-control-plane-gate.md` |
| 7 | [ ] | `archctx-fg6-production-gate` | launch | 真实 staging、安全、故障、跨平台和灰度证据完成 | `docs/verification/fg6-production-gate.md` |

---

# 9. 里程碑开发清单

列含义：`St` 状态；`Target` 最低证据成熟度；`Owner` 责任包或域；`Deps` 前置任务。

## FG0 · 契约修订与可信台账

**目标**：先消除文档、Schema、代码和产品文案中的冲突，冻结后续实现的唯一契约。  
**关联 PRD**：§1–§5、§9、§12、§16、§19。  
**前置**：无。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG0-01 | ☑ | 评审并接受 Follow-up PRD，记录批准人、日期和 superseded 条款 | docs/product | E0 | — |
| FG0-02 | ☑ | 在 `docs/spec.md` 增加 Local / Personal / Developer / Organization 四种模式 | docs/product | E0 | FG0-01 |
| FG0-03 | ☑ | 修订 README：GitHub App 为可选治理扩展，不是安装前置 | docs/product | E0 | FG0-01 |
| FG0-04 | ☑ | 修订隐私文案：从“无法读取”改为“不请求、不处理、不保存” | docs/security | E0 | FG0-01 |
| FG0-05 | ☑ | 冻结两个 Check Context 常量和显示文案 | contracts · github-app | E0 | FG0-01 |
| FG0-06 | ☑ | 冻结 `ReviewChallengeV2` JSON Schema | contracts | E0 | FG0-01 |
| FG0-07 | ☑ | 冻结 `AttestationV2` JSON Schema | contracts | E0 | FG0-06 |
| FG0-08 | ☑ | 冻结 `RunnerIdentity`、`DeviceIdentity` 和 Key Status Schema | contracts | E0 | FG0-07 |
| FG0-09 | ☑ | 将 Challenge 与 Check Delivery 拆为两个状态机并定义非法迁移 | contracts | E0 | FG0-06 |
| FG0-10 | ☑ | 定义 `requiredTrust: developer | organization` 策略语义 | contracts · policy-engine | E0 | FG0-07 |
| FG0-11 | ☑ | 定义 GitHub Governance Typed Port；不得暴露通用 Client | contracts · github-app | E0 | FG0-01 |
| FG0-12 | ☑ | 定义 Cloud Egress Envelope，只允许最小元数据字段 | contracts · control-plane | E0 | FG0-07 |
| FG0-13 | ☑ | 定义 Reason Code、Retryability 和用户可操作提示 | contracts | E0 | FG0-09 |
| FG0-14 | ☑ | 新增 ADR-0034：One-package Local Product Distribution | docs/adr | E0 | FG0-01 |
| FG0-15 | ☑ | 新增 ADR-0035：GitHub Governance Privacy Contract | docs/adr | E0 | FG0-11,12 |
| FG0-16 | ☑ | 新增 ADR-0036：Deterministic Gate, LLM Advisory | docs/adr | E0 | FG0-10 |
| FG0-17 | ☑ | 修订 ADR-0015、0016、0024、0027，并添加迁移后果 | docs/adr | E0 | FG0-05..16 |
| FG0-18 | ☑ | 建立机器可读 acceptance ledger，绑定 PRD 条目、代码、测试、环境和 Evidence | docs/verification · tooling | E1 | FG0-01 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG0-EG1 | ☑ | PRD、Spec、README、ADR 对安装模型和 GitHub App 可选性无冲突 | E1 | 文档一致性测试 + Human Architecture Gate |
| FG0-EG2 | ☑ | V2 Schema 有 valid/invalid/boundary fixtures | E1 | `bun test packages/contracts/test/contracts.test.ts` |
| FG0-EG3 | ☑ | Developer 结果不能满足 Organization requiredTrust | E1 | Policy 反向测试必须拒绝 |
| FG0-EG4 | ☑ | 文档与代码不再使用单一 `Architecture Review` Check 代表两种信任 | E1 | repository grep + contract test |
| FG0-EG5 | ☑ | Acceptance ledger 可校验不存在无证据的完成状态 | E1 | `bun run verify:acceptance-ledger` |

---

## FG1 · 单一安装与本地 Surface

**目标**：一个版本一致的本地产品交付 CLI、Daemon 和 MCP；Local Core 不依赖 GitHub 或 LLM。  
**关联 PRD**：§5–§7、AC-01、AC-06。  
**前置**：FG0-EG1、FG0-EG2；PRE-01..06。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG1-01 | ☑ | 建立唯一 Production Composition Root，由 `archctxd` 创建真实 Adapter | runtime-daemon | E1 | PRE-01..05 |
| FG1-02 | ☑ | 增加构建期/测试期断言：Production 不可注入 Mock Store 或 Mock CodeGraph | runtime-daemon · build | E1 | FG1-01 |
| FG1-03 | ☑ | 定义统一 Product Version Manifest，覆盖 CLI、Daemon、MCP 和 Schema | contracts · build | E1 | FG0-06..08 |
| FG1-04 | ☑ | 构建一个可安装分发物，包含 CLI、Daemon launcher 和 MCP entrypoint | cli · release | E2 | FG1-03 |
| FG1-05 | ☑ | CLI 通过版本化本地 RPC 调用 Daemon，不直接创建 Store/CodeGraph | cli | E2 | FG1-01,04 |
| FG1-06 | ☑ | MCP stdio Server 通过同一 RPC 调用 Daemon，不创建独立状态 | mcp-local | E2 | FG1-01,04 |
| FG1-07 | ☑ | 实现 Daemon 自动启动、健康检查、版本协商和 graceful shutdown | runtime-daemon · cli | E2 | FG1-04,05 |
| FG1-08 | ☑ | 实现 stale socket/pipe、stale lock 和崩溃后重连 | runtime-daemon | E2 | FG1-07 |
| FG1-09 | ☑ | 实现 `archctx mcp install/status/remove`，输出 Agent Host 配置 | cli · mcp-local | E2 | FG1-06 |
| FG1-10 | ◻ | 实现 `archctx doctor`，检查版本、Daemon、SQLite、CodeGraph、Git 和权限 | cli | E2 | FG1-03,07 |
| FG1-11 | ◻ | 建立普通单仓库 fixture 和首次体验 E2E | test/fixtures | E2 | FG1-04..10 |
| FG1-12 | ◻ | 建立单仓库 Monorepo fixture，验证 workspace scope 不改变安装要求 | test/fixtures | E2 | FG1-11 |
| FG1-13 | ◻ | Multi-repo 输入返回明确的 unsupported/capability error | cli · domain | E1 | FG1-11 |
| FG1-14 | ◻ | 默认关闭第三方遥测，并由 `doctor` 显示当前 egress 状态 | runtime-daemon · security | E2 | FG1-10 |
| FG1-15 | ◻ | 实现版本不兼容的可操作错误和 Daemon 升级路径 | runtime-daemon · cli | E2 | FG1-03,07 |
| FG1-16 | ◻ | 构建安装、升级、卸载和残留数据保留策略 | release · docs | E2 | FG1-04,15 |
| FG1-17 | ◻ | 在 Linux、macOS、Windows 上验证 socket/pipe 和文件权限 | runtime-daemon · CI | E2 | FG1-07,08 |
| FG1-18 | ◻ | 发布 Local Core quickstart，不出现 GitHub App 或 LLM 必需步骤 | docs/product | E1 | FG1-09..17 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG1-EG1 | ◻ | 干净机器一次安装后可运行 CLI、Daemon、MCP | E2 | 安装 tarball/binary E2E |
| FG1-EG2 | ◻ | CLI 与 MCP 读取同一个持久 Session | E2 | 两独立进程 + Daemon restart E2E |
| FG1-EG3 | ◻ | 无 GitHub、无 Cloud、无 LLM 完成 `init → sync → context → review` | E2 | `bun run e2e:local-no-cloud` |
| FG1-EG4 | ◻ | 普通 repo 与 Monorepo fixture 均通过；Multi-repo 明确拒绝 | E2 | repository topology matrix |
| FG1-EG5 | ◻ | Production build 不包含可达的 Mock Composition | E2 | dependency graph + runtime assertion |
| FG1-EG6 | ◻ | 三大 OS 的安装和本地 IPC 全绿 | E2 | hosted CI readback，附不可变 run IDs |

---

## FG2 · GitHub 隐私治理平面

**目标**：以真实 GitHub App 验证最小权限、Webhook、类型化 API 白名单和代码内容零路由。  
**关联 PRD**：§8、§14、AC-05。  
**前置**：FG0 全绿。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG2-01 | ◻ | 固化 GitHub App permission manifest：Metadata Read、Pull Requests Read、Checks Write | github-app · infra | E1 | FG0-11 |
| FG2-02 | ◻ | 在 staging 实测 expected-source 是否需要 Commit Statuses Write，并记录决策 | github-app · docs/adr | E3 | FG2-01 |
| FG2-03 | ◻ | 实现原始请求体 HMAC-SHA256 Webhook 验签 | github-app | E2 | FG2-01 |
| FG2-04 | ◻ | 使用 delivery ID 做 Webhook 幂等和重放拒绝 | github-app · cloud-db | E2 | FG2-03 |
| FG2-05 | ◻ | 验签后立即投影最小事件字段并丢弃原始正文 | github-app | E2 | FG2-03 |
| FG2-06 | ◻ | 支持 `opened`、`synchronize`、`reopened` 和 Check rerequest 事件 | github-app | E2 | FG2-05 |
| FG2-07 | ◻ | 实现 `GitHubGovernancePort.getPullHeadMetadata` | github-app | E2 | FG0-11 |
| FG2-08 | ◻ | 实现 `createCheck` 与 `updateCheck`，只接受最小 Check DTO | github-app | E2 | FG0-05,11 |
| FG2-09 | ◻ | 创建 API method/path allowlist；未知方法默认拒绝 | github-app · security | E2 | FG2-07,08 |
| FG2-10 | ◻ | 显式拒绝 PR Files、Contents、Blob、Tree 端点 | github-app · security | E2 | FG2-09 |
| FG2-11 | ◻ | 显式拒绝 diff/patch media type 和相关 `Accept` header | github-app · security | E2 | FG2-09 |
| FG2-12 | ◻ | 禁止业务层导入或接收通用 Octokit Client | lint · github-app | E1 | FG2-09 |
| FG2-13 | ◻ | 实现 egress recorder，只记录 endpoint category、status、latency 和 request ID | github-app · observability | E2 | FG2-09 |
| FG2-14 | ◻ | 对日志、trace、queue payload 和 error object 做字段级投影与敏感字段清除 | cross/security | E2 | FG2-05,13 |
| FG2-15 | ◻ | 建立含源码、Patch、Symbol、Finding 的诱饵 fixture，验证无法进入 Cloud DTO | test/security | E2 | FG0-12,FG2-14 |
| FG2-16 | ◻ | 建立静态 Privacy Contract 扫描，拦截禁止 endpoint、method 和 media type | tooling/security | E1 | FG2-10..12 |
| FG2-17 | ◻ | 建立动态 Privacy Contract Test，录制 staging 全部 GitHub egress | test/security | E3 | FG2-13,15 |
| FG2-18 | ◻ | 实现 installation 创建、repo selection 变更和撤销处理 | github-app · control-plane | E3 | FG2-03..08 |
| FG2-19 | ◻ | 对外安装页列出权限、用途、数据保留和“不读取代码执行 Review”承诺 | docs/product · legal | E1 | FG2-01,02,18 |
| FG2-20 | ◻ | 更新 Threat Model：权限扩大、SDK 漂移、日志泄露、Webhook 重放 | docs/security | E1 | FG2-03..19 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG2-EG1 | ◻ | 真实 GitHub App 能接收事件并创建/更新 Check | E3 | staging repo readback |
| FG2-EG2 | ◻ | 非法签名、旧 delivery 和重复 delivery 100% 被拒绝 | E2 | security integration suite |
| FG2-EG3 | ◻ | 静态扫描证明业务层没有通用 Octokit 和禁止 endpoint | E2 | `bun run verify:github-api-contract` |
| FG2-EG4 | ◻ | 动态录制中 PR Files/Contents/Blob/Tree/Diff/Patch 调用数为 0 | E3 | `docs/verification/fg2-egress-recording.json` |
| FG2-EG5 | ◻ | Cloud log/trace/queue 中诱饵代码内容命中数为 0 | E3 | DLP fixture + staging export scan |
| FG2-EG6 | ◻ | Ruleset expected-source 权限结论有真实 staging 证据 | E3 | permission decision record |
| FG2-EG7 | ◻ | App 撤销后 token、challenge 创建和 Check 更新立即停止 | E3 | install/revoke E2E |

---

## FG3 · Challenge/Attestation v2 与 Developer Review

**目标**：在 exact clean worktree 上执行确定性 Review，由本地 Device Key 签署 Developer Attestation，并发布独立、准确表述信任等级的 Check。  
**关联 PRD**：§9–§10、§12、AC-02、AC-03。  
**前置**：FG1、FG2；PRE-01..05。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG3-01 | ◻ | 实现 ReviewChallenge v2 Domain 和 canonical serialization | contracts · attestation | E1 | FG0-06 |
| FG3-02 | ◻ | 实现 Attestation v2 Domain 和 canonical serialization | contracts · attestation | E1 | FG0-07 |
| FG3-03 | ◻ | 实现 Challenge 合法状态迁移和非法迁移拒绝 | control-plane · contracts | E2 | FG0-09,FG3-01 |
| FG3-04 | ◻ | 对 `(installation, repository, PR, headSha, requiredTrust)` 建唯一约束 | cloud-db | E2 | FG3-01 |
| FG3-05 | ◻ | 新 Head 到达时原子地把旧 Challenge 设为 `SUPERSEDED` | control-plane | E2 | FG3-03,04 |
| FG3-06 | ◻ | 实现一次性 Nonce、过期时间和提交原子消费 | control-plane · attestation | E2 | FG3-03 |
| FG3-07 | ◻ | 实现 Challenge claim/lease，避免多个本地执行重复提交 | control-plane | E2 | FG3-03,06 |
| FG3-08 | ◻ | 增加 Attestation v1→v2 数据和 API 迁移；v1 不可满足新 required check | cloud-db · attestation | E2 | FG3-01,02 |
| FG3-09 | ◻ | 实现 Device Key 注册、显示 fingerprint 和撤销 | attestation · control-plane | E2 | FG0-08 |
| FG3-10 | ◻ | Device Private Key 存入 OS Keychain/credential store，不写入 repo 或普通配置文件 | attestation · platform | E2 | FG3-09 |
| FG3-11 | ◻ | 实现 `archctx github connect/status/disconnect`，不依赖 `gh` | cli · control-plane | E2 | FG3-09 |
| FG3-12 | ◻ | 获取 Challenge 后 fetch 精确 PR Head，并验证 repository ID 与 headSha | cli · runtime-daemon | E2 | FG3-07,11 |
| FG3-13 | ◻ | 创建 detached temporary worktree，验证 HEAD、Tree OID 和 clean 状态 | runtime-daemon · git-adapter | E2 | FG3-12 |
| FG3-14 | ◻ | 计算 worktree/model/policy/code-facts/runtime-build digest | runtime-daemon · architecture-domain | E2 | FG3-13 |
| FG3-15 | ◻ | 在临时 Worktree 初始化/同步真实 CodeGraph 并执行 deterministic review | runtime-daemon · review-engine | E2 | FG3-13,14,PRE-03 |
| FG3-16 | ◻ | Review conclusion 只能由 Review Engine 返回；CLI/MCP/Agent API 不接受 result 字段 | contracts · review-engine | E2 | FG3-15 |
| FG3-17 | ◻ | Daemon 内部对 canonical Attestation 签名；Agent 和 MCP 不接触 Private Key | attestation · runtime-daemon | E2 | FG3-02,10,16 |
| FG3-18 | ◻ | 提交前再次校验 current PR head，拒绝 race 中的旧结果 | cli · control-plane | E2 | FG3-05,12,17 |
| FG3-19 | ◻ | 服务器校验 signature、nonce、expiry、repo、PR、head/base/tree 和所有 digest | attestation · control-plane | E2 | FG3-02,06,17 |
| FG3-20 | ◻ | mismatch、replay、revoked key、zero digest 和错误 trustLevel 全部拒绝 | test/security | E2 | FG3-19 |
| FG3-21 | ◻ | 发布 `ArchContext / Developer Review`，Summary 明示 developer-attested | github-app | E3 | FG2-08,FG3-19 |
| FG3-22 | ◻ | 新 Head 后旧 Check 不尝试写 `stale`；使用 superseded/cancelled/neutral 语义 | github-app · control-plane | E3 | FG3-05,21 |
| FG3-23 | ◻ | 清理临时 Worktree、锁和临时 CodeGraph 状态；失败后可恢复 | runtime-daemon | E2 | FG3-13..18 |
| FG3-24 | ◻ | 实现 Developer Review CLI UX：claim/run/submit/status/retry/cancel | cli | E2 | FG3-07..23 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG3-EG1 | ◻ | exact head 的 clean temporary worktree 完成真实 Review | E2 | process-level fixture E2E |
| FG3-EG2 | ◻ | Dirty worktree、错误 repo、错误 head/tree/base 全部拒绝 | E2 | negative identity matrix |
| FG3-EG3 | ◻ | Agent/MCP 不能提交自行指定的 pass/fail | E2 | contract + adversarial test |
| FG3-EG4 | ◻ | Replay、过期、撤销 Key、Nonce 重用拦截率 100% | E2 | attestation security suite |
| FG3-EG5 | ◻ | 新 Commit 原子 supersede 旧 Challenge，旧结果不能更新当前 Head Check | E3 | real PR synchronize E2E |
| FG3-EG6 | ◻ | 真实 PR 显示独立 Developer Review Check 和准确 provenance | E3 | staging screenshot/readback |
| FG3-EG7 | ◻ | Developer Attestation 无法满足 Organization requiredTrust | E3 | rules/policy staging test |
| FG3-EG8 | ◻ | Review 全流程 Cloud DTO 与日志不含代码内容 | E3 | egress + log DLP scan |

---

## FG4 · 客户控制 Organization Runner

**目标**：由客户 GitHub-hosted 或 self-hosted Runner 自动执行确定性 Review，产生 Organization Attestation 和独立 required check；GitHub App 不执行代码，也不配置 LLM。  
**关联 PRD**：§11–§12、AC-04、AC-06。  
**前置**：FG1、FG2、FG3 Schema/Verifier；PRE-03..06。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG4-01 | ◻ | 实现 RunnerIdentity Domain、状态和 repository/org scope | contracts · runner | E1 | FG0-08 |
| FG4-02 | ◻ | 实现 Runner Key 注册、fingerprint、rotation、overlap window 和 revoke | runner · control-plane | E2 | FG4-01 |
| FG4-03 | ◻ | Key 注册要求 GitHub org/repo 管理权限并记录审计事件 | control-plane · auth | E3 | FG4-02 |
| FG4-04 | ◻ | 定义 Organization Attestation 的 workflow ref、run ID、attempt 和 runner identity 字段 | contracts · attestation | E1 | FG3-02,FG4-01 |
| FG4-05 | ◻ | 构建官方 `archcontext/review-action`，固定或验证 Runtime 版本与 artifact digest | runner · release | E2 | FG1-04,FG4-04 |
| FG4-06 | ◻ | Action 使用 exact PR head checkout，并验证 repository/head/tree | runner · git-adapter | E2 | FG4-05 |
| FG4-07 | ◻ | Action 默认最小 `permissions`，不请求不必要的 Contents write 或 broad token | runner · security | E2 | FG4-05 |
| FG4-08 | ◻ | 默认禁止 `pull_request_target` 对不受信任代码执行带 Secret 的工作流 | runner · security | E2 | FG4-05 |
| FG4-09 | ◻ | Fork PR 默认输出 neutral/unsupported 或运行无 Secret 的安全模式 | runner · github-app | E3 | FG4-08 |
| FG4-10 | ◻ | Runner 可在未配置任何 LLM Provider 时执行完整 deterministic gate | runner · review-engine | E2 | FG4-05,06 |
| FG4-11 | ◻ | LLM Advisory 只能作为独立可选 step，不影响 Attestation conclusion | runner · contracts | E2 | FG0-16,FG4-10 |
| FG4-12 | ◻ | Private Key 只通过客户 Secret Store 注入，不写日志、artifact 或 cache | runner · security | E2 | FG4-02,05 |
| FG4-13 | ◻ | Attestation 绑定 workflow ref、runtime build digest、run ID 和 attempt | runner · attestation | E2 | FG4-04,05,10 |
| FG4-14 | ◻ | Verifier 强制 Runner Identity active、scope 匹配、key 未撤销、requiredTrust=organization | attestation · control-plane | E2 | FG4-02,13 |
| FG4-15 | ◻ | 为每个 Challenge 实现 Runner lease、heartbeat、timeout 和安全重试 | runner · control-plane | E2 | FG3-07,FG4-05 |
| FG4-16 | ◻ | 发布 `ArchContext / Organization Runner` Check，绝不复用 Developer Context | github-app | E3 | FG0-05,FG4-14 |
| FG4-17 | ◻ | 提供 GitHub-hosted Runner workflow template | runner · docs | E2 | FG4-05..16 |
| FG4-18 | ◻ | 提供 self-hosted Runner hardening guide 和最小网络/文件权限 | docs/security | E1 | FG4-05..16 |
| FG4-19 | ◻ | 提供 reusable workflow，支持 pin by commit SHA | runner · release | E2 | FG4-17 |
| FG4-20 | ◻ | staging ruleset 将 Organization Runner 设为 required expected source | github-app · infra | E3 | FG2-02,FG4-16 |
| FG4-21 | ◻ | 实现 runner unregister 与 key revoke 后的立即拒绝和可恢复 UX | runner · control-plane | E3 | FG4-02,14,15 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG4-EG1 | ◻ | GitHub-hosted Runner 无 LLM 完成真实 Organization Check | E3 | staging workflow readback |
| FG4-EG2 | ◻ | self-hosted Runner 无 LLM 完成相同 Gate | E3 | staging self-hosted readback |
| FG4-EG3 | ◻ | Developer Check 不能满足 required Organization Check | E3 | protected branch/ruleset test |
| FG4-EG4 | ◻ | revoke/rotate Key 后旧 Key 立即失效，新 Key 在 overlap 策略内工作 | E3 | key lifecycle E2E |
| FG4-EG5 | ◻ | Fork PR 不泄露 Secret，也不执行危险 `pull_request_target` 路径 | E3 | public fork adversarial test |
| FG4-EG6 | ◻ | Runtime/Action 被替换或 digest 不匹配时 Attestation 被拒绝 | E2 | supply-chain negative test |
| FG4-EG7 | ◻ | required check conclusion 完全来自 deterministic gate | E2 | no-provider + injected-advisory test |
| FG4-EG8 | ◻ | Runner artifact、cache、日志和 Cloud DTO 中代码内容命中数为 0 | E3 | DLP scan + artifact inspection |

---

## FG5 · Control Plane 持久化与 Check Delivery

**目标**：把现有内存原型替换为真实持久化、事务、队列、重试、幂等、审计和最小可观测性。  
**关联 PRD**：§13、§15。  
**前置**：FG0 Schema；FG2 GitHub Port；FG3/FG4 Verifier。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG5-01 | ◻ | 为 `review_challenges` 建立真实 migration、索引和唯一约束 | cloud-db | E2 | FG3-01,04 |
| FG5-02 | ◻ | 为 `attestations` 建立 append-only 存储和 payload digest | cloud-db | E2 | FG3-02 |
| FG5-03 | ◻ | 为 `runner_identities` / `device_identities` / keys 建 migration | cloud-db | E2 | FG0-08,FG4-01 |
| FG5-04 | ◻ | 为 `check_deliveries` 建立独立状态、attempt 和 nextAttemptAt | cloud-db | E2 | FG0-09 |
| FG5-05 | ◻ | 为 `webhook_deliveries` 建唯一 delivery ID 和 retention 字段 | cloud-db | E2 | FG2-04 |
| FG5-06 | ◻ | 实现 Challenge create/claim/get/submit/cancel API 和 request Schema | control-plane | E2 | FG5-01 |
| FG5-07 | ◻ | 实现 Device/Runner Key register/rotate/revoke API 和授权 Scope | control-plane · auth | E2 | FG5-03 |
| FG5-08 | ◻ | 实现 Attestation submit 的单事务：consume nonce → persist → transition | control-plane | E2 | FG5-01,02,06 |
| FG5-09 | ◻ | API、Webhook 和 Check 写入使用稳定 idempotency key | control-plane | E2 | FG5-04..08 |
| FG5-10 | ◻ | Check Publisher 通过 Queue 异步投递，不阻塞 Attestation 验证事务 | control-plane · github-app | E2 | FG5-04,08 |
| FG5-11 | ◻ | 实现指数退避、jitter、Retry-After 和最大尝试次数 | control-plane | E2 | FG5-10 |
| FG5-12 | ◻ | 实现 dead-letter、人工重放和 Check rerequest | control-plane · ops | E2 | FG5-10,11 |
| FG5-13 | ◻ | 新 Head 与旧 Check delivery 竞争时只允许当前 Challenge 发布成功语义 | control-plane | E2 | FG3-05,FG5-10 |
| FG5-14 | ◻ | 实现 install/repo/PR/actor/device/runner 的授权与资源绑定 | control-plane · auth | E2 | FG2-18,FG5-06,07 |
| FG5-15 | ◻ | 实现 API rate limit、body size、clock skew 和 expiry 限制 | control-plane · security | E2 | FG5-06..08 |
| FG5-16 | ◻ | 实现按 PRD retention 删除原始最小事件、Challenge、Attestation 和审计数据 | cloud-db · ops | E3 | FG5-01..05 |
| FG5-17 | ◻ | 审计日志只保存 actor/action/resource/reason/digest，不保存代码或详细 Finding | control-plane · security | E2 | FG0-12,FG5-06..14 |
| FG5-18 | ◻ | 增加 metrics：challenge age、verify latency、delivery lag、retry、reject reason | observability | E2 | FG5-06..13 |
| FG5-19 | ◻ | 增加告警和 runbook：Webhook backlog、Check DLQ、signature spike、key revoke | ops | E3 | FG5-18 |
| FG5-20 | ◻ | 发布 OpenAPI/Schema 文档和 API compatibility policy | docs/api · contracts | E1 | FG5-06..15 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG5-EG1 | ◻ | 服务重启后 Challenge、Attestation、Key 和 Delivery 状态不丢失 | E2 | durable integration E2E |
| FG5-EG2 | ◻ | 并发重复 Webhook/submit/queue 消息只产生一次领域结果 | E2 | concurrency/idempotency suite |
| FG5-EG3 | ◻ | Check API 故障后自动重试，达到上限进入 DLQ，可安全 replay | E3 | injected GitHub failure staging test |
| FG5-EG4 | ◻ | Attestation 持久化与 Nonce 消费不存在部分提交 | E2 | transaction fault injection |
| FG5-EG5 | ◻ | Retention job 在 staging 删除到期数据且不破坏审计最小记录 | E3 | time-shift retention test |
| FG5-EG6 | ◻ | Dashboard 和告警能定位 webhook、verify、queue、GitHub API 四类故障 | E3 | incident drill |
| FG5-EG7 | ◻ | Database、log、trace、queue export 的代码内容命中数为 0 | E3 | full-plane DLP scan |

---

## FG6 · Staging、加固与发布

**目标**：将 AC-01..AC-06 转成不可变 staging 证据，完成安全、可靠性、性能、灰度和回滚 Gate。  
**关联 PRD**：§14–§18。  
**前置**：FG0–FG5 全部 Exit Gate。

| ID | St | 任务 | Owner | Target | Deps |
|---|:---:|---|---|:---:|---|
| FG6-01 | ◻ | 建立 `bun run verify:governance` 聚合命令和 CI job | tooling · CI | E2 | FG0..FG5 |
| FG6-02 | ◻ | AC-01：新用户无 GitHub App/Cloud/LLM 完成 Local Core 首次体验 | QA | E3 | FG1 |
| FG6-03 | ◻ | AC-02：真实 PR 完成 Developer Review 并展示准确 provenance | QA | E3 | FG3 |
| FG6-04 | ◻ | AC-03：push 新 Commit 后旧 Challenge/结果失效，新 Check 被创建 | QA | E3 | FG3,FG5 |
| FG6-05 | ◻ | AC-04：客户 Runner 无 LLM 完成 Organization required check | QA | E3 | FG4,FG5 |
| FG6-06 | ◻ | AC-05：静态、动态和存储 DLP 证明代码内容路由为 0 | security · QA | E3 | FG2,FG5 |
| FG6-07 | ◻ | AC-06：无 Provider Credential 时所有确定性 Gate 行为不变 | QA | E3 | FG3,FG4 |
| FG6-08 | ◻ | 执行跨平台 Local Runtime 与 GitHub workflow matrix | CI · QA | E3 | FG1,FG4 |
| FG6-09 | ◻ | 执行 Fork PR、权限降级、installation revoke 和 ruleset matrix | security · QA | E3 | FG2,FG4 |
| FG6-10 | ◻ | 对 Webhook、DB、Queue、GitHub API、clock skew 做 fault/chaos injection | reliability | E3 | FG5 |
| FG6-11 | ◻ | 完成 dependency vulnerability scan、SBOM、SAST、secret scan | security · release | E3 | FG0..FG5 |
| FG6-12 | ◻ | 完成外部安全审阅，覆盖 API Allowlist、Key、Replay、Fork 和日志 | security | E3 | FG6-06,09,11 |
| FG6-13 | ◻ | 真实大仓库测量 clean worktree、CodeGraph、Review 和端到端延迟/内存 | performance | E3 | FG3,FG4 |
| FG6-14 | ◻ | 定义并验证 SLO：Challenge 创建、Verify、Check Delivery 和成功率 | product · ops | E3 | FG5-18,19 |
| FG6-15 | ◻ | 完成数据保留、删除、installation revoke 和 account delete 演练 | privacy · ops | E3 | FG5-16 |
| FG6-16 | ◻ | 完成 Device/Runner Key compromise、GitHub outage、queue backlog runbook | ops · security | E3 | FG5-19,FG6-10 |
| FG6-17 | ◻ | 实现 feature flag：Developer Check、Organization Check、requiredTrust | control-plane · release | E2 | FG3,FG4 |
| FG6-18 | ◻ | 执行 internal → design partners → opt-in beta 的分阶段 rollout | product · release | E4 | FG6-01..17 |
| FG6-19 | ◻ | 验证 Schema/Check Context/Action 版本的 rollback 和向前兼容 | release · QA | E3 | FG3-08,FG4-05,FG5-20 |
| FG6-20 | ◻ | 完成 Launch Review，冻结已知限制、支持矩阵和 Post-MVP 清单 | product · architecture | E4 | FG6-01..19 |

**Exit Gate**

| ID | St | Gate | Target | 验证方式 |
|---|:---:|---|:---:|---|
| FG6-EG1 | ◻ | AC-01..AC-06 全部有不可变 commit/build/run 证据 | E3 | `docs/verification/fg6-acceptance-evidence.md` |
| FG6-EG2 | ◻ | 支持平台矩阵全绿，无安装或 IPC 回归 | E3 | hosted CI readback |
| FG6-EG3 | ◻ | Privacy Contract 静态、动态、数据库、日志、artifact 全绿 | E3 | privacy evidence bundle |
| FG6-EG4 | ◻ | Replay、stale head、wrong trust、revoked key、fork secret 拦截率 100% | E3 | adversarial suite |
| FG6-EG5 | ◻ | Queue/GitHub/DB 故障恢复满足 SLO，且无重复 Check 结论 | E3 | chaos report |
| FG6-EG6 | ◻ | 安全扫描无未接受的 Critical/High；外部安全结论已处置 | E3 | security release report |
| FG6-EG7 | ◻ | 性能满足 PRD 预算或有批准后的新预算与降级策略 | E3 | representative benchmark report |
| FG6-EG8 | ◻ | Rollback 不破坏旧 Attestation 读取，也不让低信任结果升级 | E3 | migration/rollback drill |
| FG6-EG9 | ◻ | Design partner 灰度期无 P0/P1 隐私或错误通过事件 | E4 | rollout readback |
| FG6-EG10 | ◻ | Human Launch Gate 明确批准 Beta；未完成项移入命名 Post-MVP | E4 | signed launch decision |

---

# 10. 测试与证据矩阵

| 层 | 目标测试 | 必须覆盖 |
|---|---|---|
| Contract | `packages/contracts/test/github-governance-contracts.test.ts` | v2 Schema、canonical payload、状态迁移、requiredTrust |
| Local Surface | `packages/cli/test/local-product-e2e.test.ts` | 一次安装、RPC、MCP、普通 repo、Monorepo、无 Cloud |
| Privacy Static | `packages/github-app/test/privacy-contract-static.test.ts` | 禁止 API、media type、通用 Client、DTO 字段 |
| Privacy Dynamic | `packages/github-app/test/privacy-contract-staging.test.ts` | 真实 App egress 录制、日志/queue/storage DLP |
| Attestation | `packages/attestation/test/attestation-v2.test.ts` | canonical signature、nonce、expiry、digest、revoke、replay |
| Developer E2E | `packages/attestation/test/developer-review-e2e.test.ts` | clean worktree、exact SHA、supersede、Check provenance |
| Runner E2E | `packages/runner/test/organization-runner-e2e.test.ts` | no LLM、workflow ref、key lifecycle、fork、required check |
| Control Plane | `apps/control-plane/test/governance-e2e.test.ts` | durable DB、transaction、idempotency、queue、DLQ、retention |
| Reliability | `apps/control-plane/test/governance-chaos.test.ts` | GitHub/API/DB/Queue failure、clock skew、duplicate delivery |
| Release | `test/release/governance-release-gate.test.ts` | AC-01..06 evidence completeness and immutable refs |

建议聚合命令：

```bash
bun run lint
bun run typecheck
bun test
bun run verify:acceptance-ledger
bun run verify:github-api-contract
bun run verify:privacy-contract
bun run e2e:local-no-cloud
bun run e2e:developer-review
bun run e2e:organization-runner
bun run verify:governance
```

命令在实现前属于目标接口；落地时必须写入根 `package.json`，禁止只记录在文档中。

---

# 11. Evidence 文件模板

每个 Milestone 使用一个 Gate 文档，并引用必要的 JSON、日志摘要或截图。最小格式：

```markdown
# FGx Verification

- Commit SHA:
- Build/Artifact Digest:
- Environment:
- GitHub App Installation ID: <redacted stable reference>
- Test Repository ID: <redacted stable reference>
- Started At:
- Completed At:
- Reviewer:

## Commands

## Results

## Negative Tests

## Privacy Scan

## Known Limitations

## Linked CI / GitHub Run IDs

## Decision
PASS | CONDITIONAL | FAIL
```

禁止在 Evidence 中保存：

- webhook secret、private key、access token；
- 源码、Diff、Patch 或 PR Files 响应；
- 完整 Context、Symbol 列表或详细 Finding；
- 可反向定位私有仓库的公开链接。

---

# 12. 推荐 PR 顺序

每个 PR 应保持可审计、可回滚，并尽量只跨一个契约边界。

| PR | 建议分支 | 核心内容 | Merge Gate |
|---:|---|---|---|
| 1 | `docs/followup-governance-contract` | Follow-up PRD、Sprint、Spec/README 修订 | FG0-EG1 |
| 2 | `feat/governance-contracts-v2` | Challenge/Attestation/Identity/State Schema v2 | FG0-EG2..4 |
| 3 | `chore/acceptance-evidence-ledger` | 证据等级、机器可读台账、CI 校验 | FG0-EG5 |
| 4 | `feat/one-install-local-product` | 单一分发物、版本 Manifest、Daemon/MCP entrypoint | FG1-EG1 |
| 5 | `refactor/thin-cli-mcp-rpc` | CLI/MCP 统一 RPC、Production Composition Root | FG1-EG2..5 |
| 6 | `feat/github-governance-port` | Typed Port、Webhook、最小权限、安装生命周期 | FG2-EG1..2 |
| 7 | `security/github-privacy-contract` | API allowlist/denylist、egress、DLP、权限 staging 决策 | FG2-EG3..7 |
| 8 | `feat/developer-attestation-v2` | Device Key、Challenge、canonical signature、Verifier | FG3-EG3..4 |
| 9 | `feat/exact-worktree-developer-review` | detached worktree、digest、review、Developer Check | FG3-EG1..2,5..8 |
| 10 | `feat/organization-runner-action` | Runner Identity、官方 Action、no-LLM deterministic gate | FG4-EG1..3,6..7 |
| 11 | `security/runner-key-fork-hardening` | Key lifecycle、fork 策略、self-hosted hardening | FG4-EG4..5,8 |
| 12 | `feat/governance-control-plane-durable` | D1/DB migration、API、transaction、auth、retention | FG5-EG1,2,4,5,7 |
| 13 | `feat/check-delivery-queue` | Queue、retry、DLQ、rerequest、metrics、alerts | FG5-EG3,6 |
| 14 | `test/governance-staging-acceptance` | AC-01..06、跨平台、fork、chaos、DLP | FG6-EG1..5 |
| 15 | `release/governance-beta-gate` | 安全、性能、rollback、灰度和 Launch Review | FG6-EG6..10 |

禁止把 PR 8–13 合并为一个大型 PR；Attestation、Runner 和 Control Plane 的信任边界必须能够独立评审。

---

# 13. 每周执行节奏

建议使用顺序而不是固定日历承诺：

1. **Contract Slice**：FG0，确保所有后续代码只实现一个契约；
2. **Local Slice**：FG1，证明产品不依赖 GitHub；
3. **Privacy Slice**：FG2，先限制 App 权限和 API，再增加功能；
4. **Developer Slice**：FG3，完成低信任但可用的本地治理闭环；
5. **Organization Slice**：FG4，完成客户控制自动化和较高信任 Check；
6. **Durability Slice**：FG5，替换内存状态和同步投递；
7. **Launch Slice**：FG6，真实 staging、安全和 rollout。

并行限制：

- FG1 可与 FG2 的文档/Port 工作并行；
- FG3 不得在 FG0 Schema 未冻结前实现；
- FG4 Action 可以在 FG3 Verifier 稳定后开始，但不得自行复制 Verifier；
- FG5 migration 可以提前建立，但状态迁移必须以 FG0 契约为准；
- FG6 只能在对应下游 Gate 已通过后开始收集证据。

---

# 14. 决策门

以下问题必须通过真实证据决定，不能在实现中默认为真：

| Decision | 最晚时间 | 选项 | 证据 |
|---|---|---|---|
| GitHub expected-source 是否需要 Commit Statuses Write | FG2-EG6 | 不需要 / 最小增加 | 真实 staging ruleset |
| Developer Check 是否允许作为软 required | FG3-EG7 | 仅信息 / 显式策略允许 | 产品与安全评审 |
| Fork PR 默认结论 | FG4-EG5 | neutral / unsupported / safe no-secret mode | adversarial staging test |
| GitHub-hosted Runner Key 形式 | FG4-EG4 | stored secret / short-lived provisioned key | threat model + lifecycle test |
| Check superseded 展示 | FG3-EG5 | cancelled / neutral /仅新 head Check | GitHub staging UX |
| Retention 时长 | FG5-EG5 | PRD 默认 / 法务修订 | deletion test + privacy review |
| Beta SLO 与性能预算 | FG6-EG7 | PRD 默认 /批准的新预算 | representative benchmark |

每个 Decision 必须形成 ADR 或 Decision Record，并链接到 acceptance ledger。

---

# 15. 发布阻塞条件

出现以下任一情况时不得进入 Beta：

1. GitHub App 或 Cloud 访问 PR Files、Contents、Blob、Tree、Diff 或 Patch；
2. Developer Check 能满足 Organization Runner requiredTrust；
3. Agent、CLI 参数或 MCP Tool 可以直接指定 Check pass；
4. Review 不是在 exact head 的 clean worktree/CI checkout 上执行；
5. Nonce 可重放、撤销 Key 仍有效或新 Head 可复用旧 Attestation；
6. Organization Runner 必须配置 LLM 才能给出确定性结论；
7. Fork PR 可访问不应暴露的 Secret；
8. Production Composition Root 使用 Mock Store、Mock CodeGraph 或内存 Control Plane；
9. Check Delivery 重试可能产生相互矛盾的多个当前 Head 结果；
10. 日志、trace、queue、database 或 artifact 中发现源码、Diff、Patch、Symbol、Context 正文或详细 Finding；
11. 跨平台安装/IPC 门禁红色；
12. Critical/High 安全问题没有修复或正式风险接受；
13. Rollback 会把低信任 Attestation 当成高信任结果；
14. 无法撤销 GitHub installation、Device Key 或 Runner Key。

---

# 16. Post-MVP 候选

只有 FG6-EG10 通过后，以下内容才可进入下一阶段：

- Managed Runner；
- OIDC/硬件支持的短期 Runner Identity；
- Merge Queue 专用集成；
- 更完整的 Fork PR 安全执行模型；
- Multi-repo architecture landscape；
- LLM Advisory 的团队共享与成本策略；
- Enterprise policy packs；
- 更强的可验证构建或远程执行证明；
- GitLab/Bitbucket governance adapter。

Post-MVP 项不得作为当前实现不完成隐私、信任或可靠性 Gate 的理由。

---

# 17. 执行日志

| Date | Milestone | Event | Evidence / Decision | Owner |
|---|---|---|---|---|
| 2026-06-20 | Sprint | Draft created | Follow-up PRD + Sprint Checklist | architecture |
| 2026-06-20 | FG0 | Contract correction complete | `docs/verification/fg0-contract-correction-gate.md`; `docs/verification/acceptance-ledger.json` | Codex |
| 2026-06-20 | FG1 | Production composition root slice complete | `docs/verification/fg1-local-product-gate.md`; `bun run typecheck`; focused runtime/CLI/MCP tests | Codex |
| 2026-06-20 | FG1 | Product version manifest complete | `schemas/runtime/product-version-manifest.schema.json`; `packages/contracts/src/product-version.ts`; contract/runtime tests | Codex |
| 2026-06-20 | FG1 | Installable local product smoke complete | `node scripts/packaged-cli-smoke.mjs`; installed `archctx` CLI/daemon/MCP stdio readback | Codex |
| 2026-06-20 | FG1 | Thin CLI/MCP daemon RPC shared-state slice complete | MCP stdio `plan_update` + CLI `apply` over installed `archctx`; `bun run verify` | Codex |
| 2026-06-20 | FG1 | Daemon lifecycle and RPC version negotiation complete | `archctx daemon status` product readback; HTTP 426 mismatch tests; `bun run verify` | Codex |
| 2026-06-20 | FG1 | Stale daemon control-file recovery complete | SIGKILL crash reconnect E2E; stale connection/lock recovery tests; `bun run verify` | Codex |
| 2026-06-20 | FG1 | MCP host config commands complete | `archctx mcp install/status/remove --host ...`; CLI host config tests; `bun run verify` | Codex |
