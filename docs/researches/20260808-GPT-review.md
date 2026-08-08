# 结论

**整体分层方向合理，但截至 2026 年 8 月 8 日，两仓主干代码还没有形成一条可正常工作的端到端更新链路。当前不应进行 Stage 2 authority cutover。**

更准确地说：

| 层级 | 当前状态 | 判断 |
|---|---|---|
| `repo-harness` 从 ArchContext nodes 读取 capability 索引 | 已实现 | **基本合理** |
| `archctx` 独立生成 `docs/architecture/*` | 已实现一部分 | **单仓内有条件可用** |
| `repo-harness` 在 agent runtime 中触发 archctx 投影 | 未实现 | **链路断开** |
| repo-harness 嵌套文档布局兼容 | 未实现 | **阻断** |
| 现有文档安全接管、marker migration | 未实现 | **阻断** |
| 已发布 CLI 包含最近修复 | 否 | **阻断** |
| dirty worktree、CodeGraph freshness 和版本握手 | 不完整 | **不能证明投影真值** |

最近这轮修复真正解决的是：

> `capability_source` 的单一 authority 选择，以及 `.archcontext/model/nodes/*.yaml → repo-harness Capability` 的读取和映射。

它**没有解决**原问题中的“架构文档自动更新 writer 与 runtime orchestration”。repo-harness 的提交说明本身也明确写着：默认仍为 `registry`，新增的是单向 authority switch、节点映射与 fail-closed 校验；而 handoff 文档则把持续文档投影列为之后另行对接的 Stage 2 工作。

---

# 一、当前真正存在的两条独立链路

## 1. repo-harness 当前链路

```text
代码编辑
  ↓
PostToolUse 写入 pending mutation journal
  ↓
Stop 阶段消费事件
  ↓
architecture-queue record
  ↓
context-contract-sync
  ↓
capability-context request
```

这条链路里**没有调用**：

```text
archctx docs plan
archctx docs drift
archctx docs apply
archctx agent-context apply
```

`processArchitectureCascade()` 现在只运行 `architecture-queue`、`context-contract-sync` 和 `capability-context request`；并且是按每个 changed path 分别执行。

`check-architecture-sync` 也没有检查 ArchContext projection manifest、projection drift 或 freshness。它检查的是：

1. architecture request index 是否同步；
2. 当前变更触及哪些 capability；
3. 这些 capability 是否有达到严重度门槛的 pending request card。

因此当前的实际行为仍然是：

> 发现架构相关改动 → 建 request/card → 由 agent 或人处理。

不是：

> 发现架构相关改动 → archctx 重新计算并更新机器区。

---

## 2. ArchContext 当前独立链路

ArchContext 自己已经有另一条可执行链：

```text
archctx docs plan / preview / apply
  ↓
加载 .archcontext model、现有文档、Git stamp、规模信号、CodeGraph 结果
  ↓
确定性 renderer
  ↓
daemon.planUpdate()
  ↓
render_projection ChangeSet
  ↓
daemon.applyUpdate()
  ↓
事务化写入 docs/architecture/*
```

`docs apply` 使用 ChangeSet；`agent-context apply` 也通过单独的 `render_agent_context` operation，并在 apply 时校验 expected worktree digest。

ChangeSet 内部设计是这套系统目前最扎实的部分：

- 每个 operation 单独计算写入范围；
- 检查 expected hash；
- 临时文件加原子 rename；
- journal；
- 失败回滚；
- 写入前后校验 model；
- daemon apply 再检查当前 worktree digest、draft base digest 和 HEAD。

所以问题并不在“ArchContext 完全不会写”，而在于：

> repo-harness 没有把自己的 mutation runtime 接到 ArchContext 的确定性 ChangeSet 写入链上。

---

# 二、架构原则是否合理

## 合理的部分

### 1. 单一 authority、禁止双读 fallback

`registry` 与 `archcontext` 二选一，不在失败时偷偷退回另一个来源，这个原则是正确的。

否则会出现：

- capability A 来自 JSON；
- capability B 来自 YAML；
- 同一 path 在两边得到不同 owner；
- hook、文档和 agent context 各自相信不同边界。

最近修复中的 fail-closed 和 no-fallback 应保留。

### 2. Agent 不应直接写机器真值区

这里需要修正你描述中的一个概念：

> 不应该由 agent runtime 调度一个 LLM agent，直接自由编辑 P1/P2 机器区。

ArchContext 当前 agent orchestration 明确把 agent 结果定义成：

- `directMutationAllowed: false`
- `authority: advisory-only`
- 禁止 `write-docs`
- 禁止 `apply-changeset`
- 禁止直接运行工具或执行命令

Agent 可以产生 rationale、ADR prose 或文档 draft，但必须经过确定性 validation 和后续 ChangeSet。这个安全边界是正确的，不应因为接入 repo-harness 而取消。

正确分成两条 lane：

```text
机器可推导内容
model + source tree + CodeGraph
        ↓
确定性 renderer
        ↓
ChangeSet
        ↓
P1 / P2 / Verified against / scale signals
```

```text
语义判断内容
agent 调查
   ↓
advisory draft
   ↓
人工或确定性审查
   ↓
受限 ChangeSet
   ↓
P3 / ADR / rationale
```

### 3. repo-harness 负责触发和闭环，archctx 负责真值投影

推荐的责任边界是：

- **repo-harness**：捕获 mutation、批处理 changed paths、任务生命周期、retry、completion gate、receipt；
- **archctx**：model、source ownership、CodeGraph facts、projection planning、写入范围、ChangeSet；
- **agent**：只负责机器无法推导的设计解释或待审议草稿。

这个职责划分与你原先的目标一致，只是“写入者”应是 deterministic projection，不是 unrestricted agent。

---

# 三、当前不能正常工作的 P0 问题

## P0-1：没有 runtime bridge

这是最直接的断点。

即使把：

```json
"context": {
  "capability_source": "archcontext"
}
```

打开，它只会令 `capability-resolver` 改为读取 YAML nodes。

它不会自动令 Stop hook 调用：

```bash
archctx docs apply
```

也不会令 `check-architecture-sync` 委派到 ArchContext。

而且 repo-harness 当前 policy 仍把 ArchContext 定义为：

- external optional CLI；
- never a runtime dependency；
- readiness advisory；
- hooks 不因其缺失而阻断。

**结论：`capability_source=archcontext` 是索引 authority switch，不是 projection provider switch。两者必须拆成两个明确配置项。**

---

## P0-2：文档路径完全不兼容

repo-harness 的 capability 文档规范是：

```text
docs/architecture/modules/<domain>/<capability>.md
```

例如：

```text
docs/architecture/modules/runtime-harness/hook-adapters.md
```

repo-harness 的 node mapper 也按这个嵌套路径推导 `architecture_module`。

但 ArchContext 当前 renderer 硬编码为：

```ts
docs/architecture/modules/${pathSegment(node.id)}.md
```

例如：

```text
docs/architecture/modules/capability-runtime-harness-hook-adapters.md
```

它没有真正读取 projection manifest 中声明的 `pathTemplate`。architecture index 的链接也使用同一个扁平算法。

此外，现有文档 loader 只对：

```text
docs/architecture/modules
docs/architecture/relations
```

各做一层 `readdirSync()`，不会递归读取 repo-harness 已有的嵌套文档。

### 按当前代码直接运行的可能结果

```text
原有：
docs/architecture/modules/runtime-harness/hook-adapters.md

新增：
docs/architecture/modules/capability-runtime-harness-hook-adapters.md
```

即产生两套文档，而不是更新原文档。

这会进一步导致：

- index 指向新扁平文件；
- repo-harness capability registry 指向旧嵌套文件；
- agent context 和人类浏览进入不同文档；
- orphan 检测与 freshness 使用不同目标集合。

这是明确阻断项。

---

## P0-3：现有文档接管不安全

repo-harness 已有的 architecture module 文档是人工建立的完整基线，其中已经包含：

- intro；
- P1；
- P2；
- P3；
- 历史；
- backlog。

handoff 要求 ArchContext 只接管 intro、P1 和 P2，并对 marker 外内容 byte-for-byte 保留。

但当前 `mergeGeneratedRegion()` 的行为是：

```text
如果 mixed-ownership 文件已存在，
但没有找到本 target 的 marker，
就在文件末尾 append 整个 generated region。
```

它不会识别已有的 P1/P2，也不会自动把旧段落包进 marker。

所以即使先修好嵌套路径，首次 apply 仍很可能变成：

```markdown
原有完整 intro / P1 / P2 / P3 / history

<!-- BEGIN ARCHCONTEXT -->
另一份 intro / P1 / P2
<!-- END ARCHCONTEXT -->
```

这不是安全 migration。

### 正确行为

普通 `docs apply` 遇到：

```text
目标文件存在 + ownership=mixed + marker 不存在
```

应当 fail-closed：

```text
projection-adoption-required
```

然后必须通过独立命令：

```bash
archctx docs adopt --profile repo-harness/v1 --approved
```

完成一次性 marker adoption，并产生：

- 原文件 hash；
- 新文件 hash；
- 接管区间；
- marker 外内容 hash；
- adoption receipt。

---

## P0-4：公开发布版本并不包含最近修复

公开 npm 的 `archctx@0.3.0` 是 2026 年 7 月 12 日发布的。最近的 capability projection 修复在 2026 年 8 月 8 日之后才合入，但源码 `package.json` 仍然声明版本 `0.3.0`。

npm 不能用同一版本重新发布不同内容，ArchContext 自己的 publish helper 也明确拒绝 duplicate version。

因此当前即使 repo-harness 找到全局：

```bash
archctx
```

大概率得到的仍是**不含 8 月 8 日修复**的 0.3.0。

### 需要的处理

建议发布：

```text
archctx@0.4.0
archctx-contracts@0.4.0
```

之所以推荐 `0.4.0` 而不是仅 `0.3.1`，是因为这次不只是 bugfix，还应加入：

- repo-harness projection profile；
- layout protocol；
- adoption protocol；
- worktree provenance；
- feature handshake。

这些已经属于新增公开能力契约。

---

## P0-5：readiness 会产生假阳性

repo-harness 的 `detectArchctx()` 当前：

- 会查 CLI；
- 但 `status` 的决定主要看 `capability_source` 与 nodes directory；
- 即使 CLI 不存在，只要 nodes 存在，也可能报告 `present`；
- `strictFailures` 只纳入 CodeGraph 和 agent fleet，没有纳入 ArchContext。

这对“YAML capability authority”尚可，因为 repo-harness 自己解析 YAML，并不需要 CLI。

但对“文档 projection provider”不成立。

必须拆分成：

```text
archcontext_model_authority_ready
archcontext_projection_provider_ready
archcontext_code_facts_ready
```

例如：

| 能力 | 所需条件 |
|---|---|
| model authority | nodes 可读、schema/profile 通过 |
| projection provider | archctx CLI 存在、版本满足、feature handshake 通过 |
| P1/P2 code facts | CodeGraph 版本正确、index 与当前 worktree 同步 |
| apply | daemon/embedded runtime 可用、ChangeSet preview 允许 |

当：

```json
"architecture": {
  "projection_provider": "archctx"
}
```

被启用时，后两项必须成为 strict readiness，而不能继续 advisory。

---

## P0-6：dirty worktree provenance 与 Stop 阶段不匹配

ArchContext 当前文档 stamp 只有：

```text
branch
HEAD commit
HEAD commit date
```

也就是 `readArchitectureProjectionVerifiedAgainst()` 从当前 HEAD 读取 provenance。

freshness 检查则使用：

```bash
git diff --name-only <stamped-commit>..HEAD
```

并明确只比较已提交历史，不把未提交编辑视为 projection 落后。

这在“提交后手动运行 projection”中可以工作，但与 repo-harness 的 Stop-time dirty-worktree 流程不完全兼容。

### 典型问题

假设：

```text
HEAD = C0
```

agent 修改源代码，但尚未 commit：

```text
worktree = C0 + source changes
```

Stop 阶段运行 projection，文档实际上基于 dirty worktree 生成，却被 stamp 为：

```text
Verified against C0
```

随后 source 和 docs 一起 commit 为 C1。

此时 freshness 比较：

```text
C0..C1
```

会看到 source 改动，于是文档立即被判 stale，即使它正是从那份 source 改动生成的。通常还要在 C1 再跑一次，仅更新 stamp，然后再产生一个额外的 metadata-only commit。

### 修复原则

每个 projection target 应记录：

```json
{
  "baseHeadSha": "C0",
  "worktreeDigest": "sha256:...",
  "sourceTreeDigest": "sha256:...",
  "codeGraphDigest": "sha256:...",
  "projectionInputDigest": "sha256:...",
  "generatedFrom": "worktree"
}
```

freshness 的权威判断应改为：

```text
当前 capability sourceTreeDigest
    ==
manifest sourceTreeDigest
```

而不是仅依赖：

```text
stamp commit..HEAD 是否出现 source path
```

commit stamp 可以继续供人阅读，但不能作为 dirty-worktree projection 的唯一真实性依据。

---

## P0-7：CodeGraph 只检查目录存在，不能证明索引新鲜

文档投影当前检查的是：

```ts
existsSync(".codegraph")
```

如果目录不存在，就不给 P1/P2 facts；如果目录存在，就直接 query。它没有在 `docs plan/apply` 路径先运行 `codegraph sync`，也没有证明 index 对应当前 worktree。

另一个风险是版本不一致：

- repo-harness 依赖 `@colbymchenry/codegraph@1.5.0`；
- ArchContext 声明需要 `1.4.0`；
- ArchContext provider 的 `version` 字段写死为 `1.4.0`；
- executable resolver 会优先使用 PATH 中的 `codegraph`。

这意味着它可能实际运行 1.5.0 binary，却把 adapter snapshot 表述为 1.4.0。是否一定出错取决于 CLI 兼容性，但目前没有可靠握手证明。

### 应改为

在 projection plan 前执行：

```text
1. resolve exact binary
2. read actual --version
3. verify supported version/features
4. codegraph status
5. sync current repository/worktree
6. 记录 graphDigest/indexedWorktreeDigest
7. 再 query
```

任何一步不满足时：

- P1 可以按 profile 决定省略或阻断；
- repo-harness profile 下，声明了 entrypoint 的 P2 应 fail-closed；
- 不能使用旧索引冒充当前架构事实。

---

# 四、其他 P1 问题

## 1. `contractFiles` 与 `localContracts` 没有统一

repo-harness 的 ArchContext node profile 要求：

```yaml
extensions:
  contractFiles:
    agents: ...
    claude: ...
  lspProfile: ...
  verification: [...]
```

其中 `contractFiles` 是人为 authority，不能总由 source prefix 推导。最近修复也特别保留了这一字段。

但 ArchContext module renderer 当前展示的是：

```text
extensions.localContracts
```

而 agent-context target path 则直接根据第一个 `source.include` 推导目录，随后生成该目录下的 `AGENTS.md` 与 `CLAUDE.md`。

这会对以下情况产生错误：

- capability 的 contract 位于 repo root；
- 第一个 include 只是多个 source root 之一；
- 两个 capability 第一个 include 落在同一父目录；
- contract path 与 source path 本来就不是一一对应。

repo-harness profile 下必须以：

```yaml
extensions.contractFiles
```

为 target authority。由第一个 include 推导只能保留为通用 profile 的显式 opt-in fallback。

---

## 2. P2 的 call path 仍有启发式成分

ArchContext 当前 P2：

- 从 entrypoint 文件中选 top-level function/method；
- 最多取前 5 个 seed；
- 每个 seed 最多保留 8 条 call trail；
- 没有 call trail 时省略 sequence diagram。

这些 call 边本身来自 CodeGraph，不是伪造，这是好的。

但“前五个函数就是正确业务入口”并不一定成立。尤其 barrel file、CLI dispatcher、注册表文件，很容易选到：

- helper；
- parser；
- setup function；
- 非主要 handler。

建议 node 增加明确语义：

```yaml
source:
  entrypoints:
    - path: src/cli/index.ts
      symbols:
        - main
      sinks:
        - ChangeSetEngine.apply
```

P2 结果应有三态：

```text
proven
not-applicable
unprovable
```

repo-harness profile 下，如果 capability 声明需要 P2 而结果为 `unprovable`，应产生 human-action-required，而不是生成看似完整但不可信的图。

---

## 3. Stop event 失败后仍可能被消费

`spawnSync()` 非零退出不会抛异常。当前 `processArchitectureCascade()` 没有检查 `architecture-queue` 的 status；后续 context sync 的 status 也被忽略。

外层 consumer 只在抛异常时保留 pending event。因此子命令非零失败仍可能导致该事件被删除。

接入 projection 后这会非常危险，例如：

```text
archctx apply 失败
→ spawnSync 返回 status=1
→ 未抛异常
→ pending event 被删除
→ 文档仍旧，但 runtime 认为任务已消费
```

必须把子进程结果分类成：

```text
success
noop
human-action-recorded
retryable-failure
permanent-failure
```

只有前三种可以 ack/delete。

---

## 4. 缺少真正的跨仓 E2E

ArchContext 当前 readback 验证的是它自己仓库的扁平目标，例如：

```text
docs/architecture/modules/capability-architecture-context.md
```

并验证 temp repo 中的 plan/apply/drift/marker preservation。

这证明了 ChangeSet 和 marker 机制的单仓能力，但不能证明：

- repo-harness 嵌套路径；
- 现有 10 份文档 adoption；
- `contractFiles`；
- Stop-time dirty worktree；
- repo-harness CodeGraph 1.5；
- pending event retry；
- generated-file loop suppression。

目前缺少 consumer-driven integration fixture。

---

# 五、建议的最终架构

```text
┌─────────────────────────────────────────────┐
│ repo-harness                                │
│                                             │
│ mutation journal                            │
│      ↓                                      │
│ Stop-time path aggregator                   │
│      ↓                                      │
│ ArchitectureProjectionProvider              │
│      ↓                                      │
│ durable job + retry + receipt               │
└───────────────────┬─────────────────────────┘
                    │ JSON protocol
                    ▼
┌─────────────────────────────────────────────┐
│ archctx                                     │
│                                             │
│ profile/layout resolution                   │
│ model/profile validation                    │
│ CodeGraph sync + actual version handshake   │
│ source/worktree snapshot                    │
│ deterministic renderer                      │
│ ChangeSet preview/apply                     │
└───────────────────┬─────────────────────────┘
                    ▼
       docs/architecture machine regions

无法确定的设计语义
          ↓
advisory agent investigation
          ↓
P3 / ADR / rationale draft
          ↓
reviewed scoped ChangeSet
```

这里最重要的原则是：

> repo-harness 调度的是 **projection job**；agent 只是其中可选的 advisory semantic worker，不是机器真值区 writer。

---

# 六、具体修复方案

## Phase 0：冻结公开协议与发布边界

先定义一个跨仓 protocol，避免 repo-harness 解析 ArchContext 的人类文本输出。

建议请求：

```json
{
  "schemaVersion": "archcontext.projection-request/v1",
  "profile": "repo-harness/v1",
  "mode": "check",
  "targets": [
    "architecture-docs",
    "agent-context"
  ],
  "changedPaths": [
    "src/cli/hook/mutation-observed.ts"
  ],
  "expected": {
    "headSha": "abc123",
    "worktreeDigest": "sha256:..."
  }
}
```

建议响应：

```json
{
  "schemaVersion": "archcontext.projection-result/v1",
  "ok": true,
  "status": "noop",
  "snapshot": {
    "headSha": "abc123",
    "worktreeDigest": "sha256:...",
    "sourceTreeDigest": "sha256:...",
    "codeGraphDigest": "sha256:..."
  },
  "affectedNodes": [
    "capability.runtime-harness.hook-adapters"
  ],
  "files": [],
  "humanActions": [],
  "receiptDigest": "sha256:..."
}
```

合法状态建议固定为：

```text
noop
planned
applied
adoption-required
human-action-required
blocked
retryable-failure
```

同时加入：

```bash
archctx capabilities --json
```

返回 feature flags：

```json
{
  "features": [
    "docs-projection-v2",
    "repo-harness-layout-v1",
    "mixed-file-adoption-v1",
    "worktree-provenance-v1",
    "codegraph-snapshot-v1"
  ]
}
```

然后发布 `archctx@0.4.0` 与匹配的 contracts 包。

---

## Phase 1：修 ArchContext producer

### 1. 配置驱动的 layout resolver

将 `architectureDocumentationTargetDrafts()` 中的硬编码路径替换为：

```ts
interface ProjectionLayoutResolver {
  resolveEntity(node: NativeNode): string;
  resolveRelation(relation: NativeRelation): string;
}
```

repo-harness profile：

```text
capability.<domain>.<name>
→ docs/architecture/modules/<domain>/<name>.md
```

必须校验：

- repo-relative POSIX path；
- 禁止 `..`；
- 禁止 absolute path；
- 禁止 target collision；
- index 链接必须从最终 resolved target map 生成，而不是重复推导。

### 2. existing files 改为精确路径加载加递归 orphan scan

不能只扫描一层目录。

推荐：

- renderer 先根据 model/profile 得到 expected target paths；
- 精确读取这些 target；
- orphan scan 再递归遍历 `docs/architecture/modules/**`；
- 不要把“目标读取”和“孤儿发现”混成同一层 readdir。

### 3. 增加显式 adoption

普通 apply：

```text
mixed file exists + no marker
→ reject
```

专用 adoption：

```bash
archctx docs adopt \
  --profile repo-harness/v1 \
  --approved \
  --expected-worktree-digest ...
```

迁移后验证：

```text
P3 hash before == P3 hash after
history hash before == history hash after
backlog hash before == backlog hash after
```

### 4. 统一 repo-harness node profile

建议定义：

```text
archcontext.repo-harness-node-profile/v1
```

强制：

```yaml
schemaVersion: archcontext.node/v1
id: capability.<domain>.<name>
kind: capability
status: active
name: ...
summary: ...

source:
  include:
    - packages/example/**
  entrypoints:
    - path: packages/example/src/index.ts
      symbols:
        - main

extensions:
  contractFiles:
    agents: packages/example/AGENTS.md
    claude: packages/example/CLAUDE.md
  lspProfile: typescript-lsp
  verification:
    - bun test
```

并让：

- module intro 的 Local Contracts；
- agent-context target paths；
- write allowlist；
- freshness projection-owned paths；

全部从同一个 canonical parser 读取。

### 5. 修 provenance

manifest target 建议增加：

```json
{
  "generatedFrom": {
    "baseHeadSha": "...",
    "worktreeDigest": "...",
    "sourceTreeDigest": "...",
    "codeGraphDigest": "...",
    "codeGraphVersion": "1.5.0"
  }
}
```

sourceTreeDigest 应至少覆盖：

- node 的 canonical model subset；
- 所有 matched source 文件的 path 与 content hash；
- relevant import/call facts；
- renderer version；
- layout profile version。

这样 source+docs 同 commit 后，不需要再做一次只更新 commit stamp 的 projection。

### 6. CodeGraph 必须先达到 snapshot-ready

加入统一的：

```ts
prepareProjectionCodeFacts(root, expectedWorktreeDigest)
```

顺序必须是：

```text
actual version readback
→ compatibility check
→ index init check
→ sync
→ indexed worktree digest check
→ query
→ graph digest
```

---

## Phase 2：在 repo-harness 增加 provider 层

不要把 `archctx` 命令直接散落在 hook shell 或 mutation consumer 内。

建议新增：

```ts
interface ArchitectureProjectionProvider {
  check(input: ProjectionCheckInput): Promise<ProjectionResult>;
  plan(input: ProjectionPlanInput): Promise<ProjectionResult>;
  apply(input: ProjectionApplyInput): Promise<ProjectionResult>;
}
```

实现：

```text
src/core/architecture/projection-provider.ts
src/core/architecture/providers/archctx.ts
```

policy 拆成两个正交开关：

```json
{
  "context": {
    "capability_source": "registry"
  },
  "architecture": {
    "projection_provider": "archctx",
    "projection_profile": "repo-harness/v1",
    "projection_runtime": "queued",
    "freshness_gate": "strict"
  }
}
```

这样可以先上线 docs projection，而不必同时切 capability authority。

---

## Phase 3：重构 Stop-time orchestration

当前按 path 一个个调用 helper 的模式应改成批处理。

建议流程：

```text
读取全部 pending events
  ↓
合并 changed_paths
  ↓
删除 generated-owned paths
  ↓
一次性 resolve affected capabilities
  ↓
创建一个 coalesced projection job
  ↓
archctx check
  ↓
需要更新时 plan/apply
  ↓
写 receipt
  ↓
ack 所有被该 receipt 覆盖的 pending events
```

job key：

```text
repositoryId
+ baseHeadSha
+ worktreeDigest
+ projectionProfile
+ affectedSourceDigest
```

只有以下结果可删除 pending event：

```text
noop
applied
human-action-recorded
```

以下必须保留并 retry 或进入 dead-letter：

```text
CLI missing
protocol mismatch
CodeGraph stale
ChangeSet conflict
worktree changed
apply failed
unexpected output
```

同时必须避免 self-trigger loop：

```text
docs/architecture/**
derived AGENTS.md / CLAUDE.md
projection manifest
```

应标记为 projection-owned，并从新一轮 source mutation 中剔除。

---

## Phase 4：替换 completion gate

`check-architecture-sync` 应变成统一 aggregator：

```text
1. capability authority valid
2. archctx projection drift clean
3. source/worktree freshness clean
4. no adoption-required target
5. no unresolved human architecture action
6. pending architecture request cards supplementary check
```

routine machine drift 不应继续通过 request card 表达。

request card 只保留给：

- P3 语义判断；
- ADR；
- CodeGraph 无法证明的 P2；
- ambiguous ownership；
- adoption 冲突；
- 需要人工选择的 architecture change。

---

## Phase 5：repo-harness 自身迁移顺序

不要同时切所有 authority。

推荐顺序：

1. 保持：

   ```json
   "capability_source": "registry"
   ```

2. 从现有 registry 生成完整 ArchContext nodes，但暂不切 authority。

3. 用 repo-harness profile 校验 10 个 capability 的：

   - ID；
   - nested module path；
   - source include；
   - contractFiles；
   - verification；
   - owner resolution。

4. 对 10 份现有 module docs 执行 dry-run adoption。

5. 验证：

   ```text
   不创建任何 docs/architecture/modules/capability-*.md
   ```

6. 执行 marker adoption。

7. 启用：

   ```json
   "projection_provider": "archctx"
   ```

8. 连续运行两次 projection，第二次必须零 diff。

9. 经过一段双轨观察后，再一次性切：

   ```json
   "capability_source": "archcontext"
   ```

10. 切换后继续维持 no-fallback，不做长期 JSON/YAML 双向同步。

---

# 七、必须建立的跨仓验收矩阵

| 场景 | 必须结果 |
|---|---|
| 修改一个 capability 的一个源文件 | 只更新对应 nested module |
| 同一 Stop 有十个 changed paths | 只产生一个 coalesced projection job |
| target 已存在但无 marker | 普通 apply 拒绝，要求 adoption |
| 执行 adoption | P3、历史、Backlog byte-for-byte 不变 |
| 连续执行两次 apply | 第二次零 diff |
| CodeGraph 目录存在但 index stale | 阻断或先同步，不能直接使用 |
| PATH CodeGraph 版本不兼容 | 明确失败，不得声称是另一版本 |
| alias/workspace import | 必须解析，或显式标记 unprovable |
| entrypoint 无有效 call trail | human-action-required，不生成假图 |
| apply 前 worktree 又改变 | ChangeSet 拒绝，pending event 保留 |
| archctx 子进程 exit 1 | pending event 不得被消费 |
| source 与 docs 同 commit | commit 后 freshness 立即 clean，不要求第二个 restamp commit |
| projection 写入 docs | 不得再次触发无限 projection loop |
| agent 产生 P3 draft | 不得直接修改 P1/P2 |
| clean-room 安装 npm 发布包 | feature handshake、plan、apply 全部通过 |
| 现有 10 个 repo-harness capability | node、module、contract、workstream 10/10 一致 |

---

# 最终判断

我会把当前状态定义为：

```text
Stage 0 capability authority adapter: PASS
ArchContext standalone projection core: CONDITIONAL PASS
repo-harness ↔ archctx runtime integration: FAIL
existing-doc adoption readiness: FAIL
published distribution readiness: FAIL
production cutover readiness: NO-GO
```

最关键的修复优先级是：

1. **先发布真正包含修复的新 archctx 版本；**
2. **实现 repo-harness profile 的配置驱动嵌套路径；**
3. **加入显式 marker adoption，禁止无 marker 自动 append；**
4. **以 worktree/source digest 取代 commit-only freshness；**
5. **建立 CodeGraph sync/version/snapshot 握手；**
6. **在 repo-harness 增加 projection provider 与 durable Stop-time job；**
7. **最后才切 capability authority。**

在这些条件完成前，应保持：

```json
"context.capability_source": "registry"
```

或至少不要把该开关误认为文档 updater 已接管。当前最合理的下一工作包应命名为类似：

```text
archctx-repo-harness-projection-runtime-integration
```

而不是继续在 Stage 0 capability source patch 上追加零散逻辑。

本次结论基于两仓当前主干、最近提交、PR 实现、投影引擎、ChangeSet、hook 与 readback 测试的静态交叉审查；我没有完成本地双仓整套测试执行。因此我不对“现有单仓测试全部通过”作独立保证，但上述 P0 断点来自直接调用链、路径常量、版本号与写入行为，并不依赖运行时猜测。
