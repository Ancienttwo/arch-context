# Sprint: ArchContext ↔ repo-harness Projection Runtime Integration

> **Status**: Approved
> **Slug**: archctx-repo-harness-projection-runtime-integration
> **Created**: 2026-08-08 14:33 +08:00
> **Updated**: 2026-08-08 14:59 +08:00
> **Goal Mode**: incremental
> **Primary Repository**: `/Users/ancienttwo/Projects/arch-context`
> **Consumer Repository**: `/Users/ancienttwo/Projects/repo-harness`
> **Verified Revisions**: `arch-context@4c9c1c17ddaa6ae723536e72e757952000be9b10`; `repo-harness@1eaf63019aadd2129376987957170d8310b35c3f`
> **Source Review**: `docs/researches/20260808-GPT-review.md`
> **Reference Document**: `/Users/ancienttwo/Projects/byok-sdk/docs/architecture/sdk-architecture.md`
> **Release Targets**: `archctx-contracts@0.4.0`, `archctx@0.4.0`, `repo-harness@0.14.0`

Program-level Sprint container. Each backlog row is one independently useful,
reviewable merge unit and must be expanded with `$think` into a detailed work
package before implementation. Approval of this Sprint authorizes planning and
implementation in sequence; npm publication and authority cutover remain explicit
release gates in AXR8.

## Executive Decision

当前设计只有一半成立：`repo-harness` 已能把 ArchContext nodes 作为 capability
索引 authority 读取，但它没有在 agent runtime 中调度 ArchContext 的确定性文档
投影，因此 `docs/architecture/*` writer 链仍然断开。修复方向不是让 LLM agent
自由编辑 P1/P2，而是让 `repo-harness` 调度一个 durable projection job，由
`archctx` 完成 CodeGraph snapshot、deterministic render、ChangeSet apply 与 receipt；
agent 只处理无法机器证明的 P3/ADR/语义提案。

本 Sprint 选择以下原子边界：

1. `context.capability_source` 继续只决定 capability 索引 authority。
2. 新增正交的 `architecture.projection_provider`，只决定架构投影 writer。
3. 最终发布态中，`archctx` 是 `repo-harness` 的固定版本 runtime dependency，不再
   从 PATH 猜 CLI；AXR5–AXR7 只在 disposable integration workspace 中安装带完整
   integrity 的 packed tarballs，AXR8 验证后才写入 registry exact pins。
4. ArchContext 的 machine region 只能经 ChangeSet/daemon 写入。
5. 模块重大功能变化由 `ArchitectureRefreshSignalV1` 回传，`repo-harness` 在同一
   durable job 中刷新 capability index/context/readiness，并写 refresh receipt。
6. Mermaid skill 保持为外部 agent authoring/review skill；产品 runtime 不读取或
   vendor `SKILL.md`。官方 Mermaid CLI 仅作为精确 pin 的 dev/release validator。

当前结论是 **NO-GO for authority cutover**。只有 AXR0–AXR8 的 exit gates 全部
通过后，才允许把 repo-harness 自身的 `capability_source` 从 `registry` 切到
`archcontext`。

## PRD

### Problem

- `repo-harness` 的 PostToolUse journal 在 Stop 阶段只调用
  `architecture-queue`、`context-contract-sync` 与 `capability-context request`；
  没有调用 `archctx docs check/plan/apply`。
- Stop consumer 忽略 `spawnSync()` 非零 status，子命令失败后仍可能删除 pending
  event，造成“文档未更新但事件已消费”。
- ArchContext renderer 使用 flat module path，而 repo-harness 的 authority path 是
  `docs/architecture/modules/<domain>/<capability>.md`；existing file loader 也不递归。
- mixed-ownership 文档无 marker 时，当前逻辑会 append 新 generated region，不能
  安全接管现有 10 份高质量架构文档。
- 当前 provenance 只绑定 HEAD commit，不能证明 dirty-worktree Stop projection；
  CodeGraph 只看目录存在，不能证明实际 binary/version/index snapshot 新鲜。
- 当前 P1 是目录/import 图，P2 participant 是文件路径且 call trail 混入 type
  reference；输出达不到 BYOK 参考文档的 semantic architecture/dataflow 标准。
- npm `archctx@0.3.0` 不含 2026-08-08 合入的修复，repo-harness 也没有 runtime
  `archctx` dependency。
- ArchContext 尚未向 repo-harness 回传“模块重大功能变化，需要刷新 agent
  context/index/readiness”的 typed signal。

### Users

- 在 Claude Code/Codex agent runtime 中持续修改代码、期望架构上下文自动保持
  新鲜的开发者与 coding agents。
- 依赖 `docs/architecture/*`、AGENTS/CLAUDE capability context 与
  `check-architecture-sync` 做 review/completion gate 的维护者。
- 需要证明图、文档、source tree、CodeGraph 与 worktree 属于同一 snapshot 的
  架构和安全审查者。

### Goal

建立一条可重放、fail-closed、版本固定的双仓链路：代码变更被 repo-harness
聚合后，只生成一个 durable projection job；archctx 对同一 worktree snapshot
生成 BYOK 级别的 semantic P1 Mermaid 图和 P2 dataflow sequence diagram，经
ChangeSet 写入；重大功能变化再通过 typed signal 触发 repo-harness context
刷新；所有原 mutation events 只有在 projection/refresh receipt 持久化后才 ack。

### Success Criteria

- 同一 Stop 的任意数量 changed paths 只产生一个 coalesced projection job 和至多
  一次 projection subprocess；`capabilities --json` cold handshake 单独计数，并按
  package version、tarball integrity 与 protocol version 缓存。
- nested module path、index link、agent-context target 与 orphan scan 共享同一个
  resolved target map；不会生成 `docs/architecture/modules/capability-*.md`。
- existing mixed document 无 marker 时普通 apply 必须返回
  `adoption-required`；显式 adoption 后 P3、历史、Backlog 与 marker 外内容
  byte-for-byte 不变。
- projection manifest 绑定 base HEAD、worktree、source tree、CodeGraph、model、
  renderer 与 layout digests；source 与 docs 同 commit 后立即 fresh。
- CodeGraph 实际 binary、实际 version、sync status 与 indexed worktree digest
  全部握手；旧 index 或不兼容 version 不得生成 verified diagram。
- 每个需要 P1 的 scope 输出 semantic Mermaid architecture map；每个需要 P2 的
  dataflow 输出 semantic `sequenceDiagram`，包含 `autonumber`、真实参与者、成功
  终态，以及证据支持的 `alt`/`else`/`loop`。无法证明时不生成假图。
- 模块 semantic fingerprint 或 verified flow proof 发生重大变化时，archctx
  返回一个幂等 refresh signal；repo-harness 刷新指定 surfaces 并持久化 receipt。
- implementation-only refactor、formatting、LOC 阈值、generated docs 变化不得被
  误判为重大功能变化。
- `projection_provider=archctx` 时 readiness 对 CLI/version/features/CodeGraph/
  ChangeSet apply 严格检查；provider disabled 时不改变现有 registry-only 行为。
- clean-room 安装发布包后，capabilities handshake、nested adoption、plan/apply、
  second-run zero diff、major-change refresh 与 failure retry 全部通过。

### Non-goals

- 不让 agent 直接写 `.archcontext` model、SQLite ledger、generated P1/P2、policy、
  waiver 或 adoption receipt。
- 不用 LLM/regex/文件名/“前五个函数”猜架构语义或错误分支。
- 不建立长期 JSON registry ↔ YAML node 双写、双读或失败 fallback。
- 不把 Mermaid skill、skill assets、Chromium 或 Mermaid renderer 打进 archctx
  生产 runtime/tarball。
- 不在本 Sprint 推进 ledger-authoritative promotion、cloud control plane、全仓
  P3/ADR 自动写作或任意 Markdown 重排。
- 不重写 marker 外人工 prose，也不把 BYOK 文档内容复制进 fixtures。

## P1 · Global Architecture Map

### Real Components and Boundaries

| Component | Authority / Responsibility | Current Entry | Planned Change |
|---|---|---|---|
| repo-harness mutation observer | 捕获 changed paths；PostToolUse 热路径只写 journal | `src/cli/hook/mutation-observed.ts` | 保持无 subprocess；增加 projection dirty bit 的 typed payload |
| repo-harness Stop orchestrator | 聚合、durable job、retry/dead-letter、receipt、completion gate | `consumePendingPostEditEvents()` → `runStopHandler()` | 不再逐 path 调 helper；统一调用 provider |
| repo-harness capability authority | 选择 registry 或 ArchContext nodes，负责 owner/index | `src/core/capabilities/registry.ts` | 与 projection provider 保持正交；最终才 cut over |
| ArchContext provider adapter | 固定版本 JSON subprocess protocol | 当前不存在 | 由 repo-harness package-local dependency 解析，不查 PATH |
| ArchContext profile/layout | model/profile 校验、nested target map、ownership/adoption | `packages/core/projection-engine/src/index.ts` | 拆出 profile/layout/adoption 边界，消除重复路径推导 |
| CodeGraph snapshot adapter | 实际 binary/version/sync/query/evidence digest | `packages/local-runtime/codegraph-adapter/src/index.ts` | 绑定 indexed worktree snapshot，拒绝 stale/mismatch |
| deterministic renderer | 生成 intro/P1/P2/manifest/refresh signal | projection engine | semantic node/relation/flow 输入；renderer v2 |
| ChangeSet/daemon | 唯一 machine write authority、冲突检测与回滚 | CLI `docs plan/apply` → daemon | 保持现有边界；增加 projection request/result receipt |
| advisory agent lane | 调查 unprovable P2、P3、ADR、rationale | architecture request/agent fleet | 只输出 typed proposal；不能直接 mutate |
| Mermaid tooling | 作者/审查 skill 与 release-time render validator | policy 中 external skill | skill 不入产品依赖；CLI 仅 devDependency |

### Scale Signals

- ArchContext 当前核心压力面为 projection engine 2,177 LOC、CLI 3,400 LOC、
  CodeGraph adapter 748 LOC、ledger contracts 772 LOC，相关四个入口合计 7,097 LOC。
- repo-harness 当前链路集中在 mutation observer 902 LOC、Stop handler 570 LOC、
  capability registry 776 LOC、capability context 581 LOC 与 architecture helper
  842 LOC，合计 3,671 LOC。
- repo-harness 已有 10 份 nested capability documents；它们是 adoption fidelity 的
  real consumer fixture，不允许由 flat synthetic fixture 替代。
- BYOK reference 含 23 个 Mermaid blocks：15 个 flowchart、6 个 sequenceDiagram、
  2 个 stateDiagram。其质量来自 semantic actors/boundaries/status/error branches，
  不是仅仅“能 parse Mermaid”。

### Target Topology

```text
Host edit
   |
   v
repo-harness PostToolUse journal  -- hot path: atomic enqueue only
   |
   v
Stop path aggregator
   |
   +--> durable ProjectionJobV1 ---- retry / dead-letter / SessionStart visibility
   |          |
   |          v
   |    ArchitectureProjectionProvider
   |          |
   |          | cached capability handshake + one bounded projection subprocess
   |          v
   |      archctx@0.4.0 tarball (AXR5–AXR7) / registry exact pin (AXR8)
   |          |
   |          +--> profile + nested layout + explicit adoption
   |          +--> worktree/source/model snapshot
   |          +--> CodeGraph 1.5.0 actual-version sync + graph snapshot
   |          +--> semantic P1/P2 renderer v2
   |          +--> ChangeSet preview/apply/rollback
   |          |
   |          v
   |    ProjectionResultV1 + ProjectionReceiptV1
   |          |
   |          +--> docs/architecture machine regions
   |          +--> ArchitectureRefreshSignalV1
   |                              |
   |                              v
   +---------------------- repo-harness refresh consumer
                                  |
                                  +--> capability index/source map
                                  +--> controlled AGENTS/CLAUDE context blocks
                                  +--> architecture request context when human action is required
                                  +--> readiness/freshness receipt

Unprovable semantic change --> advisory agent proposal --> reviewed ChangeSet only
```

### Strong and Weak Dependencies

- Strong: projection result schema, worktree digest, target map, CodeGraph snapshot,
  ChangeSet receipt、refresh receipt；任一不匹配都 fail-closed。
- Strong: `extensions.contractFiles` 是 repo-harness profile 的 contract target
  authority；不能从第一个 source include 推导。
- Weak/advisory: agent rationale、P3 draft、request card prose；它们不能变成 P1/P2
  或 node/flow authority。
- External/dev-only: Mermaid skill、`@mermaid-js/mermaid-cli@11.16.0`；不参与生产
  投影语义。

## P2 · Concrete Data Flow Trace

### Current Broken Route

1. Host edit 进入 `runMutationObserved()`，写入
   `.ai/harness/journal/post-edit/pending/*.json`。
2. Stop 调用 `consumePendingPostEditEvents()`，按 event、再按 changed path 调
   `processArchitectureCascade()`。
3. cascade 只运行 `architecture-queue record`、`context-contract-sync sync-latest`
   与 `capability-context request`；没有 ArchContext provider。
4. `spawnSync()` 非零 status 没有变成 exception；consumer 随后删除 pending file。
5. 最终副作用是 request/card/context 更新，不是 `docs/architecture/*` ChangeSet。
6. 断点位于 repo-harness Stop consumer 与 archctx CLI/daemon 之间；
   `capability_source=archcontext` 只改变读 authority，不能填补这个 writer 断点。

### Target Happy Path

1. PostToolUse 只原子写入 `PostEditJournalEventV2`，记录 changed paths、session、
   subject revision 与 architecture dirty bit，不读取 model、不启动 subprocess。
2. Stop 一次读取全部 pending events，去重 changed paths，排除 projection-owned
   outputs，并按 repository/worktree/profile/source digest 生成一个 job key。
3. durable job 先写入 pending，再由同一 Stop 尝试一次 bounded drain；projection
   hard timeout 为 120 秒，不在 hook 内 sleep/retry。repo-harness-managed
   `Stop.default` host entry 的 timeout 固定为 150 秒，给 drain 后 receipt/telemetry
   留 30 秒收尾；其他 hook route 继续使用 30 秒。
4. provider 从 AXR5–AXR7 disposable consumer 中安装的 verified tarball、或 AXR8
   发布后的 repo-harness package dependency 解析 `archctx@0.4.0`。它先调用
   `capabilities --json`，验证 package/protocol/renderer/features 全匹配；同一
   package integrity 的后续 job 使用已验证 handshake cache。
5. repo-harness 发送 `ProjectionRequestV1`；archctx 重新计算 repository/worktree
   identity，若与 request expected snapshot 不同立即返回 retryable failure。
6. archctx 解析 profile 与 canonical target map，校验 adoption state、node/flow
   schemas、contractFiles 与 target collision。
7. CodeGraph adapter 解析 package-local 1.5.0 binary，readback actual version，sync
   当前 worktree，验证 indexed worktree digest 后才查询 facts。
8. renderer 从 accepted model + verified facts 生成 P1/P2；ChangeSet preview 校验
   preimage/output digests，apply 后得到 resulting worktree/projection receipt。
9. 若 semantic fingerprint 或 verified flow proof 属于重大变化，result 携带一个
   幂等 refresh signal；普通 implementation refactor 不携带该 signal。
10. repo-harness 校验 result/receipt，再调用 canonical capability/context refreshers；
    将 projection receipt 与 refresh receipt 原子绑定。
11. 只有完整 receipt 覆盖的 journal events 才从 pending ack；第二次相同 snapshot
    返回 noop，同一 signal ID 也返回 refresh noop。

### Async, Error, and Human-action Boundaries

| Condition | Result classification | Journal/job behavior | User-visible gate |
|---|---|---|---|
| projection clean | `noop` | receipt 后 ack | clean |
| ChangeSet applied + refresh complete | `applied` | receipt 后 ack | clean |
| mixed file missing marker | `adoption-required` | 写 durable human action；event 可由该 action receipt 覆盖 | strict gate blocked |
| P2 required but unprovable | `human-action-required` | 写 architecture request；可调 advisory agent | strict gate blocked |
| CLI/CodeGraph transient failure、timeout、worktree changed | `retryable-failure` | 保留 job；下一 Stop/显式 drain 重试，最多 3 次 | pending/blocked |
| protocol/version/schema invalid | `permanent-failure` | 原子移入 dead-letter，保留原 event references | blocked |
| archctx exit non-zero/invalid JSON | classified failure | 绝不删除 pending event | blocked |
| projection-owned output edit | excluded input | 不创建新 source job | receipt/readiness only |
| advisory agent proposal | proposal only | 不 ack semantic action，直到 reviewed ChangeSet accepted | blocked until accepted |

## P3 · Design Decisions

### Why the Current Shape Exists

- Stage 0 直接用 Bun YAML 读取 ArchContext nodes，目的是让 capability index 不依赖
  外部 CLI；对“读 authority”是合理的，因此保留 no-fallback。
- PostToolUse 只写 journal、Stop 再做重活，是为了保护 edit hot path；问题是 Stop
  consumer 没有可靠 status/receipt，而不是 journal 模式本身。
- commit stamp 适合 commit 后手动 projection，但不适合 Stop-time dirty worktree；
  因此保留人类可读 commit 信息，同时把机器 freshness authority 切到 digests。
- mixed document append 可能为 greenfield 降低门槛，但对已有 P1/P2 是 destructive
  semantic duplication；brownfield 必须显式 adoption。

### Chosen Approach

- 新增独立 provider protocol 与 durable job store，不把 `archctx` 调用散落进 hook
  handler 或 shell helper。
- repo-harness 只解析受验证安装根中的 package-local `archctx@0.4.0`；AXR5–AXR7
  由 packed tarball integration overlay 提供，AXR8 才切 registry exact dependency。
  archctx 同样解析自己的 package-local CodeGraph 1.5.0。PATH 不属于 authority，
  tarball overlay 也不是 runtime fallback。
- 新增 first-class `ArchitectureFlowV1`，把 semantic participants、ordered messages、
  branch/loop、terminal outcomes 与 evidence selectors 变成 declared truth；CodeGraph
  只证明 bindings，不发明语义。
- `archcontext.node/v2` 原子替换 v1 的 string-only entrypoints，改为明确的 path、
  symbol 与 sink selectors。不会在 v1 上添加 string/object 双形状兼容 reader。
- refresh signal 只由 accepted semantic delta、verified flow proof delta 或 durable
  human-action classification 产生；不使用 LOC、关键词、文件名或 LLM score。

### Core Invariants

- 一个 configuration axis 只有一个 authority；provider 失败不退回 request-card
  writer，也不切回 registry/YAML 另一边。
- agent 永远 advisory-only；P1/P2、model、policy、receipt 的 mutation authority 不变。
- 所有写入绑定 expected worktree digest 与 preimage hash；worktree 在 check/plan/apply
  间变化必须拒绝。
- index links、module targets、agent-context targets、allowlist、owned paths 与 orphan
  scan 只消费同一个 resolved target map。
- receipt 不持久化 raw source、raw diff、prompt/completion 或完整 CodeGraph output。

### Mermaid Dependency Decision

- 不新增 Mermaid skill 作为 npm/runtime dependency。两个仓 policy 已把它声明为
  external required skill，Codex/Claude 当前安装也指向同一份 managed skill；继续
  遵守 do-not-vendor。
- 在 ArchContext root 精确 pin `@mermaid-js/mermaid-cli@11.16.0` 为
  `devDependency`，新增 `verify:architecture-mermaid`。它只在 test/release profile
  抽取并 render generated Mermaid fences，绝不进入 `archctx` production tarball。
- release gate render 所有 generated diagrams；人工 Architecture review 使用 Mermaid
  skill 检查至少 global P1、正常 P2、含 alt/error 的 P2 三个 SVG。skill review 是
  review evidence，不是 semantic authority。

### Rejected Alternatives

| Alternative | Rejection reason |
|---|---|
| Stop handler 直接散落 `archctx docs apply` shell call | 无版本/协议/receipt 边界，重复当前 non-zero 被吞问题 |
| 让 LLM agent 自由改 P1/P2 | 破坏 deterministic authority、可重放性与 ledger mutation rule |
| 只安装 Mermaid skill，不增加 renderer validation | skill 能指导作者，但不能证明自动生成的每个 fence 可 parse/render |
| 把 Mermaid/Chromium加入生产 dependency | 增大 supply-chain/安装体积，且 renderer 只需输出文本 |
| 继续用 raw file paths/top-five functions 生成 P2 | 不能证明业务顺序、参与者语义、错误分支或终态 |
| v1 entrypoints 同时接受 string 和 object | 形成长期双形状 compatibility path，模糊消费者 contract |
| registry 与 YAML 长期双写/merge | owner/index 可能分裂；只允许有明确结束条件的一次迁移窗 |
| 仅用 commit range 判 freshness | dirty worktree projection 会在 source+docs 同 commit 后立即误报 stale |

### 10x Behavior

- changed paths 从 10 增至 1,000 时，job 数仍为 1；request 只含路径与 digests，
  不含 source bodies。
- renderer target work 按 affected capability bounded；global index 只重建一次。
- retry budget 固定为 3 次跨 Stop attempts，无 hook 内 sleep；第四次原子 dead-letter。
- projection hard timeout 120 秒，managed Stop hook timeout 150 秒；目标仓 acceptance
  要求 representative single-capability p95 不高于 30 秒、10-capability full
  projection p95 不高于 90 秒，并用实际 host Stop cycle 证明 hook runner 不会在
  projection receipt 落盘前终止进程。
- 最先可能失效的是 CodeGraph sync/query，而不是 renderer；因此 graph snapshot
  handshake 和 timeout telemetry 是 release gate，不以 stale cache 降级继续。

### Most Fragile Assumption

最脆弱的假设是：repo-harness 现有 10 个 capability 能在不引入未经证明语义的前提下，
补齐足够的 node/relation/flow declarations，使自动投影达到现有人工 P1/P2 的信息量。
AXR3 与 AXR7 用 fail-closed fidelity gate 验证该假设：任何 capability 缺 semantic
participants、terminal outcomes 或 evidence bindings，都保持原文档不动并进入
`human-action-required`，不能以较差自动图完成 adoption。

AXR3 work package 不会直接扩到全部 10 个 capability：先把
`verification/codegraph-readiness` 作为简单样本、
`runtime-harness/hook-adapters` 作为复杂样本写成 node/relation/flow fixtures；两者
必须在不复制人工 prose、不发明分支的条件下达到 `proven` 并记录 declaration LOC、
evidence coverage 与人工审查时间，才允许扩展其余 capability。这个 gate 属于 AXR3
同一 merge unit，不创建独立 spike phase。

## Public Contract and File-interface Changes

### Configuration

| Key | Values | Default | Rule |
|---|---|---|---|
| `context.capability_source` | `registry`, `archcontext` | `registry` | 只选择 capability index authority；保持现有 no-fallback |
| `architecture.projection_provider` | `disabled`, `archctx` | `disabled` | 与 capability source 正交；`archctx` 缺失或不匹配时 fail-closed |
| `architecture.projection_profile` | `repo-harness/v1` | provider disabled 时不使用 | provider=archctx 时 required |
| `architecture.projection_runtime` | `queued` | provider disabled 时不使用 | 只允许 durable job lane，不提供 direct/best-effort lane |
| `architecture.freshness_gate` | `advisory`, `strict` | `advisory` | dogfood 先 advisory；AXR8 才切 strict |

### ProjectionRequestV1

| Field | Contract |
|---|---|
| `schemaVersion` | `archcontext.projection-request/v1` |
| `requestId` | repo/worktree/job-key derived stable ID |
| `profile` | `repo-harness/v1` |
| `mode` | `check`, `plan`, `apply`, `adopt` |
| `targets` | closed set: `architecture-docs`, `agent-context` |
| `changedPaths` | sorted, unique, repo-relative POSIX paths; no bodies |
| `expected` | repositoryId、workspaceId、headSha、worktreeDigest |
| `adoptionPlanId` | mode=adopt 时 required；绑定 reviewed preview 与 preimage hashes |

### ProjectionResultV1

| Field | Contract |
|---|---|
| `schemaVersion` | `archcontext.projection-result/v1` |
| `status` | `noop`, `planned`, `applied`, `adoption-required`, `human-action-required`, `blocked`, `retryable-failure`, `permanent-failure` |
| `inputSnapshot` / `outputSnapshot` | head/worktree/sourceTree/model/codeGraph/projectionInput digests |
| `affectedNodeIds` | sorted semantic node IDs |
| `files` | repo-relative path、action、preimage/output digest；无 file body |
| `humanActions` | closed reason code、affected IDs、request/card payload digest |
| `refreshSignals` | `ArchitectureRefreshSignalV1[]`，按 signalId 排序 |
| `receiptDigest` | 对 temporal fields 外的 canonical result 计算 |

### ArchitectureRefreshSignalV1

| Field | Contract |
|---|---|
| `schemaVersion` | `archcontext.architecture-refresh-signal/v1` |
| `signalId` / `idempotencyKey` | repository + worktree + resulting semantic/proof digests + reason codes + node IDs 的 digest |
| `mode` | `refresh-required`, `human-action-required` |
| `repository` / `worktree` | post-projection identity；stale signal 必须拒绝 |
| `cause` | `accepted-semantic-delta`, `verified-flow-proof-delta`, `unresolved-major-candidate` |
| `reasonCodes` | closed major-change taxonomy |
| `affectedNodeIds` | sorted non-empty IDs |
| `refreshTargets` | `capability-index`, `capability-context`, `architecture-contract-context`, `architecture-request-index`, `architecture-readiness` |
| `baseDigests` / `resultingDigests` | model、sourceTree、flowProof、projection digests |
| `projectionReceiptDigest` | 产生 signal 的 accepted projection receipt |

### Major-change Taxonomy

会触发 refresh 或 human-action signal 的 closed reasons：node added/removed/moved/
renamed、responsibility changed、entrypoint changed、interface changed、relation changed、
constraint changed、ownership changed、lifecycle changed、risk boundary changed、verified
flow proof changed。

不会触发 major signal：formatting/comment、LOC threshold、普通 source hash 变化、
renderer/layout-only change、generated docs/manifest/context block 写入、没有 accepted
semantic delta 的 implementation refactor。未接受但高影响的 candidate 只发
`human-action-required`，不得刷新出新的 semantic truth。

### Architecture Model and Diagram Contracts

- `archcontext.node/v2`：structured entrypoints 必须声明 path、明确 symbols 与 expected
  sink selectors；v1 string-only reader 在 0.4.0 product path 中删除。
- `archcontext.flow/v1`：first-class file 位于 `.archcontext/model/flows/*.yaml`，声明
  capability scope、semantic participants、ordered message/alt/else/loop steps、terminal
  outcomes、evidence selectors 与 applicability。
- compiler outcome 只有 `proven`、`not-applicable`、`unprovable`。required flow 为
  `unprovable` 时不输出 sequence diagram，转 human action。
- CodeGraph evidence 只验证 selector/call/import bindings；semantic label、顺序、分支
  与 outcome 来自 accepted flow contract。

### Document Quality Profile: repo-harness/v1

- index/current status 明确区分已实现接线、已实现隔离、保留字段、目标设计；
  `Verified against` 同时展示人类可读 HEAD 与 machine snapshot digests。
- global P1 与 capability P1 使用 semantic nodes、runtime/ownership boundaries、
  stores/external systems/contracts；禁止只画目录树或 path-to-path imports。
- Mermaid flowchart 使用 semantic `classDef`、明确 subgraph boundary、高对比文字与
  GitHub light/dark 可读色；带标点的 labels 必须 quoted。
- P2 sequence 使用 semantic participant labels，不把 repo-relative path 当 participant
  display name；必须 `autonumber`，并在证据存在时表达 `alt`/`else`/`loop`、错误与终态。
- 每个 diagram 旁列出 proof status、source/graph digest 与未覆盖边界；不把 candidate
  图标为 verified。
- mixed file 只管理 intro/P1/P2 marker region；P3、history、Backlog 与其他人工段落
  永远在 marker 外。

## Migration, Release, and Rollback

### Bounded Migration Window

1. 保持 repo-harness `capability_source=registry`、provider disabled。
2. AXR4 完成后分别执行 `npm pack`，记录 `archctx-contracts@0.4.0` 与
   `archctx@0.4.0` tarball 的 sha512/integrity；AXR5–AXR7 只在 disposable
   cross-repo consumer 中用 `file:` pins 安装这两个 tarballs，不发布 npm、不把
   `file:` path 提交到 product manifest。AXR8 clean-room E2E 通过后才发布并换成
   registry exact pins。
3. 修正 registry export 的 directory prefix 为 `<dir>/**`，生成 node v2 基线；通过
   reviewed ChangeSet 补齐 relations/flows，期间 registry 仍是 index authority。
4. 对 10 个 nested documents 运行 adoption preview；任何 fidelity/unprovable 失败都
   不写文件。
5. 执行 approved adoption，启用 provider + advisory gate，完成三个具名 clean cycles：
   clean snapshot、single-capability dirty snapshot、multi-capability dirty snapshot。
6. 三个 cycle 均有 projection + refresh receipts 且第二次 apply zero diff 后，把
   freshness gate 切到 strict。
7. 最后一次性把 capability source 切到 archcontext，删除迁移期 registry→node sync
   job；不保留长期双写。

### Release Order

1. 先通过 `npm whoami` 证明发布身份。允许的认证 lane 只有 interactive web-auth，
   或具备 publish 权限并 bypass 2FA 的 granular access token；classic token 不属于
   可用 lane。`EOTP`/`E403` 视为 npm auth-policy blocker，不以重试或改代码绕过。
2. `archctx-contracts@0.4.0` preflight、publish、registry/tarball integrity readback。
3. `archctx@0.4.0` 绑定 contracts 0.4.0，clean-room install、capabilities 与 render
   readback 后 publish。
4. repo-harness product manifest 将 AXR5–AXR7 的 tarball-tested contract 换成两个
   registry exact pins；`repo-harness@0.14.0` 全量 CI、tarball smoke 后 publish。
5. selected Bun-global `repo-harness` 更新后，用 `repo-harness status --json`、
   `check-architecture-sync` 与真实 Stop cycle readback；source checkout version 不算
   live runtime 证据。

### External Release Credentials

- npm publisher account：用于三个 package 的 `npm whoami` 与 publish。
- interactive web-auth 或 bypass-2FA granular token：二选一，均只在 AXR8 release
  环境使用；Sprint、tarball fixtures、receipts 与日志不得持久化 token。
- 本 Sprint 不需要其他 API key、MCP server 或 cloud credential。

### Rollback

- AXR0–AXR4 仅增加 standalone producer/protocol 能力；provider disabled 即不会改变
  repo-harness runtime。
- AXR5–AXR7 回滚时将 provider 设为 disabled，保留 projection/adoption receipts 与
  pending/dead-letter evidence；不自动删除已 adopted markers。
- adoption rollback 使用 receipt 中 preimage hash/bytes，经显式 approved ChangeSet
  恢复；若当前 output hash 已变化则拒绝，不能覆盖新人工编辑。
- authority cutover rollback 只允许回到 migration window 保存并验证过的 registry
  snapshot；不得运行双读 merge。回滚后 strict gate 仍验证 docs projection freshness。
- npm 已发布版本不可覆盖；修复只能发布新版本。

## Cross-repository Acceptance Matrix

| Scenario | Required result |
|---|---|
| 修改一个 capability 的一个 source file | 只影响对应 nested module；一个 job |
| 同一 Stop 有 10 个 changed paths | 一个 coalesced job、至多一次 projection process；cold handshake 单独计数/缓存 |
| managed Stop hook timeout | host config 为 150 秒且不小于 120 秒 drain；真实 Stop cycle 在 receipt 后正常返回 |
| target 已存在但无 marker | 普通 apply 返回 adoption-required，零写入 |
| approved adoption | P3/history/Backlog/marker 外 bytes 不变 |
| 连续两次 apply | 第二次 files=[]、status=noop、Git zero diff |
| `.codegraph` 存在但 stale | sync 到 expected worktree 或 fail；不能使用旧 index |
| actual CodeGraph version 不兼容 | permanent failure，不能伪报支持版本 |
| alias/workspace import 无法证明 | unprovable + human action，不生成假 edge |
| declared P2 无有效 path to sink | human-action-required，不生成 sequence |
| P2 有错误/取消分支 | Mermaid 含 evidence-backed alt/else terminal paths |
| apply 前 worktree 改变 | ChangeSet 拒绝；job/event 保留 |
| archctx exit 1 或 stdout 非 JSON | event 不 ack，strict gate blocked |
| source 与 docs 同 commit | commit 后 freshness clean，无 restamp commit |
| projection 写 docs/context | owned paths 不触发新 projection loop |
| accepted responsibility/interface/flow change | exactly one refresh signal + refresh receipt |
| implementation-only refactor | no major refresh signal |
| duplicate refresh signal | same signalId，consumer noop |
| stale refresh signal | reject；不刷新较新 context |
| unresolved major candidate | refresh pending-action context only；不发布新 semantic truth |
| advisory agent 产出 P3/flow proposal | 不能直接改 P1/P2/model；等待 reviewed ChangeSet |
| generated Mermaid corpus | all fences render to SVG with pinned CLI |
| visual quality review | global P1、normal P2、alt/error P2 在 light/dark 可读 |
| 现有 repo-harness capabilities | node/module/contract/workstream 10/10 一致 |
| `capability_source=archcontext` 读取 node v2 | canonical mapper、script/helper projections 都接受 v2 并拒绝 v1；无双 reader |
| clean-room npm install | handshake、adopt、plan/apply、refresh、retry 全通过 |

## Backlog

Every row uses `contract` mode and must be expanded into a work package. A row may
depend on earlier contracts, but its merged state remains useful and safe if the next
row never lands.

| # | Status | Task | Mode | Acceptance | Plan |
|---|---|---|---|---|---|
| 1 | [ ] | AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator | contract | contracts/CLI tests pass; every generated fixture renders with `@mermaid-js/mermaid-cli@11.16.0`; production tarball excludes Mermaid/Chromium; `archctx capabilities --json` reports exact protocol/renderer/features | (pending) |
| 2 | [ ] | AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption | contract | nested fixture resolves exact module/index/contract paths; unmarked mixed file writes zero bytes; approved adoption preserves all marker-external hashes; second apply is noop | (pending) |
| 3 | [ ] | AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake | contract | actual binary/version/sync/indexed-worktree digests are bound to receipt; stale/mismatch cases fail closed; source+docs same commit remains fresh | (pending) |
| 4 | [ ] | AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler | contract | v1 dual reader absent; proven/not-applicable/unprovable matrix passes; semantic P1 and success/error P2 render; raw path/top-five heuristic cannot produce verified diagram | (pending) |
| 5 | [ ] | AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer | contract | accepted semantic/proof changes emit one stable signal; refactor/generated/layout-only changes emit none; unresolved candidates emit human-action signal; duplicate run preserves signalId | (pending) |
| 6 | [ ] | AXR5 [repo-harness] package-local archctx provider, node v2 reader/exporter, orthogonal config, readiness, and manual command lane | contract | disposable consumer installs integrity-verified 0.4.0 tarballs with no registry lookup; feature handshake passes; canonical mapper and helper projections accept v2/reject v1; PATH mismatch is irrelevant; provider disabled preserves current behavior | (pending) |
| 7 | [ ] | AXR6 [repo-harness] durable Stop aggregation, bounded drain, retry/dead-letter, refresh consumer, receipt, and loop suppression | contract | 10 paths coalesce to one projection process; 150-second managed Stop timeout exceeds the 120-second drain and passes a real host cycle; exit 1/timeout/stale worktree retain events; retry/dead-letter, refresh, and loop gates pass | (pending) |
| 8 | [ ] | AXR7 [both] consumer-driven E2E, 10-document fidelity adoption, completion gate, and advisory dogfood | contract | cross-repo packed-tarball E2E passes; 10/10 nested docs adopt without external-byte drift; three named cycles produce receipts; second apply zero diff; gate accurately reports pending/adoption/human action | (pending) |
| 9 | [ ] | AXR8 [both] npm release, selected-runtime readback, strict gate, and final capability authority cutover | contract | 0.4.0/0.14.0 registry + tarball readbacks pass; selected Bun-global runtime reports exact versions/features; strict Stop/readiness clean; capability authority cutover is 10/10 and no fallback/sync job remains | (pending) |

## Backlog Detail

### AXR0 · Protocol and Mermaid Validation

**Purpose**: freeze the cross-repo machine contract before either repository consumes
human CLI text, and prevent renderer identity collisions with released 0.3.0 output.

**Implementation surfaces**:

- `packages/contracts/src/projection.ts` and package exports.
- runtime schemas for projection request/result/refresh signal/capabilities.
- `packages/surfaces/cli/src/main.ts` for `capabilities --json` and JSON request input.
- projection renderer identity becomes `archcontext.docs-renderer/v2`.
- root `package.json` and lockfile add exact dev-only Mermaid CLI plus
  `verify:architecture-mermaid`.
- package dry-run/readback asserts Mermaid/Chromium are absent from release tarball.

**Verification**:

- `bun test packages/contracts/test/contracts.test.ts packages/contracts/test/publishability.test.ts packages/surfaces/cli/test/cli.test.ts`
- `bun run verify:architecture-mermaid`
- `bun run readback:fg6:npm-release-dry-run`

**Independent value**: even without repo-harness integration, standalone users get
unambiguous renderer/protocol identity and reproducible Mermaid render validation.

### AXR1 · Layout and Adoption

**Purpose**: make ArchContext safe for repo-harness nested brownfield documents before
any automatic runtime trigger exists.

**Implementation surfaces**:

- split the current 2,177-line projection engine into explicit
  `layout.ts` and `adoption.ts` boundaries while keeping `index.ts` public exports.
- one canonical repo-harness profile parser consumes node identity,
  `extensions.contractFiles`, target templates, ownership and projection-owned paths.
- expected target reads are exact; orphan discovery recursively scans configured roots.
- adoption preview records target ranges, preimages, preserved-region hashes and
  ChangeSet ID; apply requires `--approved`, matching worktree digest and preview ID.

**Verification**:

- `bun test packages/core/projection-engine/test/resolve.test.ts packages/core/projection-engine/test/agent-context.test.ts packages/surfaces/cli/test/cli.test.ts`
- new nested-layout/adoption readback covers collision, traversal, symlink, missing marker,
  ambiguous headings, preimage drift, rollback and second-run noop.

**Independent value**: operators can safely run manual nested projection/adoption while
repo-harness remains registry-only and provider disabled.

### AXR2 · Snapshot Provenance and CodeGraph

**Purpose**: prove that docs, facts and source belong to the same dirty worktree instead
of using a commit-only approximation.

**Implementation surfaces**:

- projection input/target manifests add baseHeadSha、worktreeDigest、sourceTreeDigest、
  modelDigest、codeGraphDigest、indexedWorktreeDigest、projectionInputDigest、renderer/
  layout versions and generatedFrom.
- CodeGraph dependency moves to exact 1.5.0; resolver is package-local and reports
  actual `--version`.
- `prepareProjectionCodeFacts()` performs compatibility, status/init, sync, indexed
  snapshot verification, bounded queries and graph digest in that order.
- freshness compares current semantic sourceTreeDigest/proof digest to manifest;
  commit stamp remains display metadata only.

**Verification**:

- `bun test packages/local-runtime/codegraph-adapter/test packages/core/projection-engine/test/projection-freshness.test.ts`
- dirty-worktree, same-commit, stale-index, incompatible-version, timeout and package-local
  binary fixtures all pass.

**Independent value**: manual projections become honest for dirty worktrees even before
semantic diagram or runtime orchestration changes land.

### AXR3 · Semantic Architecture and Dataflow

**Purpose**: close the quality gap between current raw directory/path diagrams and the
BYOK reference without inventing semantics.

**Implementation surfaces**:

- atomic `archcontext.node/v2` schema/model/fixture migration with structured
  entrypoint symbols/sinks; no v1 runtime reader.
- new `schemas/repo/architecture-flow.schema.json`, contracts and
  `.archcontext/model/flows/*.yaml` loader.
- `semantic-diagrams.ts` compiles node/relation/flow authority plus verified evidence
  into flowchart/sequence AST and exposes proof status.
- renderer enforces semantic labels, outcome completeness, evidence-backed branches,
  Mermaid escaping and dark/light class styles.

**Verification**:

- `bun test packages/contracts/test/contracts.test.ts packages/core/projection-engine/test/entity-summary.test.ts packages/local-runtime/codegraph-adapter/test/capability-projection-inputs.test.ts`
- before expanding beyond two fixtures, `verification/codegraph-readiness` and
  `runtime-harness/hook-adapters` must both compile as `proven`; record declaration LOC、
  evidence coverage、unbound selectors and human review minutes in the AXR3 evidence
  packet. Either fixture becoming `unprovable` stops the work package before the
  remaining eight capabilities are modeled.
- adversarial fixtures prove paths/names cannot synthesize flows; branch/outcome missing
  yields unprovable; representative P1/P2 SVGs pass Mermaid skill Architecture review.

**Independent value**: ArchContext standalone output reaches a trustworthy semantic
diagram standard without waiting for repo-harness automation.

### AXR4 · Major-change Refresh Signal

**Purpose**: make architecture invalidation an explicit, typed output so repo-harness
does not infer it from Markdown or arbitrary code size.

**Implementation surfaces**:

- canonical per-capability semantic fingerprint and flow-proof fingerprint.
- accepted event/ChangeSet linkage for every refresh-required signal.
- unresolved high-impact candidate produces only human-action-required mode.
- signal is included in projection JSON/receipt and exposed by manual CLI readback.

**Verification**:

- contract fixtures cover every reason code, deterministic ordering, privacy and stale
  worktree rejection.
- positive cases: responsibility/interface/entrypoint/relation/lifecycle/proven-flow
  changes. Negative cases: comments/format/refactor/renderer/layout/generated outputs.

**Independent value**: external consumers can observe and manually act on stable
invalidation signals even before repo-harness gains an automatic consumer.

### AXR5 · repo-harness Provider and Readiness

**Purpose**: add a manually callable, fully validated consumer boundary before touching
Stop orchestration.

**Implementation surfaces**:

- pure protocol/domain types in `src/core/architecture/projection.ts`.
- package-local subprocess adapter in `src/effects/architecture/archctx-provider.ts`;
  AXR5–AXR7 tests install integrity-verified `archctx-contracts@0.4.0` and
  `archctx@0.4.0` packed tarballs into a disposable consumer. Product manifest exact
  registry dependencies are intentionally deferred to AXR8.
- new `repo-harness architecture-projection check|plan|apply|status|drain` command.
- policy parser/readiness output exposes model authority、projection provider、code facts
  与 apply 四个独立 states。
- atomically update the canonical ArchContext capability mapper in
  `src/core/capabilities/registry.ts` plus `scripts/capability-resolver.ts` and
  `assets/templates/helpers/capability-resolver.ts` projections to read only
  `archcontext.node/v2`; migrate schema diagnostics/tests and reject v1 rather than
  keeping a dual reader.
- registry→node exporter emits directory `/**` and node v2 base fields; no authority
  switch occurs in this task.

**Verification**:

- `bun test tests/architecture-projection-provider.test.ts tests/cli/status.test.ts tests/state/operation-readiness.test.ts tests/capability-archcontext-export.test.ts`
- `bun test tests/capabilities/registry.test.ts tests/capability-archcontext-source.test.ts tests/capability-resolver.test.ts tests/unit/helper-projection-drift.test.ts`
- clean-room setup builds both 0.4.0 tarballs from AXR4 revisions, verifies recorded
  integrity, installs them with temporary `file:` pins, runs the provider suite, and
  proves neither npm registry lookup nor a committed `file:` dependency is required.
- fixture PATH contains a conflicting global archctx; provider must still execute its
  tarball-installed package-local 0.4.0 and reject feature mismatch.

**Independent value**: the provider, node v2 authority reader and manual command are
merge-safe behind provider=disabled; a local operator or cross-repo CI can enable them
by installing the verified tarballs, while ordinary runtime remains unchanged until
AXR8 adds registry dependencies.

### AXR6 · Durable Runtime Orchestration and Refresh

**Purpose**: connect the real agent-runtime path without losing events or creating
projection loops.

**Implementation surfaces**:

- `PostEditJournalEventV2` and migration of pending v1 events via an explicit bounded
  queue migration, not a permanent dual reader.
- `src/effects/architecture/projection-jobs.ts` owns atomic pending/running/receipt/
  dead-letter transitions and three-attempt retry count.
- `src/effects/architecture/projection-orchestrator.ts` aggregates all events, excludes
  owned paths, drains one bounded job and classifies subprocess/result status.
- `src/cli/installer/managed-entries.ts` assigns `Stop.default` a 150-second host timeout
  while retaining 30 seconds for every other route; installer update/adoption rewrites
  existing managed Stop entries and preserves sibling user hooks.
- refresh consumer calls existing canonical capability/context/architecture request
  writers and records their output digests.
- Stop handler surfaces strict/advisory readiness; SessionStart shows pending/dead-letter
  job state.

**Verification**:

- `bun test tests/mutation-observed.test.ts tests/stop-handler.test.ts tests/architecture-projection-orchestration.test.ts`
- installer/host tests assert both Claude and Codex managed `Stop.default` entries carry
  timeout=150 and all non-Stop routes remain timeout=30; a real installed Stop cycle is
  held past 30 seconds, completes before the 120-second drain deadline, then proves the
  projection and refresh receipts were durable before the host returned.
- chaos matrix covers process exit/signal/timeout, corrupt JSON, stale snapshot, partial
  refresh, duplicate signal, crash between apply and receipt, retry replay and owned-path
  loop suppression.

**Independent value**: automatic docs/context refresh works under registry capability
authority; no authority migration is required to use it.

### AXR7 · Consumer E2E, Adoption, and Dogfood

**Purpose**: prove the published-package-shaped producer against repo-harness's real
nested documents and close the fidelity gap before strict gating.

**Implementation surfaces**:

- cross-repo fixture installs packed archctx/contracts tarballs into packed repo-harness,
  never imports sibling source checkout paths.
- export/migrate 10 capability nodes; reviewed proposals add relations/flows and evidence
  bindings through ChangeSet.
- adoption previews and receipts cover all 10 existing documents; no write occurs until
  every target passes fidelity gates.
- `check-architecture-sync` becomes aggregator for authority、projection drift、snapshot
  freshness、adoption、human actions、pending jobs and supplementary request cards.
- repo-harness policy enables provider with advisory freshness; capability source remains
  registry.

**Verification**:

- full cross-repo acceptance matrix above.
- three named dogfood cycles all have durable receipts; second run of each is zero diff.
- hash ledger proves P3/history/Backlog/marker-external bytes unchanged 10/10.
- `find docs/architecture/modules -name 'capability-*.md'` returns no generated files.

**Independent value**: repo-harness has production-shaped automatic architecture docs and
context refresh while retaining the already trusted registry index authority.

### AXR8 · Release and Authority Cutover

**Purpose**: publish the fixed runtime, verify the selected live executable, then remove
the bounded migration dual-state.

**Implementation surfaces**:

- SemVer/package manifests, release notes, publish preflights and registry readbacks.
- clean-room tarball install for all three packages.
- replace the disposable `file:` overlay with exact registry dependencies only after
  contracts and archctx 0.4.0 registry integrity match the AXR7-tested tarballs.
- selected Bun-global repo-harness update and status/readiness/Stop readback.
- switch freshness advisory→strict, then registry→archcontext only after all receipts.
- remove registry→node migration sync and document exact rollback snapshot.

**Verification**:

- ArchContext: `bun run verify`, release provenance/readback, package tarball smoke and
  Mermaid corpus render.
- repo-harness: `bun run check:ci`, `bun run check:release`, tarball smoke,
  `repo-harness status --json`, `repo-harness run check-architecture-sync` and real
  single/multi-capability Stop cycles.
- npm registry versions/integrity and selected global executable versions must match;
  no source-checkout-only proof is accepted.
- `npm whoami` must pass before publish. The release packet records which approved auth
  lane was used (interactive web-auth or bypass-2FA granular token) without recording
  credentials; `EOTP` or `E403` fails the release gate as auth policy, not source code.

**Independent value**: this task is the final authority simplification and distribution
closure; if it does not land, AXR7 remains a useful advisory/provider deployment with
registry authority and no fallback.

## Execution Log

| When | Task | Plan | Result |
|---|---|---|---|
