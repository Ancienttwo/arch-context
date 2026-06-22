# ArchContext Follow-up PRD：本地产品封装、GitHub 治理与客户控制 Runner

> **Status**: Accepted for FG0 Contract Execution
> **Slug**: archcontext-local-github-governance  
> **Created**: 2026-06-20  
> **Updated**: 2026-06-20  
> **Version**: v1.0 Draft  
> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`  
> **Source Spec**: `docs/spec.md`  
> **Related ADRs**: ADR-0003、0005、0006、0015、0016、0024、0027  
> **Product Stage**: Beta 前契约修订与真实垂直链路  
> **Document Language**: 简体中文  

> **核心结论：ArchContext 本地 Runtime 是产品核心；GitHub App 是可选治理桥梁；客户控制 Runner 是自动执行和较高信任证明的载体。GitHub App 与 SaaS 不配置 LLM Provider，也不读取代码执行 Review。**

---

# 目录

1. 文档目的与规范优先级  
2. 背景与需要修正的问题  
3. 已冻结的产品决策  
4. 目标、成功标准与非目标  
5. 产品模式与用户体验  
6. 安装封装与 Repository 范围  
7. 目标系统架构与模块边界  
8. GitHub App 权限、隐私与 API 契约  
9. Review Challenge、Attestation 与 Check 模型  
10. Developer Review 执行流程  
11. Organization Runner 执行流程  
12. 确定性 Gate 与 LLM 边界  
13. Control Plane API 与持久化模型  
14. 安全、隐私和威胁模型增量  
15. 失败处理、重试与可观测性  
16. 指标、Evals 与验收标准  
17. 迁移与发布策略  
18. 风险与缓解  
19. ADR 和上游文档修订清单  
20. 参考资料  

---

# 1. 文档目的与规范优先级

## 1.1 文档目的

本 Follow-up PRD 将以下产品问题转化为可开发、可验证的正式契约：

1. 用户究竟安装 CLI、Daemon 和 MCP 中的哪些组件；
2. 普通 Git Repository、Monorepo 与 Multi-repo 的产品边界；
3. GitHub App 在本地 Agent 不运行于 GitHub 时的真实价值；
4. `gh` CLI、GitHub App 与客户 Runner 的关系；
5. GitHub App 是否需要 LLM Provider；
6. Developer Attestation 与 Organization Attestation 的不同信任强度；
7. “无 Contents 权限”与“云端不读取代码”之间的准确隐私表述；
8. Challenge、Attestation、Check 和 Runner 的生产级状态机与验收证据。

## 1.2 规范优先级

本文档是原 PRD 的增量规范。在本文档被接受后：

- 对本地产品封装，本文档细化原 PRD §13；
- 对 GitHub App、Challenge、Attestation 和 Check，本文档修订原 PRD §15；
- 对 GitHub 权限和云端隐私边界，本文档修订原 PRD §21；
- 对 M5 及 Organization Runner 的范围，本文档修订原 PRD §26.7 和 Post-MVP 描述；
- 对 ADR-0015、ADR-0016、ADR-0024、ADR-0027，本文档给出必须补充的验收约束。

原 PRD 的 Local-first、单写者 Daemon、ChangeSet-only、Declared/Observed/Verified、确定性内核等不变量继续有效。

## 1.3 规范用语

本文中的“必须”“不得”“应”“可”分别对应 MUST、MUST NOT、SHOULD、MAY。  
“完成”必须指达到对应验收证据级别，不得只以类型、接口、Mock 或内存测试替代真实集成。

---

# 2. 背景与需要修正的问题

现有方向基本正确，但存在四类歧义。

## 2.1 安装模型歧义

“用户安装 CLI、MCP、GitHub App”容易被理解为三个彼此独立且均为必需的产品。正确模型应是：

```text
一个本地 ArchContext 安装
├── archctx CLI
├── archctxd Runtime Daemon
└── archctx mcp serve（本地 MCP 协议入口）

可选云端治理扩展
└── GitHub App
```

MCP 是本地产品的一个 Surface，不是第二个需要独立购买、升级和持久化状态的产品。

## 2.2 GitHub App 价值歧义

本地 Agent 可以使用 `gh` 或用户 Token 调用 GitHub API，但该能力只代表“某个用户发布了一次结果”。它不能独立提供：

- PR 事件入口；
- Repository Installation 和组织授权；
- 稳定的 App 身份；
- 可撤销的 Repository Selection；
- Challenge 生命周期；
- App 来源的 Check Run；
- 订阅、Device、Runner 和 Entitlement 绑定。

因此 GitHub App 是治理面，不是本地执行面。

## 2.3 隐私表述不准确

“没有 Contents 权限，所以 App 技术上无法读取任何代码或 Diff”不是可接受的产品承诺。`Pull requests: Read` 对部分 Pull Request API 仍可能具有返回文件名或 patch 的能力。

正确承诺是：

> ArchContext Cloud 不请求、不调用、不处理、不存储 Repository Contents、PR Diff、文件名、Symbol、架构模型正文或详细 Review Finding。该边界由最小权限、类型化 API 白名单、运行时 egress 限制、日志投影和自动化 Privacy Contract Test 共同保证。

## 2.4 信任模型歧义

Developer Attestation 能证明某个已注册设备密钥签署了特定载荷，但不能证明：

- Runtime 未被篡改；
- Review 确实按组织预期配置执行；
- 开发者不能伪造本机结果；
- 执行环境具有远程 CI 的独立性。

因此 Developer Review 与 Organization Runner 必须使用不同的 Check Context、不同的策略语义和不同的默认用途。

---

# 3. 已冻结的产品决策

| ID | 决策 | 结论 |
|---|---|---|
| DEC-01 | 本地安装单元 | 用户只安装一个 `archctx` 产品分发；CLI、Daemon、MCP Adapter 同版本交付 |
| DEC-02 | 本地使用前置条件 | 本地核心不要求 Cloud 账号、GitHub App、订阅或 LLM Provider |
| DEC-03 | Repository 范围 | MVP 以一个普通 Git Repository 为边界；不要求 Monorepo |
| DEC-04 | Monorepo | 同一 Git Repository 内多个 workspace/package 可支持；不等于 Multi-repo |
| DEC-05 | Multi-repo | 跨 Repository Architecture Context 不属于本 PRD |
| DEC-06 | GitHub App | 可选治理扩展，只处理 Installation、PR 元数据、Challenge、Attestation 和 Check |
| DEC-07 | `gh` CLI | 可选个人发布工具，不是产品依赖，也不构成组织级可信身份 |
| DEC-08 | GitHub App LLM | GitHub App 和 ArchContext SaaS 不配置、托管或调用 LLM Provider |
| DEC-09 | 自动执行 | 由开发者本机或客户控制 Runner 执行；云端不 Clone Repository |
| DEC-10 | Gate 逻辑 | Check 的 Pass/Fail 必须由确定性 Runtime 计算；LLM 只产生 Advisory |
| DEC-11 | 隐私 | 无 Contents 权限是第一层控制，不是唯一控制；必须增加 API 白名单和 Privacy Contract |
| DEC-12 | Check Context | Developer Review 与 Organization Runner 使用不同名称，不得复用同一 Context |
| DEC-13 | 执行基线 | 可发布 Attestation 的 Review 必须绑定精确 Commit 和干净执行树 |
| DEC-14 | Supersede | 新 Head 到达时旧 Challenge 标记 `SUPERSEDED`；不得依赖 App 写入 `stale` conclusion |
| DEC-15 | Managed Runner | ArchContext 托管私有代码 Runner 不在当前路线内 |

---

# 4. 目标、成功标准与非目标

## 4.1 目标

### G-01：本地产品可独立成立

用户在不安装 GitHub App、不登录 ArchContext Cloud 的情况下，可以完成：

```text
install -> init -> MCP connect -> prepare/checkpoint/complete -> local review
```

### G-02：GitHub App 成为可选治理桥梁

安装 GitHub App 后，系统可以：

- 接收 PR 生命周期事件；
- 为精确 Head 创建 Challenge；
- 接收最小 Attestation；
- 验证签名和绑定；
- 以正确的 App 身份发布 Check；
- 在新 Head 到达时使旧结果失效。

### G-03：信任等级不可混淆

- Developer Review 明确显示 Developer-attested；
- Organization Runner 明确显示 Organization-attested；
- Developer Attestation 不得满足要求 Organization Runner 的策略。

### G-04：代码内容零进入 ArchContext SaaS

Cloud DTO、D1、Queue、日志、错误报告和 GitHub API 调用均不得包含源码、Diff、文件名、Symbol、模型正文或详细 Finding。

### G-05：自动化不依赖 ArchContext 托管 LLM

官方 Runner 在没有任何 LLM Secret 的情况下完成确定性 Review 和 Check。

## 4.2 成功标准

| ID | 指标 | 目标 |
|---|---|---:|
| S-01 | 无 Cloud 账号完成本地首个 Review | 100% 支持 |
| S-02 | GitHub App / SaaS Source、Diff、文件名内容路由 | 0 |
| S-03 | Attestation Replay、错误 Repo、错误 SHA、过期、已撤销 Key 拦截率 | 100% |
| S-04 | Developer Attestation 错误满足 Organization Gate | 0 |
| S-05 | PR 新 Head 后旧结果继续被视为当前有效结果 | 0 |
| S-06 | Runner 不配置 LLM Provider 完成 Review | 100% |
| S-07 | Webhook Delivery 幂等 | 100% |
| S-08 | Attestation 提交后 Check 更新 p95 | ≤ 60 秒 |
| S-09 | GitHub webhook 正常请求响应 p95 | ≤ 2 秒 |
| S-10 | 一个普通 Git Repository 的安装到首个本地任务 | ≤ 10 分钟 |

## 4.3 非目标

本 PRD 不包含：

- ArchContext SaaS Clone 或 Checkout 私有 Repository；
- ArchContext 托管 LLM、Embedding 或 CodeGraph；
- Managed Runner；
- 跨 Repository Architecture Context；
- 通用 Bug、Security 或 Style Code Review；
- Agent 自动合并 PR；
- 用 LLM 文本直接决定 required check；
- 为不可信 Fork 自动暴露 Runner Secret；
- Hardware Attestation、TEE 或零信任执行证明；
- 以 Monorepo 作为使用前提；
- 强制用户安装 `gh` CLI。

---

# 5. 产品模式与用户体验

## 5.1 模式矩阵

| 模式 | 本地安装 | GitHub App | 执行位置 | LLM | GitHub 结果 | 默认信任用途 |
|---|---:|---:|---|---|---|---|
| Local Core | 必须 | 不需要 | 开发者本机 | 用户 Agent 自带，可选 | 无 | 本地开发 |
| Personal Publish | 必须 | 不需要 | 开发者本机 | 可选 | 用户身份的 Status/Comment | 信息性 |
| Developer Review | 必须 | 必须 | 开发者本机 | 可选 | `ArchContext / Developer Review` | 软门禁/小团队 |
| Organization Gate | Runner 安装 | 必须 | 客户 GitHub Actions 或 Self-hosted Runner | 不需要 | `ArchContext / Organization Runner` | 可配置 required |
| Managed Review | — | — | ArchContext Cloud | — | — | 非目标 |

## 5.2 Local Core 首次体验

```bash
# 安装
curl -fsSL https://bun.sh/install | bash
bun --version
npm install -g archctx@0.1.0
archctx --help

# 在任意普通 Git Repository
cd my-repo
archctx doctor
archctx init
archctx sync
archctx context
archctx prepare
archctx status

# 配置本地 Agent Host
# Codex
archctx mcp install --host codex
archctx mcp status --host codex
# Claude
archctx mcp install --host claude
archctx mcp status --host claude

# 验证
archctx doctor
archctx checkpoint --expected-worktree-digest <digest-from-status>
archctx review --head-sha <current-head-sha>
```

要求：

- `archctx@0.1.0` 是当前 canonical public npm artifact；`@archcontext/cli` 不是发布包名；
- 普通命令按需启动或复用同版本 `archctxd`；
- MCP Host 启动的是 `archctx mcp` stdio entrypoint，由其经本地 RPC 调 `archctxd`；
- MCP 进程不得创建第二套 Store、CodeGraph 或 ChangeSetEngine；
- 未登录 Cloud 时不得降低本地公开能力；
- 私有 Repository 的商业限制不得破坏用户对本地数据的导出或删除。

## 5.3 Developer Review 体验

```bash
archctx login
archctx github connect
archctx github review --pr 42
```

流程：

1. GitHub App 为当前 Head 创建 Challenge；
2. CLI 获取 Challenge；
3. Daemon 创建精确 Commit 临时 Worktree；
4. Runtime 执行确定性 Review；
5. Daemon 使用 Device Key 签署 Attestation；
6. SaaS 验证后更新 `ArchContext / Developer Review`。

## 5.4 Organization Gate 体验

```bash
archctx runner register \
  --installation <installation-id> \
  --repository <owner/repo>

archctx runner workflow generate > .github/workflows/archcontext-review.yml
```

官方 Workflow 的基本行为：

```text
PR event
-> checkout exact head
-> install pinned archctx runner
-> obtain current Challenge
-> deterministic review
-> sign organization attestation
-> submit metadata
-> update Organization Runner Check
```

---

# 6. 安装封装与 Repository 范围

## 6.1 一个版本、一个本地产品

以下组件必须由同一 Release Manifest 管理：

```text
archctx
├── CLI binary/entrypoint
├── archctxd
├── MCP stdio adapter
├── local RPC schema
├── local SQLite migrations
├── CodeGraph adapter compatibility manifest
└── Runtime build provenance
```

### PKG-01：版本一致性

CLI、Daemon、MCP 和 Schema 必须完成版本握手。Major 不兼容时拒绝请求，并输出修复命令。

### PKG-02：Daemon 唯一 Composition Root

只有 `archctxd` 可以在生产模式创建：

- Local Store；
- Model Store；
- CodeGraph Provider；
- Review Engine；
- ChangeSet Engine；
- Device Signer。

CLI 和 MCP 必须是 RPC Client。

### PKG-03：Daemon 生命周期

- CLI 可按需启动 Daemon；
- 支持显式 `start/stop/status/restart`；
- macOS/Linux 使用 Unix Domain Socket；
- Windows 使用 Named Pipe，或由 ADR 明确安全等价方案；
- Endpoint 权限仅允许当前用户；
- Stale lock 和异常退出可恢复。

### PKG-04：MCP 安装

`archctx mcp install` 只写入 Host 配置，不复制 Runtime 数据。  
MCP stdout 只用于协议；日志进入 stderr 或本地日志文件。

### PKG-05：普通 Repository 优先

Repository 识别边界是 Git Root 和 Worktree，不是 package manager workspace。

### PKG-06：Monorepo 语义

Monorepo 是一个 Git Repository 内的多个 workspace。Runtime 必须支持：

- Repository 级模型；
- 可选 workspace scope；
- 一个 Repository Fingerprint；
- 一个 Head SHA；
- 一个 Challenge；
- Worktree Digest 覆盖整个被审查树，或由 Policy 明确声明可验证子集。

### PKG-07：Multi-repo 排除

任何要求同时加载多个 Git Remote、跨仓 Symbol 或跨仓 Head 的能力必须进入独立 Multi-repo PRD。

---

# 7. 目标系统架构与模块边界

## 7.1 总体架构

```text
Local Agent Host
      |
      | MCP stdio
      v
archctx MCP Adapter ---------+
                              |
archctx CLI ------------------+---- versioned local RPC ----> archctxd
                                                               |
                                                               +-- Git Adapter
                                                               +-- CodeGraph Adapter
                                                               +-- SQLite Local Store
                                                               +-- Model / Policy Store
                                                               +-- Deterministic Review
                                                               +-- Device Signer
                                                               |
                                                               +-- Attestation Client
                                                                       |
                                                                       v
GitHub Webhook ---> GitHub App Adapter ---> Challenge Service ---> Attestation Verifier
                                              |                        |
                                              v                        v
                                         D1 / Queue              Check Publisher
                                                                       |
                                                                       v
                                                                   GitHub Check

Customer-controlled Runner
      |
      +-- exact checkout
      +-- same deterministic Runtime
      +-- Organization Runner Signer
      +-- metadata-only Attestation submission
```

## 7.2 模块职责

| 模块 | 允许职责 | 禁止职责 |
|---|---|---|
| `cli` | 参数解析、渲染、RPC 调用 | 创建 Store、CodeGraph、Signer；复制 Core 逻辑 |
| `mcp-local` | MCP Tool/Resource 映射、RPC 调用 | 独立状态、独立 ChangeSet、独立 Review |
| `runtime-daemon` | 本地 Composition Root、Session、RPC、Signer 调度 | GitHub Installation Token |
| `github-app` | Webhook 投影、GitHub API 白名单、Check 发布 | Clone、Diff、文件列表、LLM |
| `attestation` | Schema、canonicalization、签名和验证 | 执行 Review、访问源代码 |
| `runner` | 精确执行树、调用 Runtime、签署 Organization Attestation | 上传 Finding 或源码 |
| `control-plane` | 身份、Entitlement、Challenge、Runner、Attestation metadata | Repository 内容处理 |
| `cloud-db` | 允许字段的持久化 | Source、Diff、Filename、Symbol、Finding body |
| `review-engine` | 确定性 Gate | 直接调用 GitHub 或 Cloud API |

## 7.3 Production 与 Test Composition

生产构建必须有自动化断言：

```text
Production composition:
  SqliteLocalStore
  RealCodeGraphAdapter
  RealGitAdapter
  OSKeychainSigner
  RpcDaemon

Test composition:
  InMemoryStore
  MockCodeGraphProvider
  FakeGitAdapter
  EphemeralSigner
```

Mock 不得通过默认导出进入生产 Composition Root。

---

# 8. GitHub App 权限、隐私与 API 契约

## 8.1 默认权限

```text
Repository permissions
├── Metadata: Read
├── Pull requests: Read
└── Checks: Read and write
```

默认不得申请：

```text
Contents
Issues
Actions
Administration
Deployments
Members
Secrets
Workflows
```

`Commit statuses: Write` 只有在真实 staging 验证 GitHub Ruleset Expected Source 必须依赖该权限时才可增加，并需更新 ADR、安装页说明和权限快照。

## 8.2 Webhook

订阅：

```text
installation
installation_repositories
pull_request: opened, reopened, synchronize, closed
check_run: rerequested
```

可选后续：

```text
merge_group
```

### GH-01：原始正文处理

1. 使用原始字节验证 `X-Hub-Signature-256`；
2. 验证 Delivery ID；
3. 投影为最小内部事件；
4. 不记录原始正文；
5. 不把原始正文发送到 Queue；
6. 完成投影后释放正文引用。

最小 PR 事件：

```ts
interface PullRequestGovernanceEvent {
  deliveryId: string;
  installationId: number;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  action: "opened" | "reopened" | "synchronize" | "closed";
  headSha: string;
  baseSha: string;
  senderId: number;
  occurredAt: string;
}
```

## 8.3 GitHub API 白名单

业务层只允许依赖：

```ts
interface GitHubGovernancePort {
  getRepositoryMetadata(input: {
    installationId: number;
    repositoryId: number;
  }): Promise<RepositoryMetadata>;

  getPullHeadMetadata(input: {
    installationId: number;
    repositoryId: number;
    pullRequestNumber: number;
  }): Promise<PullHeadMetadata>;

  createCheckRun(input: CreateGovernanceCheckInput): Promise<CheckReference>;

  updateCheckRun(input: UpdateGovernanceCheckInput): Promise<void>;
}
```

不得把通用 Octokit Client、Installation Token 或任意 REST 路径暴露给 Application Service。

## 8.4 显式禁止

静态和运行时均禁止：

```text
pulls.listFiles
repos.getContent
git.getBlob
git.getTree
GET /repos/{owner}/{repo}/pulls/{pull_number}/files
GET /repos/{owner}/{repo}/contents/**
GET /repos/{owner}/{repo}/git/blobs/**
GET /repos/{owner}/{repo}/git/trees/**
Accept: application/vnd.github.diff
Accept: application/vnd.github.patch
```

## 8.5 Egress Contract

GitHub Client 必须：

- 仅连接固定 GitHub API Host；
- 只允许列入白名单的 method + path template；
- 拒绝重定向到非 GitHub Host；
- 对响应执行字段投影；
- 不将完整响应写日志；
- 在测试中记录全部请求并与 allowlist 比较。

## 8.6 对外隐私文案

允许：

> ArchContext Cloud 不调用 Repository Contents、PR Files、Git Blob/Tree 或 Diff API，也不处理或存储代码、文件名和详细 Review 内容。

禁止：

> GitHub 权限使 ArchContext 在技术上不可能读取任何代码。

---

# 9. Review Challenge、Attestation 与 Check 模型

## 9.1 Challenge 状态机

```text
PENDING
  |
  +--> LEASED --> SUBMITTED --> VERIFIED
  |                    |            |
  |                    +--> REJECTED
  |
  +--> SUPERSEDED
  +--> EXPIRED
```

终态：

```text
VERIFIED
REJECTED
SUPERSEDED
EXPIRED
```

规则：

- 同一 Repository + PR + Head + Trust Requirement 只允许一个活跃 Challenge；
- `synchronize` 到新 Head 时，旧活跃 Challenge 原子变为 `SUPERSEDED`；
- Lease 具有短 TTL，可在超时后重新获取；
- Nonce 只能成功消费一次；
- `VERIFIED` 后不得再次接收 Attestation；
- `REJECTED` 是否允许重试由 reason code 决定，不通过复用旧 Nonce 实现。

## 9.2 Check Delivery 状态机

```text
PENDING
PUBLISHED
RETRYING
DEAD_LETTER
```

Challenge 状态和 Check Delivery 状态必须分开持久化。

## 9.3 Check 名称

```text
ArchContext / Developer Review
ArchContext / Organization Runner
```

不得再使用一个模糊的：

```text
<legacy single Architecture Review check>
```

来承载两种信任等级。

## 9.4 Supersede 行为

新 Head 到达时：

1. 旧 Challenge 标记 `SUPERSEDED`；
2. 当前 PR Head 创建新 Challenge；
3. 为新 Head 创建新的 queued Check；
4. 旧 Commit 上的 Check 不再代表当前 PR；
5. 如需更新旧 Check，使用 `neutral` 或 `cancelled` 并显示 “Superseded by a newer PR head”；
6. 不尝试由 App 写入 `stale` conclusion。

## 9.5 Review Challenge v2

```json
{
  "schemaVersion": "archcontext.review-challenge/v2",
  "challengeId": "chal_...",
  "installationId": 10001,
  "repositoryId": 20002,
  "pullRequestNumber": 42,
  "headSha": "abc123...",
  "baseSha": "def456...",
  "nonce": "base64url...",
  "requiredTrust": "developer",
  "policyProfileId": "policy.default",
  "createdAt": "2026-06-20T09:00:00Z",
  "expiresAt": "2026-06-20T09:15:00Z",
  "status": "PENDING"
}
```

Cloud 不在 Challenge 中存储：

- 文件列表；
- Diff；
- Commit message body；
- PR body；
- Architecture Model；
- Finding。

## 9.6 Attestation v2

```json
{
  "schemaVersion": "archcontext.attestation/v2",
  "attestationId": "att_...",
  "challengeId": "chal_...",
  "installationId": 10001,
  "repositoryId": 20002,
  "pullRequestNumber": 42,

  "headSha": "abc123...",
  "baseSha": "def456...",
  "mergeBaseSha": "987xyz...",
  "headTreeOid": "tree_...",
  "worktreeDigest": "sha256:...",

  "modelDigest": "sha256:...",
  "policyDigest": "sha256:...",
  "codeFactsDigest": "sha256:...",
  "reviewDigest": "sha256:...",
  "result": "pass",

  "execution": {
    "trustLevel": "developer",
    "source": "clean-commit-worktree",
    "principalId": "device_...",
    "publicKeyId": "key_..."
  },

  "runtime": {
    "version": "0.2.0",
    "buildDigest": "sha256:...",
    "codeGraphVersion": "pinned-version",
    "capabilitiesDigest": "sha256:..."
  },

  "nonce": "base64url...",
  "startedAt": "2026-06-20T09:03:00Z",
  "completedAt": "2026-06-20T09:04:00Z",
  "expiresAt": "2026-06-20T09:15:00Z",

  "signature": {
    "algorithm": "ed25519",
    "value": "base64url..."
  }
}
```

`result` 仅允许：

```text
pass
fail
error
```

`error` 必须附低敏感度枚举 `errorCode`，例如：

```text
RUNTIME_VERSION_UNSUPPORTED
HEAD_UNAVAILABLE
WORKTREE_NOT_CLEAN
CODEGRAPH_FAILED
POLICY_INVALID
REVIEW_INCOMPLETE
```

不得包含自由文本 Finding。

## 9.7 签名边界

签名必须覆盖除 `signature.value` 外的全部字段。  
Canonicalization 必须版本化并有跨平台 Golden Fixture。

Agent、MCP Tool 和 CLI 参数不得直接提供：

```text
result
reviewDigest
policyDigest
modelDigest
signature
```

它们必须由 Daemon 根据已持久化、已完成的 Review Session 读取并签署。

---

# 10. Developer Review 执行流程

## 10.1 精确执行树

Developer Review 必须使用独立、临时、detached Worktree：

```text
fetch PR head
-> verify remote maps to repositoryId
-> create detached temporary worktree at challenge.headSha
-> verify HEAD == challenge.headSha
-> verify tracked tree clean
-> record headTreeOid and submodule OIDs
-> initialize/sync CodeGraph for that worktree
-> execute deterministic review
-> produce local detailed result
-> persist review session
-> sign minimal attestation
-> remove temporary worktree
```

不得直接以开发者当前工作目录发布通过结果。

## 10.2 Worktree Digest

Digest 至少绑定：

- Repository Numeric ID；
- HEAD SHA；
- Git Tree OID；
- tracked file mode/path/content tree；
- submodule Commit OID；
- `.archcontext` 模型 Digest；
- Runtime 认可的 sparse scope（如有）。

未跟踪文件不得影响可发布 Review；如果 Review 依赖未跟踪文件，应拒绝发布。

## 10.3 Device Key

- 使用 Ed25519；
- Private Key 存 OS Keychain 或安全等价存储；
- Private Key 不进入 SQLite、Repository、日志或 MCP Result；
- 支持查看、轮换和撤销；
- Device 撤销后所有未来 Attestation 拒绝；
- 历史 Attestation 保留其“签署时有效”的审计状态，但不得重新用于新 Challenge。

## 10.4 Developer Check 展示

```text
ArchContext / Developer Review

Result: Passed
Trust: Developer-attested local runtime
Commit: abc123
Runtime: 0.2.0 (build sha256:...)
Policy digest: sha256:...
Review details: available locally
```

必须显示：

> This result is signed by a registered developer device. It is not an independent organization-controlled CI proof.

---

# 11. Organization Runner 执行流程

## 11.1 定义

Organization Runner 是客户控制的执行路径，可以运行于：

- GitHub-hosted Actions；
- 客户 Self-hosted Runner；
- 客户控制的其他 CI，后续经 Adapter 支持。

“Organization”表示工作流和签名身份由 Installation/Repository 管理者授权，不表示环境不可篡改。

## 11.2 Runner Identity

```json
{
  "schemaVersion": "archcontext.runner-identity/v1",
  "runnerId": "runner_...",
  "installationId": 10001,
  "repositoryIds": [20002],
  "workflowRef": "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
  "publicKeyId": "key_...",
  "publicKeyFingerprint": "sha256:...",
  "status": "active",
  "createdAt": "2026-06-20T09:00:00Z",
  "rotatedAt": null,
  "revokedAt": null
}
```

## 11.3 Key Provisioning

MVP 支持：

1. 本地管理员生成 Runner Key；
2. Public Key 注册到 Control Plane；
3. Private Key 写入 GitHub Actions Organization/Repository Secret，或 Self-hosted Runner Keychain；
4. Workflow 只在受信事件中读取 Secret；
5. 支持轮换和撤销。

后续可增加 GitHub Actions OIDC，但不得阻塞本 PRD。

## 11.4 官方 Action

目标接口：

```yaml
- uses: archcontext/review-action@v1
  with:
    challenge: auto
    trust-level: organization
    fail-on: blocking
```

Action 必须：

- Pin ArchContext Release Digest；
- 验证当前 Commit 与 Challenge Head；
- 不调用 LLM；
- 不上传日志中的源码或 Finding；
- 上传前运行 Privacy Audit；
- 使用固定 API Endpoint；
- 支持 `--non-interactive`；
- 产生 Step Summary，但不得写详细私有 Finding 到 GitHub；
- 失败时提示在 Runner Artifact 或本地查看受控报告；默认不上传详细报告。

## 11.5 Fork PR

默认策略：

- 使用 `pull_request`，不使用带 Secret 并 Checkout 不可信代码的 `pull_request_target`；
- Fork PR 无法获得 Runner Signing Secret 时，Organization Check 为 `neutral` 或 `action_required`；
- 维护者可使用受保护的 `workflow_dispatch` 对精确 Head 执行；
- 不因便利而把 Secret 暴露给 Fork；
- Fork 自动强 Gate 作为独立安全设计项，不在本阶段承诺。

## 11.6 Organization Check 展示

```text
ArchContext / Organization Runner

Result: Passed
Trust: Organization-attested customer-controlled workflow
Commit: abc123
Workflow: owner/repo/...@refs/heads/main
Runner key: sha256:...
Runtime build: sha256:...
```

## 11.7 策略约束

Repository Policy：

```yaml
githubGovernance:
  requiredTrust: organization
  developerReview:
    enabled: true
    blocking: false
  organizationRunner:
    enabled: true
    blocking: true
```

当 `requiredTrust: organization`：

- Developer Attestation 可以更新 Developer Review；
- 不得更新 Organization Runner 为成功；
- 不得通过相同 Check 名称绕过；
- Runner Key、Installation、Repository 和 Workflow Ref 必须全部匹配。

---

# 12. 确定性 Gate 与 LLM 边界

## 12.1 GitHub App 和 SaaS

不得：

- 配置 OpenAI、Anthropic、Google 或其他 LLM Provider Key；
- 代理用户 Prompt；
- 为 Review Checkout 代码；
- 把 PR Diff 发给模型；
- 根据模型文本发布 Pass/Fail。

## 12.2 本地 Agent

用户当前 Coding Agent 可以：

- 读取 Task Context；
- 解释 Pressure；
- 提议 Intervention；
- 生成人类可读 Advisory；
- 帮助修复本地 Finding。

但它不能直接签署或覆写 Gate 结果。

## 12.3 Deterministic Gate

可阻塞规则必须来自确定性、版本化的：

- Schema；
- Policy；
- Repository/HEAD/Worktree Freshness；
- Compatibility Contract；
- Target/Migration State；
- Required Cleanup；
- Declared Boundary；
- CodeGraph Evidence；
- Review Engine。

## 12.4 LLM Advisory

LLM 输出可以作为：

- Architecture Thesis；
- Refactor explanation；
- Proof Point 建议；
- 人类可读修复步骤。

默认不得作为：

- required check 的唯一失败原因；
- Attestation `result` 的直接输入；
- Cloud 存储字段；
- GitHub 自动评论。

---

# 13. Control Plane API 与持久化模型

## 13.1 API

```text
POST /v1/github/webhooks
GET  /v1/challenges?repositoryId=&pullRequestNumber=&headSha=&trust=
POST /v1/challenges/{challengeId}/lease
POST /v1/challenges/{challengeId}/attestations

POST /v1/installations/{installationId}/runners
POST /v1/runners/{runnerId}/rotate
POST /v1/runners/{runnerId}/revoke
GET  /v1/runners/{runnerId}

GET  /v1/installations/{installationId}/privacy-contract
GET  /v1/check-deliveries/{deliveryId}
```

## 13.2 API 限制

- Attestation Body ≤ 32 KB；
- Webhook Body 遵循平台上限，但只投影最小字段；
- 所有写请求要求 idempotency key；
- Challenge Lease 默认 5 分钟；
- Challenge 默认 15 分钟过期；
- Attestation 验证为事务；
- 成功消费 Nonce 与记录 Attestation 必须原子提交；
- Installation Token 不发送给 Local Runtime 或 Runner。

## 13.3 D1 表

### `review_challenges`

关键字段：

```text
challenge_id PK
installation_id
repository_id
pull_request_number
head_sha
base_sha
required_trust
policy_profile_id
nonce_hash UNIQUE
status
lease_owner
lease_expires_at
created_at
expires_at
superseded_by
```

唯一约束：

```text
(repository_id, pull_request_number, head_sha, required_trust)
```

### `attestations`

```text
attestation_id PK
challenge_id UNIQUE
repository_id
head_sha
trust_level
principal_id
public_key_id
result
model_digest
policy_digest
code_facts_digest
review_digest
runtime_version
runtime_build_digest
issued_at
verified_at
verification_status
rejection_reason
```

不得增加自由文本 Finding 字段。

### `runner_identities`

```text
runner_id PK
installation_id
workflow_ref
public_key_id UNIQUE
public_key_fingerprint
status
created_at
rotated_at
revoked_at
```

Repository Scope 使用关联表，不使用未索引 JSON 扫描。

### `check_deliveries`

```text
delivery_id PK
challenge_id
check_run_id
check_name
head_sha
status
attempt_count
next_attempt_at
last_error_code
created_at
updated_at
```

### `webhook_deliveries`

```text
provider
delivery_id
event_type
projected_digest
received_at
processed_at
PRIMARY KEY (provider, delivery_id)
```

不保存原始正文。

## 13.4 Retention

| 数据 | 默认保留 |
|---|---:|
| Webhook Delivery 投影 | 30 天 |
| 未完成 Challenge | 7 天 |
| Verified Attestation metadata | 1 年或账号删除 |
| Rejected Attestation metadata | 30 天 |
| Check Delivery | 90 天 |
| Revoked Runner Key metadata | 1 年 |
| 原始 Webhook Body | 0 |
| Source / Diff / Finding | 0 |

---

# 14. 安全、隐私和威胁模型增量

| ID | 威胁 | 缓解 |
|---|---|---|
| T-01 | GitHub API 权限可访问超出产品需要的数据 | 类型化 Port、路径 allowlist、媒体类型 denylist、egress contract test |
| T-02 | 开发者直接伪造 Pass | Result 只能由 Daemon 的已完成 Review Session生成；Signer 不接受外部 result |
| T-03 | 对脏工作目录签名 | 临时 detached Worktree、HEAD/Tree 校验、clean check |
| T-04 | 重放旧 Attestation | 单次 Nonce、Challenge 状态、Head/Repo/PR 绑定、过期 |
| T-05 | 低信任结果满足高信任 Check | 不同 Check 名、requiredTrust 校验、Runner Identity 绑定 |
| T-06 | Runner Key 泄露 | Secret 隔离、Fork 限制、轮换、撤销、最小 Repository Scope |
| T-07 | Webhook 伪造 | HMAC-SHA256、原始字节验证、Delivery ID 幂等 |
| T-08 | App 日志保存原始 Payload | 投影后丢弃、结构化日志 allowlist、日志测试 |
| T-09 | Queue 泄露内容 | Queue Schema 只允许 ID、SHA、状态和 Digest |
| T-10 | `pull_request_target` 执行不可信代码并读取 Secret | MVP 禁止该默认模式 |
| T-11 | Action 依赖被替换 | Pin Commit/Release Digest、构建 Provenance、SBOM |
| T-12 | LLM 结果污染 Gate | 确定性 Gate 与 Advisory 分离 |
| T-13 | Generic Octokit 被业务层滥用 | 依赖规则和 lint 禁止导出/注入通用 Client |
| T-14 | 新 Head 与 Check 更新竞态 | Challenge/Head 条件更新、提交前再次读取当前 Head metadata |
| T-15 | Device/Runner 已撤销但缓存仍接受 | 验证时读取当前 Key 状态；短 TTL 缓存并支持主动失效 |

## 14.1 Privacy Contract Test

测试必须递归检查 Cloud 边界对象，禁止以下 key 或等价别名：

```text
source
sourceCode
diff
patch
filename
filePath
symbol
codeGraph
modelBody
finding
findingBody
prompt
completion
llmProvider
```

单纯词法扫描不足。必须同时有：

- Type-level DTO allowlist；
- Runtime recursive audit；
- GitHub request recorder；
- D1 migration schema audit；
- Queue serialization audit；
- Structured log audit。

---

# 15. 失败处理、重试与可观测性

## 15.1 Reason Code

拒绝 Attestation 使用稳定枚举：

```text
CHALLENGE_NOT_FOUND
CHALLENGE_EXPIRED
CHALLENGE_SUPERSEDED
CHALLENGE_ALREADY_CONSUMED
NONCE_MISMATCH
REPOSITORY_MISMATCH
PULL_REQUEST_MISMATCH
HEAD_SHA_MISMATCH
BASE_SHA_MISMATCH
TREE_OID_MISMATCH
TRUST_LEVEL_MISMATCH
RUNNER_NOT_FOUND
RUNNER_REVOKED
RUNNER_SCOPE_MISMATCH
WORKFLOW_REF_MISMATCH
DEVICE_REVOKED
RUNTIME_VERSION_UNSUPPORTED
SIGNATURE_INVALID
PAYLOAD_PRIVACY_VIOLATION
```

GitHub Check 只显示低敏感摘要；详细诊断在本地或客户 Runner 日志。

## 15.2 重试

- Webhook：Delivery ID 幂等，重复返回 2xx；
- Check Delivery：指数退避，最大次数后 Dead Letter；
- Challenge Lease：过期可重新获取；
- Attestation：网络失败可使用相同 idempotency key 重试；
- 验证失败不得自动更换字段重新签署；
- `rerequested` 创建新 Challenge 或显式 Retry Attempt，不复活已消费 Nonce。

## 15.3 可观测性

允许记录：

```text
requestId
routeId
installationId
repositoryId
pullRequestNumber
headSha 前 12 位
challengeId
attestationId
checkDeliveryId
status
reasonCode
latencyMs
attempt
runtimeVersion
```

禁止记录：

```text
Webhook raw body
PR title/body
file names
diff
finding text
model body
signature private material
tokens
LLM prompt/output
```

---

# 16. 指标、Evals 与验收标准

## 16.1 Contract Evals

| ID | Eval | 验收 |
|---|---|---|
| E-01 | Local-only install | 无账号、无 App 完成本地 Review |
| E-02 | Thin adapter | CLI/MCP 生产代码无法构造 Store/CodeGraph/Signer |
| E-03 | Normal repo | 单 package Git Repo 完成 init/review |
| E-04 | Monorepo | 多 workspace 单 Repo 完成 scoped/full review |
| E-05 | Multi-repo guard | 第二 Repository 输入被明确拒绝或导向非 MVP |
| E-06 | GitHub API privacy | 请求录制只出现 allowlist endpoint |
| E-07 | Cloud payload privacy | API、Queue、DB、日志无禁止字段 |
| E-08 | Exact Head | 错 Head、Dirty Tree、未跟踪依赖均不能签署 |
| E-09 | Replay | 同 Nonce 第二次提交拒绝 |
| E-10 | Supersede | 新 Head 后旧 Challenge 拒绝 |
| E-11 | Trust isolation | Developer Attestation 无法更新 Organization Check 成功 |
| E-12 | Key revocation | 撤销 Device/Runner 后拒绝 |
| E-13 | No LLM runner | 无 Provider Key 完成 Organization Check |
| E-14 | Fork safety | Fork 默认路径不读取 Signing Secret |
| E-15 | GitHub staging | 真实 Test Repository 端到端完成 |
| E-16 | Ruleset source | 真实 Ruleset 只接受预期 App 来源 |

## 16.2 生产验收场景

### AC-01：本地用户不安装 GitHub App

```text
Given 一个普通 Git Repository
And 机器没有 ArchContext Cloud Token
When 用户安装 archctx、init 并连接本地 MCP
Then Agent 可以 prepare/checkpoint/complete
And 本地 review 可运行
And 不出现 GitHub App 安装阻塞
```

### AC-02：Developer Review

```text
Given GitHub App 已安装
And PR Head 为 H1
When 开发者执行 archctx github review
Then Review 在 H1 的临时干净 Worktree 执行
And 发布 ArchContext / Developer Review
And Check 显示 Developer-attested 限制
```

### AC-03：新 Commit

```text
Given H1 已有通过结果
When PR 更新为 H2
Then H1 Challenge = SUPERSEDED
And H2 创建新 Challenge 和新 Check
And H1 Attestation 不能用于 H2
```

### AC-04：Organization Gate

```text
Given Repository requiredTrust=organization
When Developer Attestation 为 pass
Then Developer Review 可成功
But Organization Runner Check 仍未通过
When 已注册 Runner 对精确 Head 提交 pass
Then Organization Runner Check 成功
```

### AC-05：Privacy

```text
Given 完整 PR 生命周期
When 记录 Worker、Queue、D1、GitHub Client 与日志
Then 不存在 Source、Diff、Filename、Symbol、Model Body 或 Finding Body
And GitHub Client 未调用 PR Files/Contents/Blob/Tree/Diff API
```

### AC-06：无 LLM

```text
Given Runner 环境没有任何 LLM Provider Secret
When 执行官方 Review Action
Then 确定性 Gate 可完成并提交 Attestation
```

## 16.3 Release Gate

下列任一未满足，不得宣称 GitHub Governance 或 Organization Gate 正式可用：

- [ ] 本地无 Cloud 依赖 E2E；
- [ ] CLI/MCP 仅通过 Daemon RPC；
- [ ] GitHub API allowlist 静态和动态测试；
- [ ] Attestation v2 跨平台 Golden Test；
- [ ] Exact Worktree E2E；
- [ ] Developer/Organization Check 隔离；
- [ ] Runner Key 轮换和撤销 E2E；
- [ ] Fork Secret 安全测试；
- [ ] 真实 GitHub App staging E2E；
- [ ] 真实 Ruleset Expected Source 验证；
- [ ] Webhook、Attestation 和 Check Retry 演练；
- [ ] Privacy Audit 报告；
- [ ] Critical/High 安全 Finding 为零；
- [ ] Release Artifact、SBOM 和 Build Digest 可验证。

---

# 17. 迁移与发布策略

## 17.1 文档迁移

接受本文档的同一个 PR 必须：

1. 更新 `docs/spec.md` 的产品模式；
2. 修订原 PRD §13、§15、§21、§26.7；
3. 将 GitHub App 明确为可选；
4. 将 “无 Contents 权限 = 无法读取代码” 改为 API Privacy Contract；
5. 将 Organization Runner 从矛盾的 Post-MVP 描述移入明确后续里程碑；
6. 更新 README 安装路径；
7. 更新 Privacy 文案和 Threat Model。

## 17.2 Schema 迁移

Beta 前默认采用 hard cut：

```text
archcontext.review-challenge/v1 -> v2
archcontext.attestation/v1 -> v2
```

不得为了内部尚未发布的 v1 自动维持双轨。只有发现真实外部消费者时，才建立 Compatibility Contract，并规定：

- 保护对象；
- Owner；
- 关闭日期；
- Telemetry；
- 删除条件。

v1 不得满足 Organization Runner required check。

## 17.3 Check 迁移

旧：

```text
<legacy single Architecture Review check>
```

新：

```text
ArchContext / Developer Review
ArchContext / Organization Runner
```

迁移期：

- 旧 Check 只保留信息性；
- 新 Ruleset 只能选择 Organization Runner；
- 文档不得指导用户把旧 Check 继续设为 required；
- staging 验证后再发布迁移说明。

## 17.4 实现迁移

当前内存 Map、示例 URL、Mock Provider 和类型代理证据只视为 Scaffold。生产完成要求：

- D1/Queue 真实 Adapter；
- GitHub App 真实 Installation Token；
- 真实 Check Run；
- 真实 Webhook；
- 真实 Key Storage；
- 真实临时 Worktree；
- 真实 Runner Workflow；
- 不使用默认 Mock Composition。

## 17.5 Rollout

```text
Phase A: Contracts + docs
Phase B: Local packaging
Phase C: Developer Review private beta
Phase D: Organization Runner private beta
Phase E: GitHub staging evidence
Phase F: public beta
```

Feature Flags：

```text
githubDeveloperReview
organizationRunner
rulesetRequiredCheck
personalPublish
```

不得使用 Feature Flag 绕过隐私或签名校验。

---

# 18. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| GitHub 权限语义变化 | 隐私边界或功能失效 | 权限版本快照、官方文档复核、staging contract test |
| 用户混淆两种 Check | 低信任误作强门禁 | 独立名称、UI 文案、策略硬校验 |
| Runner Secret 被 Fork 获取 | 供应链风险 | 禁止默认 `pull_request_target`、Fork 中无 Secret |
| 本地 Review 对错 Commit | 错误通过 | 临时 Worktree、Head/Tree/Repo ID 全绑定 |
| 过度依赖签名营销 | 信任承诺失真 | 明确 provenance，不宣称 tamper-proof |
| `gh` 与 App 双实现漂移 | 维护成本 | Personal Publish 隔离为可选 Adapter，不共享治理 Check |
| App API Client 越权扩展 | 隐私破坏 | 类型化 Port、denylist、依赖 lint、动态录制 |
| Runner 无 LLM 导致能力下降 | Check 价值不明确 | Gate 只承诺确定性约束；LLM Advisory 单独展示 |
| Monorepo Digest 成本过高 | 性能 | 增量 CodeGraph、Policy scope，但 Attestation 明确范围 |
| GitHub Ruleset 权限不符合假设 | required source 无法设置 | staging 决策门；必要时最小增加 Status 权限并记录 ADR |

---

# 19. ADR 和上游文档修订清单

## 19.1 修订现有 ADR

### ADR-0015

建议标题：

> GitHub Governance API Allowlist without Contents Permission

必须增加：

- Pull Request Read 不能被描述为技术上完全无法获取 Diff；
- GitHub API method/path allowlist；
- PR Files、Contents、Blob、Tree、Diff/Patch denylist；
- Privacy Contract Test；
- 权限 staging 证据。

### ADR-0016

必须增加：

- Attestation v2；
- exact Head/Base/Tree；
- clean temporary Worktree；
- Runtime Build Digest；
- Agent 不得提供 result；
- Check Context 分离。

### ADR-0024

必须增加：

- 两个独立 Check 名称；
- Developer 默认不作为组织级强信任；
- requiredTrust 硬校验；
- 营销文案限制。

### ADR-0027

必须增加：

- GitHub-hosted 与 Self-hosted 客户 Runner；
- Runner Key Provisioning、Rotation、Revocation；
- Workflow Ref 绑定；
- Fork PR 策略；
- 无 LLM Provider 运行；
- 不宣称环境不可篡改。

## 19.2 新增 ADR

| ADR | 标题 | 决策 |
|---|---|---|
| ADR-0034 | One-package Local Product Distribution | CLI、Daemon 和 MCP Surface 同版本交付 |
| ADR-0035 | GitHub Governance Privacy Contract | 类型化 API 白名单、egress 和日志投影共同构成隐私边界 |
| ADR-0036 | Deterministic Gate, LLM Advisory | required check 不依赖 LLM；LLM 只生成 Advisory |

---

# 20. 参考资料

- Source PRD: `plans/prds/20260619-2039-archcontext.prd.md`
- Sprint baseline: `plans/sprints/archctx-sprint.md`
- ADR-0015: `docs/adr/ADR-0015-github-app-without-contents-permission.md`
- ADR-0016: `docs/adr/ADR-0016-signed-local-attestation.md`
- ADR-0024: `docs/adr/ADR-0024-developer-vs-organization-attestation.md`
- ADR-0027: `docs/adr/ADR-0027-trusted-runner-attestation.md`
- GitHub Docs: Permissions required for GitHub Apps
- GitHub Docs: REST API endpoints for Check Runs
- GitHub Docs: REST API endpoints for Pull Requests
- GitHub Docs: Validating webhook deliveries
- GitHub Docs: Available rules for rulesets
- Model Context Protocol: Architecture and local stdio transport
