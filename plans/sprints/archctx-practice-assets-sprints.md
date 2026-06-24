# Sprint Plan：ArchContext Architecture Practice Assets

> Status: Executing — S3 checkpoint-hook exit gates completed through hook egress audit
> Created: 2026-06-23
> Target repository: `Ancienttwo/arch-context`
> Suggested path after review: `plans/sprints/archctx-practice-assets-sprints.md`
> Goal mode: deterministic catalog → evidence-backed matching → incremental checkpoint → opt-in enforcement → dynamic docs
> Document language: 简体中文

---

## 1. 目标与核心结论

本计划补齐 ArchContext 当前缺失的“可版本化架构知识层”，但不把产品变成依赖 LLM 或外部文档服务的黑盒架构师。

最终交付为两层知识系统：

1. **Static Practice Assets**：随产品发布、可审计、可复现、可离线运行的内置实践目录，以及仓库内 `.archcontext/practices/` 覆盖层。
2. **Dynamic Documentation References**：通过 Context7 等 Provider 按需获取精确到库版本的参考文档，只进入 `resources`，默认关闭、只做 advisory，永不直接决定 Gate。

目标控制回路：

```text
Built-in Practice Catalog               Repository Overlay
packages/core/practice-catalog/assets   .archcontext/practices/*.yaml
                │                              │
                └──────────────┬───────────────┘
                               ▼
                     deterministic catalog
                     validate / merge / digest
                               │
                    lexical candidate retrieval
                               │
                    structural evidence matcher
                               │
               ┌───────────────┼────────────────┐
               ▼               ▼                ▼
          prepare_task      checkpoint      complete_task
          advisory set      match delta     deterministic rules only
               │
               └───────────────┐
                               ▼
                   CompiledTaskContext
        constraints / decisions / realConstraints /
        requiredCheckpoints / resources / provenance

Optional Context7 Provider
package + exact version + sanitized query
                │
                ▼
       local cache + provenance + TTL
                │
                ▼
      resources only; never hard enforcement
```

### 1.1 成功状态

- `prepare` 能基于任务、CodeFacts、架构模型和仓库清单返回 3–5 条有证据的实践，而非只靠关键词。
- 实际编辑发生后，`checkpoint` 能增量增加、撤销或降级建议。
- `complete` 只阻断具备确定性检查器、Observed/Verified 证据且仓库显式启用的规则。
- 内置实践、仓库实践和动态文档都具有 provenance、版本、digest 和来源信任等级。
- 没有网络、Context7、LLM 或云端时，Static Practice Assets 全链路仍然工作。
- Hook 只触发本地 daemon，不在 Hook 脚本中复制业务判断，不为每次 Write 发起网络请求。

### 1.2 明确不做

- 不把 DDD、Clean Architecture、Hexagonal Architecture 等书籍或公开网页全文抓取进仓库。
- 不因任务文本出现 `legacy`、`wrapper`、`adapter`、`v1` 等词而直接触发高严重度 Gate。
- 不把 Context7 返回内容自动晋升为仓库约束或 built-in asset。
- 不允许动态文档、LLM 输出或远程 Provider 直接产生 `pass/fail`。
- 不在 `.ai/hooks/` 复制一套新的产品 Hook runtime；当前仓库保持 central-first hook 模型。
- 不在第一版建设通用向量数据库；复用现有 lexical retrieval，Embedding 继续遵守 ADR-0033 的 gate。

---

## 2. 当前代码基线与插入点

本计划按 2026-06-23 的 `main` 分支结构设计。

### 2.1 已存在、应复用的能力

- `packages/core/pressure-engine` 已定义 pressure signal，但多数高严重度候选仍来自 task/symbol/file 拼接字符串上的正则。
- `packages/core/context-compiler` 已有 `constraints`、`decisions`、`realConstraints`、`requiredCheckpoints`、`resources` 字段，当前多数为空，是 Practice Assets 的主要注入点。
- `packages/core/retrieval` 已有英文归一化、Jieba、deterministic lexical retriever、Top-K recall 与 irrelevant ratio eval；不应新建第二套关键词检索器。
- `packages/core/application` 的 `prepareTask`、`checkpoint`、`completeTask` 已形成工作流骨架。
- `evals/run.ts` 已把 drift precision、constraint recall、irrelevant ratio 纳入 `bun run verify`，可直接扩展 practice gates。
- `packages/local-runtime/runtime-daemon` 是唯一运行时决策者；CLI 和 MCP 应继续保持薄层。
- `.ai/hooks/README.md` 明确采用 user-level central-first hooks；仓库内 Hook 只作为显式 fallback。
- ADR-0008、ADR-0025、ADR-0033、ADR-0036 已提供 Declared/Observed/Verified、证据信心、Embedding 默认关闭、确定性 Gate 等约束。

### 2.2 当前缺口

- Pressure signal 的 `evidenceKind` 只有粗粒度 `observed | heuristic`，无法表达 path、manifest、symbol、edge、diff、test 等来源。
- Context compiler 没有从结构化知识中填充 constraints/decisions/realConstraints。
- Retrieval document 只关联 `constraintIds`，没有 practice scope、evidence requirements、enforcement ceiling 和 provenance。
- `checkpoint` 主要做 worktree digest freshness，没有根据实际 changed paths/diff 重新评估实践。
- Built-in architecture knowledge、repo overlay、source registry、license policy、catalog digest 均不存在。
- 外部文档没有明确的 trust boundary、缓存、DLP、TTL 与“不得参与 Gate”的契约。

---

## 3. 完成口径与证据成熟度

### 3.1 状态标记

- `[ ]` 未开始
- `[~]` 进行中或仅达到较低证据等级
- `[x]` 达到目标证据等级并提交验证证据
- `[!]` 被产品决策、许可、依赖或安全问题阻塞

### 3.2 证据成熟度

| 等级 | 名称 | 最低证据 |
|---|---|---|
| E0 | Specified | ADR、Schema、Port、状态机或产品契约已定义并评审 |
| E1 | Implemented | 真实实现、单元测试与失败路径完成；不得只交付 Mock/常量 |
| E2 | Integrated | CLI/MCP → daemon → core → store/CodeFacts 的真实跨模块或跨进程链路通过 |
| E3 | Field Verified | 在真实仓库、真实 Agent Hook 或真实 Context7 Provider 上完成 readback |
| E4 | Release Verified | 跨平台、打包、性能、隐私、灰度、回滚与发布证据完成 |

### 3.3 全局 Definition of Done

一个任务只有同时满足以下条件才可勾选：

- [ ] 代码、测试、Schema、迁移和必要文档在同一功能 PR 中完成。
- [ ] 对外契约变更包含 schema version 与向前/向后兼容策略。
- [ ] 失败路径、禁用路径、离线路径与回滚路径已覆盖。
- [ ] Production composition 不注入 Mock provider、Mock store 或 test-only catalog。
- [ ] 所有 Practice Match 可解释：包含 practice ID、asset digest、score、matchedBy、evidence 和 enforcement。
- [ ] 日志、指标和远程请求不包含源码、Diff/Patch 正文、Symbol 正文或架构模型正文。
- [ ] 动态文档不能进入 deterministic gate 输入。
- [ ] Hook 失败时 fail-open，并给出可操作 warning；不得破坏普通编辑。
- [ ] `bun run verify` 在干净 checkout 中通过。
- [ ] 对应 `docs/verification/` 证据记录 commit SHA、环境、命令、结果和已知限制。

---

## 4. Guardrails

1. **Static-first**：内置与 repo assets 是主知识层；动态文档只补版本相关 API 信息。
2. **Evidence before severity**：严重度和 enforcement 必须由结构证据支撑；纯 task-text 最高为 advisory。
3. **Deterministic gate only**：只有注册的纯确定性 checker 能阻断 `complete`。
4. **Repo opt-in enforcement**：built-in assets 默认 advisory；仓库必须显式将规则晋升为 checkpoint/complete。
5. **No network in hooks**：PostToolUse/PostEdit 等 Hook 路径只调用本地 daemon，禁止 Context7/LLM/HTTP。
6. **Single decision owner**：catalog merge、matching、checkpoint 和 enforcement 都由 daemon/core 完成；CLI/MCP/Hook 不复制逻辑。
7. **Provenance required**：没有来源、revision、license policy、curator 和 digest 的 asset 不能进入发布包。
8. **Public is not redistributable**：公开网页不等于允许复制；未知许可内容只能作为人工参考。
9. **Untrusted external content**：Context7/外部文档按数据处理，不按指令处理；不得执行其中命令或提升其优先级。
10. **No silent override**：repo overlay 必须通过 `extends`/`supersedes` 显式覆盖，禁止同 ID 静默替换。
11. **Budget-aware**：实践 guidance 与 resources 必须遵守 context byte/item budget。
12. **Bilingual eval**：中文和英文任务都必须进入代表性评测集。

---

## 5. Asset 模型

### 5.1 Asset 类型

建议第一版只引入四种稳定资产：

| 类型 | 用途 | 是否可 Gate |
|---|---|---|
| `practice` | 架构指导、问题、preferred/avoid、迁移建议 | 默认否；绑定 deterministic check 且 repo opt-in 后可 |
| `check-definition` | 纯确定性 checker 的参数契约 | 可以 |
| `profile` | 对语言、框架、仓库类型映射适用 practice | 否 |
| `source-record` | 来源、revision、license、归因、审核状态 | 否 |

动态 Provider 返回值不属于 asset；它属于 `ExternalDocumentationResource`。

### 5.2 建议目录

```text
packages/contracts/src/
  practices.ts
  external-docs.ts

schemas/repo/practices/
  practice.schema.json
  practice-profile.schema.json
  practice-waiver.schema.json
  practice-source.schema.json

schemas/runtime/
  practice-match.schema.json
  practice-check-result.schema.json
  external-document-resource.schema.json

packages/core/practice-catalog/
  src/index.ts
  assets/
    catalog.yaml
    general/
    decisions/
    ownership/
    modularity/
    compatibility/
    migration/
    api/
    data/
    observability/
    security/
    supply-chain/

packages/core/practice-engine/
  src/index.ts
  src/candidate-retrieval.ts
  src/evidence-matcher.ts
  src/enforcement.ts
  src/check-registry.ts

packages/local-runtime/context7-adapter/
  src/index.ts

packages/local-runtime/local-store-sqlite/
  migrations/00xx-practice-cache.sql
  migrations/00xx-external-doc-cache.sql

.archcontext/
  practices/*.yaml
  profiles/*.yaml
  waivers/*.yaml
  integrations/context7.yaml
  integrations/context7.lock.yaml

evals/practices/
  retrieval.en.jsonl
  retrieval.zh.jsonl
  pressure-benign.jsonl
  structural-positive.jsonl
  enforcement-negative.jsonl
  context7-dlp.jsonl

docs/research/
  practice-source-policy.md
  practice-source-catalog.md

docs/verification/
  practice-assets-s1-catalog-gate.md
  practice-assets-s2-matching-gate.md
  practice-assets-s3-checkpoint-gate.md
  practice-assets-s4-enforcement-gate.md
  practice-assets-s5-context7-gate.md
  practice-assets-s6-release-gate.md
```

### 5.3 `PracticeAssetV1` 示例

```yaml
schemaVersion: archcontext.practice/v1
id: compatibility.single-owner
revision: 1
status: active

title: Compatibility paths require one lifecycle owner
summary: >-
  A compatibility path must have one accountable owner, a durable reason,
  a removal condition, and a bounded review date.
category: compatibility

tags:
  - migration
  - compatibility
  - lifecycle

appliesTo:
  repositoryKinds: [application, service, library]
  languages: []
  frameworks: []
  pathGlobs: ["**/*"]
  nodeKinds: [module, service, public-api]

triggers:
  candidateTerms: [compatibility, legacy, fallback, adapter, v1, v2]
  pressureSignals:
    - unjustified-wrapper-adapter
    - dual-track-business-concept
  structuralPredicates:
    any:
      - compatibility-path-added
      - parallel-public-api-observed
      - dual-persisted-shape-observed

evidencePolicy:
  minimumStrengthForRecommendation: heuristic
  minimumStrengthForCheckpoint: observed
  minimumStrengthForEnforcement: observed
  requiredKindsForEnforcement: [diff, symbol]
  maxEnforcementWhenOnlyHeuristic: advisory

guidance:
  questions:
    - Who owns the compatibility path through removal?
    - What external contract or persisted state requires it?
    - What exact condition allows deletion?
  preferred:
    - Adapt at one boundary and keep one internal representation.
    - Record owner, review date, tests, and removal condition.
  avoid:
    - Maintaining v1/v2 branches in multiple business layers.
    - Permanent fallback code with a generic cleanup note.

checks:
  - checkId: compatibility-contract-required
    mode: deterministic
    parameters:
      requireOwner: true
      requireRemovalCondition: true
      requireReviewDate: true
      requireTests: true

enforcement:
  default: advisory
  promotableTo: complete
  repoOptInRequired: true

provenance:
  sourceKind: curated-open-source
  sourceRefs:
    - sourceId: archcontext.adr.0010
    - sourceId: madr
      sourceRevision: v4.0.0
      licenseSpdx: MIT OR CC0-1.0
  curator: archcontext-maintainers
  reviewedAt: 2026-06-23

lifecycle:
  introducedAt: 2026-06-23
  reviewAfter: 2027-06-23
  supersedes: []
```

### 5.4 Match 输出

```ts
interface PracticeMatch {
  practiceId: string;
  assetRevision: number;
  assetDigest: string;
  score: number;
  confidence: "low" | "medium" | "high";
  enforcement: "advisory" | "checkpoint" | "complete";
  matchedBy: Array<"retrieval" | "scope" | "signal" | "predicate" | "repo-policy">;
  evidence: PracticeEvidence[];
  explanation: string[];
  sourceTrust: "repo-authored" | "curated-static" | "external-dynamic";
  suppressedReason?: string;
}
```

### 5.5 Evidence 模型

```ts
type EvidenceStrength = "heuristic" | "declared" | "observed" | "verified";

type EvidenceKind =
  | "task-text"
  | "path"
  | "package-manifest"
  | "architecture-model"
  | "symbol"
  | "import-edge"
  | "call-edge"
  | "data-edge"
  | "diff"
  | "test"
  | "runtime-check"
  | "human-attestation";
```

强制矩阵：

| Evidence | 可产生 advisory | 可要求 checkpoint | 可阻断 complete |
|---|---:|---:|---:|
| task-text heuristic | 是 | 否 | 否 |
| declared model/ADR | 是 | 是 | 仅当另有 deterministic observed/verified check |
| path/manifest/symbol/edge/diff observed | 是 | 是 | 是，且必须绑定 checker 与 repo opt-in |
| test/runtime verified | 是 | 是 | 是 |
| Context7/external docs | 是 | 否 | 否 |

---

## 6. 来源获取与许可策略

### 6.1 来源等级

| 等级 | 条件 | 允许动作 |
|---|---|---|
| A | MIT、Apache-2.0、BSD、CC0 等清晰宽松许可 | 可人工改写为 built-in assets；保留归因和 pinned revision |
| B | CC-BY 等要求归因的许可 | 可进入 attributed catalog；必须记录作者、链接、revision、变更说明 |
| C | CC-BY-SA 或其他传染/共享要求 | 默认不进入主分发包；先完成法律与分发边界评审，必要时独立 catalog |
| D | 无明确许可、商业网站、博客、书籍内容 | 只能作为人工研究参考；禁止复制或自动摄取 |
| E | Context7/社区动态文档 | 只做临时 External Resource；不自动固化，不参与 Gate |

### 6.2 第一批建议来源

| 来源 | 适合提炼的 machine-readable 内容 | 建议形态 | Enforcement ceiling | 许可/注意事项 |
|---|---|---|---|---|
| ArchContext 自有 ADR、Spec、`.archcontext` 模型 | local-first、single writer、thin adapter、compatibility contract、declared/observed/verified | built-in + repo policy | complete | 第一优先级；与产品自身语义一致 |
| MADR | decision status、context、options、consequences、supersession、review lifecycle | decision practices | checkpoint | `MIT OR CC0-1.0`，适合字段与流程提炼 |
| Backstage Software Catalog | component/system/domain/resource/API、owner、relation、source-of-truth-in-Git | ownership/profile practices | checkpoint | Apache-2.0；借鉴模型，不复制产品文案 |
| ArchUnit | layer dependency、package dependency、cycle、naming、architecture test | deterministic check definitions | complete | Apache-2.0；非常适合 checker 语义 |
| Structurizr DSL | software system/container/component/person、relationship、view、scope | model/profile practices | checkpoint | Apache-2.0；优先使用 DSL 模型，不摄取未核实许可的 C4 文章正文 |
| Twelve-Factor App | config、build/release/run、process、disposability、logs、dev/prod parity | runtime practices | checkpoint | MIT；需限制在适用的云原生/服务型项目 |
| OpenTelemetry | telemetry boundary、semantic naming、trace/log/metric correlation、resource identity | observability practices/profile | checkpoint | 文档 CC-BY-4.0、代码 Apache-2.0；必须记录版本 |
| Kubernetes Website | declarative desired state、reconciliation、probes、resource ownership、configuration separation | kubernetes profile | checkpoint | CC-BY-4.0；只对 Kubernetes scope 生效，不能泛化为所有项目 |
| OpenSSF Scorecard | pinned dependencies、branch protection、CI tests、code review、token permissions、signed releases | supply-chain check definitions | complete | Apache-2.0；适合可确定验证的 repo-level checks |
| OWASP Cheat Sheet Series | auth、session、secrets、input validation、logging、transport security | security practices | checkpoint | CC-BY-SA-4.0；未完成 ShareAlike 分发评审前仅做参考或独立 catalog |
| arc42 | context、building blocks、runtime、deployment、quality scenarios、risks、decisions | documentation completeness profile | advisory | CC-BY-SA-4.0；默认 reference-only，除非单独解决分发许可 |
| OpenAPI / AsyncAPI / CloudEvents 等开放规范 | contract-first、schema evolution、compatibility、event envelope | api/event profiles | checkpoint | 每个规范分别核实 SPDX 与 pinned version |

### 6.3 不应直接摄取的来源

- DDD、Clean Architecture、Hexagonal Architecture、Patterns of Enterprise Application Architecture 等书籍正文。
- Stripe、Netflix、Uber、AWS、Google、Microsoft 等公开工程博客中没有明确再分发许可的文章。
- 论坛回答、个人博客、聚合网站和未经维护的 gist。
- Context7 返回的片段本身，除非回到原始上游、核实许可并通过人工 curation PR。

这些来源可以帮助架构师形成原创 practice，但不能通过抓取、摘要流水线或 Context7 自动写入 built-in catalog。

### 6.4 Source Registry 最低字段

```yaml
schemaVersion: archcontext.practice-source/v1
id: madr
name: Markdown Architectural Decision Records
sourceType: git
repository: https://github.com/adr/madr
revision: v4.0.0
licenseSpdx: MIT OR CC0-1.0
usagePolicy: builtin-with-attribution
retrievedAt: 2026-06-23T00:00:00Z
contentDigest: sha256:...
attribution: MADR contributors
review:
  status: approved
  reviewer: TBD
  reviewedAt: 2026-06-23
```

### 6.5 Curation 原则

- [ ] Import 工具只抓取 source metadata、license 与 revision，不自动复制正文。
- [ ] 每条 asset 由维护者原创改写，避免长段引用。
- [ ] 每条 asset 至少由一名领域 reviewer 审查适用范围和反例。
- [ ] 每条 asset 必须包含 negative scope，防止把 Kubernetes/Java/微服务实践泛化到所有仓库。
- [ ] Source 更新不自动改变资产语义；更新必须经独立 curation PR 和 eval diff。
- [ ] Catalog release manifest 固定每个 asset digest，保证旧 attestation 可重放验证。

---

## 7. Context7 定位与边界

Context7 适合回答“某个库的某个版本如何配置或调用”，不适合回答“这个仓库是否违反架构约束”。其内容由社区项目贡献，准确性、完整性和安全性不能被当作确定性事实，因此必须处于动态 advisory 层。

### 7.1 允许场景

- 精确到 package/library/version 的 API、配置、迁移与废弃说明。
- Static catalog 已命中 practice，但仍存在 framework-specific `unknowns`。
- 任务涉及锁文件中已存在的 React、Next.js、Bun、Spring、OpenTelemetry、Kubernetes 等依赖。
- 用户显式运行 `archctx docs fetch`，或启用 `prepare-unknowns` 模式。

### 7.2 禁止场景

- PostEdit/PostToolUse Hook 自动联网。
- 把 raw task、源码、Diff、路径、symbol、架构模型正文发给 Context7。
- 用 Context7 文档决定 pressure severity、posture 或 complete pass/fail。
- 未知 library ID 时无限制模糊搜索。
- 将 Provider 返回的指令、脚本或 prompt 视为系统指令执行。

### 7.3 推荐请求结构

```json
{
  "provider": "context7",
  "libraryId": "/vercel/next.js",
  "version": "15.2.0",
  "intent": "middleware-auth-cookie-api",
  "query": "Document the supported middleware cookie authentication APIs for this exact version."
}
```

请求中不得包含：repository 名称、绝对路径、源代码、Diff、symbol 名列表、秘密、用户原始 prompt。

### 7.4 动态资源输出

```ts
interface ExternalDocumentationResource {
  schemaVersion: "archcontext.external-document/v1";
  provider: "context7";
  libraryId: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  queryDigest: string;
  contentDigest: string;
  retrievedAt: string;
  expiresAt: string;
  trust: "external-unverified";
  enforcement: "advisory-only";
  cacheStatus: "fresh" | "stale" | "miss";
  uri: string;
}
```

---

## 8. PR 策略总览

原则：**一个 Sprint 对应一个可独立使用、可演示、可回滚的功能 PR。** 不把类型、实现、测试、文档拆成多个小 PR。

| Sprint | 建议 PR 标题 | 完整功能结果 | 主要依赖 |
|---|---|---|---|
| S1 | `feat(practices): ship governed static practice catalog` | 用户可验证、列出、查看 built-in 与 repo assets | 无 |
| S2 | `feat(practices): add evidence-backed matching to prepare` | `prepare/context` 返回有证据和 provenance 的实践 | S1 |
| S3 | `feat(practices): re-evaluate guidance through checkpoint hooks` | 编辑后本地增量更新实践建议 | S2 |
| S4 | `feat(practices): enforce deterministic repo policies at complete` | 显式启用的确定性 practice 可阻断 complete | S3 |
| S5 | `feat(context7): add privacy-bounded dynamic documentation resources` | 可选 Context7 动态文档进入 resources | S2；不依赖 S4 |
| S6 | `release(practices): expand curated assets and close production gates` | 资产规模、评测、打包、性能、隐私和发布门禁完成 | S1–S5 |

### 8.1 PR 通用要求

每个 PR 必须包含：

- [ ] 用户可见的完整 vertical slice，而非只有 interface 或 stub。
- [ ] Contract/schema、core、runtime/surface、测试和文档同步更新。
- [ ] Feature flag 或配置级 rollback。
- [ ] `docs/verification/` Exit Gate 证据。
- [ ] Acceptance ledger 条目。
- [ ] 失败路径与 negative tests。
- [ ] Packaged CLI smoke 或明确说明为何不影响分发物。
- [ ] PR 描述包含 Before/After、Trust boundary、Migration、Rollback、Known limits。

---

# 9. Sprint 1 — Governed Static Practice Catalog

> Suggested branch: `feat/practice-catalog`
> Suggested PR: `feat(practices): ship governed static practice catalog`
> Target evidence: E2
> User-visible result: `archctx practices list/show/validate/sources` 可在无网络环境管理内置与 repo practice。

## 9.1 目标

交付一个可安装、可验证、可合并、可追踪来源的静态 Practice Catalog。此 Sprint 不做自动匹配，也不改变 `prepare/complete` 结论。

## 9.1.1 S1 执行记录

- 2026-06-23：实现 S1 static catalog vertical slice，分支 `codex/practice-catalog`。
- ADR 编号调整：计划写 `ADR-0037`，但仓库已有 `ADR-0037-runtime-state-placement`；本实现新增 `ADR-0038-versioned-architecture-practice-assets`。
- 实现边界：S1 只提供 daemon-resolved static catalog、repo overlay、CLI/MCP 只读可见性、manifest/digest/source registry、测试与 packaged smoke；不接入 prepare matching、checkpoint delta 或 complete enforcement。
- JSON-compatible YAML 是 S1 的刻意约束：减少 parser 依赖和 digest 漂移；完整 YAML 语法可在后续兼容扩展。
- 2026-06-24：S1 full verification 通过，`bun run verify` readback 为 567 pass / 0 fail；证据写入 `docs/verification/practice-assets-s1-catalog-gate.md`。

## 9.2 Checklist

### Contract 与 ADR

- [x] S1-01 新增 ADR-0037：`Versioned Architecture Practice Assets`，冻结 static-first、provenance、overlay 与 enforcement ceiling。（实际为 `ADR-0038`，因 `ADR-0037` 已被占用。）
- [x] S1-02 新增 `PracticeAssetV1`、`PracticeProfileV1`、`PracticeSourceRecordV1`、`PracticeCatalogManifestV1` TypeScript contract。
- [x] S1-03 在 `schemas/repo/practices/` 增加对应 JSON Schema 与 valid/invalid/boundary fixtures。
- [x] S1-04 定义 asset ID、revision、status、category、tags、scope、triggers、evidencePolicy、guidance、checks、enforcement、provenance、lifecycle 字段。
- [x] S1-05 定义 canonical JSON/YAML normalization、稳定排序与 digest 算法。
- [~] S1-06 冻结 overlay 优先级：built-in < repo profile < repo exact override；禁止 silent duplicate ID。（S1 实现 built-in + repo exact add/replace/disable；profile precedence 保留到 S2/S6 profile slice。）
- [~] S1-07 定义 `extends`、`supersedes`、`disabledWithReason` 和过期时间语义。（字段已冻结；expired override hard gate 未进入 S1。）
- [x] S1-08 定义 source license 等级 A–E 和发布阻断策略。

### Catalog 实现

- [x] S1-09 新建 `packages/core/practice-catalog`，实现 built-in loader、repo loader、validator、merger、digest builder。
- [x] S1-10 Loader 只允许读取 package assets 与 `.archcontext/practices/`，拒绝 symlink/path traversal/repo escape。
- [~] S1-11 对 duplicate ID、revision rollback、unknown field、invalid glob、unknown checkId 返回 typed error 与用户操作提示。（duplicate、silent duplicate、unknown field、invalid glob、unknown checkId 已覆盖；revision rollback strictness 留到 profile/attestation hardening。）
- [x] S1-12 Catalog 合并结果按 ID 稳定排序，在不同 OS 和 YAML key 顺序下产生相同 digest。
- [x] S1-13 建立 `catalog.yaml` manifest，列出每个 asset ID、revision、digest、source IDs 和 package build version。
- [x] S1-14 将 catalog 作为 production composition 的只读依赖注入 daemon；不得在 CLI 直接创建第二套 loader。

### Seed assets

- [x] S1-15 编写至少 12 条 seed practices，覆盖 decisions、ownership、modularity、compatibility、migration、API、data、observability、security、supply-chain。
- [x] S1-16 每条 seed asset 包含 positive scope、negative scope、questions、preferred、avoid、sourceRefs 和 review date。
- [x] S1-17 首批 IDs 至少包含：
  - `decision.record-significant-change`
  - `ownership.explicit-lifecycle-owner`
  - `modularity.no-new-cycle`
  - `modularity.respect-dependency-direction`
  - `compatibility.single-owner`
  - `compatibility.expiry-contract`
  - `migration.target-and-removal-state`
  - `api.contract-before-implementation`
  - `data.single-authoritative-model`
  - `observability.boundary-telemetry`
  - `security.least-privilege`
  - `supply-chain.pinned-dependencies`
- [x] S1-18 每条 asset 由人工原创改写，不复制来源长段正文。

### CLI/MCP 可见性

- [x] S1-19 增加 `archctx practices list [--category] [--source] [--json]`。
- [x] S1-20 增加 `archctx practices show <id> [--json]`，显示 effective asset、来源和 override chain。
- [x] S1-21 增加 `archctx practices validate [--strict]`，校验 built-in、repo overlay、source registry 与 digest。
- [x] S1-22 增加 `archctx practices sources`，显示许可、revision、review status，不显示外部正文。
- [x] S1-23 MCP 增加只读 resource/list 能力，避免新增可写工具。

### 测试与打包

- [x] S1-24 Contract tests 覆盖 valid/invalid/boundary/forward-compatible fixtures。
- [~] S1-25 Catalog tests 覆盖 duplicate、override、disable、supersede、expired override、path escape 和 deterministic digest。（覆盖 duplicate、override、disable、symlink/path escape、manifest、license、glob、deterministic digest；expired override 留到 enforcement/profile slice。）
- [x] S1-26 Packaged CLI smoke 验证 tarball/分发物包含 assets，不能只在 checkout 中工作。
- [x] S1-27 Windows/macOS/Linux 路径与换行差异不改变 catalog digest。
- [x] S1-28 `bun run verify` 加入 source registry 与 catalog manifest audit。
- [x] S1-29 编写 `docs/verification/practice-assets-s1-catalog-gate.md`。

## 9.3 Exit Gates

- [x] S1-EG1 无网络、无 LLM、无 Context7 时，CLI 可 list/show/validate built-in 和 repo assets。
- [x] S1-EG2 同一 catalog 在至少两个 OS fixture 上产生相同 digest。
- [~] S1-EG3 非法 override、未知许可、路径逃逸和 duplicate ID 被 100% 拒绝。（当前覆盖 silent duplicate、unknown check、invalid glob、blocked license、symlink/path escape；expired override 留到后续。）
- [x] S1-EG4 npm/tarball smoke 中 assets 存在且 digest 与 checkout 一致。
- [x] S1-EG5 此 PR 不改变现有 `prepare` posture 与 `complete` 结论。

## 9.4 验证命令

```bash
bun run typecheck
bun test packages/contracts/test
bun test packages/core/practice-catalog
bun test packages/core/policy-engine
bun test packages/surfaces/cli/test/cli.test.ts
bun test packages/surfaces/cli/test/local-product-e2e.test.ts
bun test packages/surfaces/mcp-local
bun run verify:practices
node scripts/packaged-cli-smoke.mjs
bun run verify
```

## 9.5 Rollback

- Catalog 只读加载失败时 daemon 进入 `catalog-unavailable` capability 状态，现有 prepare/complete 按旧逻辑工作。
- 可通过配置 `practices.catalog.enabled: false` 禁用 repo overlay；built-in loader 错误不得使 daemon 无法启动。

---

# 10. Sprint 2 — Evidence-backed Matching in Prepare

> Suggested branch: `feat/practice-matching`
> Suggested PR: `feat(practices): add evidence-backed matching to prepare`
> Target evidence: E2
> User-visible result: `prepare` 和真实 `context` 返回 Top-K practice、证据、解释、约束和 checkpoint。

## 10.1 目标

将静态 catalog 接入现有 retrieval、pressure-engine、CodeFacts、context-compiler 和 application workflow，解决“关键词命中即高压力”与“context 字段为空”的核心缺口。

## 10.1.1 S2 执行记录

- 2026-06-24：在 stacked 分支 `codex/practice-matching` 上实现 S2 evidence-backed matching vertical slice。
- 实现边界：`context` 与 `prepare` 共享 `compileTaskContext`，输出 `practiceGuidance`、catalog digest、practice resources、constraints、required checkpoints；不实现 checkpoint delta、complete enforcement、waiver 或 Context7。
- 设计取舍：`PressureSignal.evidence/evidenceKind` 保持兼容，新增 typed `evidenceDetails`；task-text-only 信号最高保持 advisory/low-pressure，observed/verified structural evidence 才能升级。
- Scope filtering 在 S2 只实装 path / negative path 与 structural predicate；repository kind、language、framework、profile precedence 留到 profile/enforcement hardening slice。
- 验证证据写入 `docs/verification/practice-assets-s2-matching-gate.md`；practice eval 增加 30 positive / 30 benign negative cases。
- 2026-06-24：full verification 通过，`bun run verify` readback 为 575 pass / 0 fail / 3423 expects。
- 2026-06-24：提交 stacked PR #14 `feat(practices): add evidence-backed matching to prepare`，base 为 `codex/practice-catalog`；远端 GitHub Verify 全矩阵通过，最终合并前以 PR Checks readback 为准。

## 10.2 Checklist

### Evidence contract

- [x] S2-01 将 `PressureSignal.evidenceKind` 升级为 `PracticeEvidence { kind, strength, subject, digest, observedAt }`。
- [x] S2-02 保留旧字段的兼容读取，输出 schema version 升级并提供 migration test。
- [x] S2-03 实现 evidence strength 排序：heuristic < declared < observed < verified。
- [x] S2-04 实现 `EnforcementCeiling` 计算：heuristic-only 永远不高于 advisory。

### Pressure engine 修正

- [x] S2-05 将 task text 正则降级为 candidate signal，不直接产生 high-severity observed signal。
- [x] S2-06 为 duplicate responsibility、multiple lifecycle owner、wrapper/adapter、dual-track、cross-boundary access 建立结构 corroboration 接口。
- [x] S2-07 从 CodeFactsPort 获取 symbol、import/call/data edge、caller coverage 等 normalized facts，不读取 CodeGraph 内部 DB。
- [x] S2-08 对 README、文档、变量名、测试 fixture 中的 `legacy/v1/adapter/wrapper` 建立 benign suppression。
- [x] S2-09 对没有关键词但存在新增 cycle、跨层 import、parallel public API 的 fixture 产生 observed signal。

### Practice engine

- [x] S2-10 新建 `packages/core/practice-engine`。
- [x] S2-11 将 PracticeAsset 映射为现有 `RetrievalDocument`，复用英文归一化与 Jieba tokenizer。
- [x] S2-12 Candidate retrieval 只做召回；scope filter 和 evidence matcher 决定最终匹配，不允许只按 lexical score 输出。
- [~] S2-13 实现 scope 过滤：repository kind、language、framework、path glob、node kind。（S2 实装 path / negative path / node evidence；profile-driven repository kind、language、framework 留到后续 profile slice。）
- [x] S2-14 实现 structural predicates registry，未知 predicate 必须 fail validation，不能静默忽略。
- [x] S2-15 实现 deterministic re-rank：retrieval、scope、observed evidence、repo policy、negative scope 分别计分。
- [x] S2-16 实现 Top-K 去重、同 category 限额和 context budget trimming。
- [x] S2-17 Match 输出包含 explanation、matchedBy、evidence、asset digest 和 suppression reason。

### Context compiler 与 application

- [x] S2-18 在 `CompiledTaskContext` 增加 typed `practiceGuidance`，保持旧消费者可读取现有字段。
- [x] S2-19 用 practice matches 填充 `constraints`、`decisions`、`realConstraints`、`unknowns`、`recommendedTargetState`、`requiredCheckpoints`、`resources`。
- [x] S2-20 `resources` 增加 `archcontext://practice/<id>@<revision>` 与 catalog digest。
- [x] S2-21 `prepareTask` 只调用一次完整 compile/match 链路，消除重复计算与结果漂移。
- [x] S2-22 修复 `context` placeholder：改为调用真实 compiler；无法提供真实数据时返回明确 capability error，禁止写死 low/0/empty。
- [x] S2-23 CLI 和 MCP 输出同一个 daemon result，包含 Top 3–5 practices 与简洁解释。
- [x] S2-24 超预算时优先保留 repo-authored、higher evidence、higher enforcement ceiling 的实践。

### Eval 与测试

- [x] S2-25 增加至少 30 个 benign negative cases，覆盖 README typo、类名 Adapter、legacy migration 文档、v1 test fixture。
- [x] S2-26 增加至少 30 个 structural positive cases，其中一半不包含触发关键词。
- [x] S2-27 增加中英文 practice retrieval eval，记录 Top-1/Top-3 recall、constraint recall、irrelevant ratio。
- [x] S2-28 增加 budget eval：12KB/12 items 下保留最关键 constraint 与 checkpoint。
- [~] S2-29 将 practice gates 接入 `evals/run.ts --check` 和 acceptance ledger。（practice gates 已接入 `evals/run.ts --check`；历史 FG acceptance ledger 保持不扩展，证据落入 S2 verification doc。）
- [x] S2-30 编写 `docs/verification/practice-assets-s2-matching-gate.md`。

## 10.3 Exit Gates

- [x] S2-EG1 heuristic-only high severity rate = 0%。
- [x] S2-EG2 现有 architecture drift precision ≥ 90%，不得通过删除全部信号作弊。
- [x] S2-EG3 Practice Top-3 recall ≥ 90%，constraint recall ≥ 95%，irrelevant ratio ≤ 20%。
- [x] S2-EG4 至少一个无关键词结构腐化 fixture 能命中正确 practice。
- [x] S2-EG5 `context` 与 `prepare` 对相同 task/catalog/CodeFacts 使用同一 digest，不再返回常量桩。
- [x] S2-EG6 CLI 与 MCP 对同一 session 返回相同 practice IDs、evidence 与 catalog digest。

## 10.4 验证命令

```bash
bun test packages/core/pressure-engine
bun test packages/core/practice-engine
bun test packages/core/context-compiler
bun test packages/core/application
bun evals/run.ts --check
bun run e2e:local-no-cloud
bun run verify
```

## 10.5 Rollback

- 配置 `practices.matching.mode: off | advisory`，默认在 PR 合并初期为 `advisory`。
- Match engine 异常时记录 typed warning，回退现有 prepare；不得改变 stale/compatibility/changeset gates。

---

# 11. Sprint 3 — Incremental Checkpoint and Hook Integration

> Suggested branch: `feat/practice-checkpoint-hooks`
> Suggested PR: `feat(practices): re-evaluate guidance through checkpoint hooks`
> Target evidence: E3
> User-visible result: Agent 编辑后，Hook 触发本地 checkpoint，返回新增、撤销、升级或降级的 practice delta。

## 11.1 目标

让 Practice Assets 从“准备阶段的一次性建议”变为真实工作流控制回路，同时保持 Hook 轻量、离线、fail-open 和 central-first。

## 11.1.1 S3 执行记录

- 2026-06-24：在 stacked 分支 `codex/practice-checkpoint-hooks` 上实现 S3 checkpoint-hook vertical slice。
- 实现边界：新增 typed checkpoint contract、practice delta、daemon-owned baseline、runtime RPC、CLI `checkpoint`、CLI `hook checkpoint`、MCP `archcontext_checkpoint`；不实现 complete enforcement、policy waiver、Context7 或仓库内 hook runtime。
- 设计取舍：baseline 暂存于 daemon session，后台 daemon/MCP/installed CLI 能复用 prepare baseline；一次性 embedded CLI 没有 baseline 时返回 `no-baseline`，不伪造 no-op。
- Hook 失败策略：`archctx hook checkpoint` 捕获 runtime unavailable，返回 fail-open payload，egress 固定 `none`，不阻断编辑。
- 验证证据写入 `docs/verification/practice-assets-s3-checkpoint-gate.md`。
- 2026-06-24：full verification 通过，`bun run verify` readback 为 579 pass / 0 fail / 3457 expects；focused S3 suite 为 164 pass / 0 fail / 975 expects。
- 2026-06-24：提交 stacked PR #15 `feat(practices): add checkpoint guidance deltas`，base 为 `codex/practice-matching`；最终合并前以 PR Checks readback 为准。
- 2026-06-24：补 S3 hardening：daemon 对同一 worktree/tool call/path set 的重复 checkpoint 做 coalesce，core fixture 覆盖 observed cycle added/removed delta，benchmark readback 为 cold p95 31.086ms、warm p95 29.416ms、coalesced p95 16.843ms。
- 2026-06-24：hardening 后 full verification 通过，`bun run verify` readback 为 581 pass / 0 fail / 3472 expects；focused S3 suite 为 166 pass / 0 fail / 990 expects。
- 2026-06-24：PR #15 远端 Windows Node 24 暴露 developer-review 临时 worktree cleanup `EBUSY`；修复为 retrying removal，并给该长流程 CLI test 单独 15s timeout。focused CLI suite 为 16 pass / 0 fail / 275 expects，git-adapter + runtime-daemon suite 为 23 pass / 0 fail / 206 expects，`bun run verify` 仍为 581 pass / 0 fail / 3472 expects。
- 2026-06-24：从 S4 test-evidence stacked head 创建 `codex/practice-hook-adapter`，补 S3 hook adapter follow-up。
- 实现边界：新增 `archctx hooks install/status/remove --host codex|claude|generic`，输出 central-first `repo-harness-hook` adapter contract 和 manual host config example；不写用户配置、不设置 repo-local `hook_source`、不 vendored hook runtime。
- Hook log 边界：`archctx hook checkpoint` 成功和 fail-open payload 均带 `archcontext.hook-log/v1`，只记录 schemaVersion、event、elapsedMs、pathCount、changedPathDigest、reasonCode、failOpen、egress、network；测试断言不包含 changed path 正文。
- Skills 边界：`skills/archcontext-develop/SKILL.md` 只说明 checkpoint delta SOP；回归测试禁止 first-party skill 嵌入 practice ID、candidate terms、structural predicates 或 matcher 名称。
- 验证证据更新 `docs/verification/practice-assets-s3-checkpoint-gate.md`；focused CLI suite 为 18 pass / 0 fail / 338 expects，`bun run verify` 为 605 pass / 0 fail / 3653 expects。
- 2026-06-24：从 S3 hook adapter head 创建 `codex/practice-checkpoint-hardening`，补 checkpoint baseline 持久化、路径事件摘要和 installed hook edit/revert E2E。
- 实现边界：`prepare/checkpoint/complete` 通过 local store 恢复同一 task session 的 practice checkpoint baseline；checkpoint result 增加无路径正文的 `hook.pathSummary`；真实 installed `archctx hook checkpoint` 覆盖 compatibility path edit/revert delta。不在本 slice 实现 CodeGraph import edge extraction。
- 验证证据更新 `docs/verification/practice-assets-s3-checkpoint-gate.md`；focused contract/core/runtime/local-product suite 为 151 pass / 0 fail / 718 expects，local-product E2E 为 4 pass / 0 fail / 73 expects，CLI focused suite 为 18 pass / 0 fail / 339 expects，`bun run verify` 为 608 pass / 0 fail / 3677 expects。
- 2026-06-24：从 checkpoint hardening head 创建 `codex/practice-codegraph-edge-context`，补 CodeGraph changed-path import edge extraction 和真实 installed cross-layer import E2E。
- 实现边界：`checkpointTask` 将 changed paths 传入 `compileTaskContext`；`CodeGraphCliProvider` 对 changed paths 单独执行 `query -k import`，解析 relative import specifier 为 repo-relative file edge；普通 `sync --changed` 不污染后续 prepare/checkpoint context。
- 验证证据更新 `docs/verification/practice-assets-s3-checkpoint-gate.md`；typecheck 通过，CodeGraph adapter suite 为 5 pass / 0 fail / 22 expects，context compiler suite 为 3 pass / 0 fail / 23 expects，core application suite 为 11 pass / 0 fail / 39 expects，practice engine suite 为 14 pass / 0 fail / 69 expects，local-product E2E 为 5 pass / 0 fail / 82 expects，`bun run verify` 为 610 pass / 0 fail / 3693 expects。
- 2026-06-24：从 CodeGraph import-edge head 创建 `codex/practice-hook-egress-audit`，补 S3-EG1 独立 hook egress packet/readback。
- 实现边界：新增 `scripts/practice-hook-egress-readback.mjs`、`scripts/practice-hook-egress-readback.test.ts` 和 `docs/verification/practice-hook-egress-readback.json`，验证 hook success、fail-open 和 central adapter 都保持 `egress = none` / `network = forbidden`，且 packet capture `totalRequests = 0`、网络 entries 为空、无 raw changed path body、无源码/diff/token payload。不改 checkpoint runtime 行为。
- 验证证据更新 `docs/verification/practice-assets-s3-checkpoint-gate.md`；hook egress readback 为 `ok = true`、`totalRequests = 0`、DLP 115 checked values；focused suite 为 5 pass / 0 fail / 10 expects；`bun run verify` 为 615 pass / 0 fail / 3703 expects。

## 11.2 Checklist

### Checkpoint contract

- [x] S3-01 定义 `CheckpointInputV2`：sessionId、headSha、expectedWorktreeDigest、event、changedPaths、optional toolCallId。
- [x] S3-02 changed paths 只作为提示；daemon 通过 Git adapter/CodeFacts 获取权威 worktree 与结构事实。
- [x] S3-03 定义 `PracticeDelta`：added、removed、upgraded、downgraded、unchanged、requiresProof。
- [x] S3-04 Checkpoint result 绑定 head SHA、worktree digest、catalog digest、context digest。

### Incremental evaluation

- [x] S3-05 daemon session 保存上一次 effective match set 与 evidence digest。
- [x] S3-06 changed path 与 affected symbol/edge 建立增量候选范围，避免每次全仓扫描。（checkpoint-scoped changed paths 传入 CodeFacts `buildTaskContext`；CodeGraph adapter 对 normalized changed paths 执行 `query -k import` 生成 affected import edges，且普通 `sync --changed` 不污染后续 context。）
- [x] S3-07 对 rename、delete、generated files、ignored files、binary files 建立确定规则。（`hook.pathSummary` 覆盖 source/generated/ignored/binary/deleted/renameHints，且不含路径正文。）
- [x] S3-08 当实际 diff 消除触发条件时，checkpoint 能撤销或降级 prepare 建议。（core observed-cycle removed；installed hook compatibility revert downgraded。）
- [x] S3-09 当编辑引入新增 cycle、boundary import、compatibility path 时，checkpoint 能追加实践。（core observed-cycle、installed compatibility path、installed real cross-layer import 均覆盖；cross-layer import 返回 `modularity.respect-dependency-direction` + `import-edge` evidence。）
- [x] S3-10 worktree/head/catalog 变化导致旧 checkpoint stale，返回可操作 reason code。

### Hook 入口

- [x] S3-11 增加稳定 daemon RPC 与 CLI：`archctx hook checkpoint --event post-edit [--path ...]`。
- [x] S3-12 CLI 只转发事件，不读取源码、不做 matching、不直接写状态。
- [x] S3-13 为 central `repo-harness-hook` 定义 adapter contract 与配置示例，不在本仓库复制完整 Hook runtime。
- [x] S3-14 提供 `archctx hooks install/status/remove` 或扩展现有 host 安装流程，输出配置而非静默改写用户配置。
- [x] S3-15 连续事件进行 debounce/coalesce；同一 tool call/路径集不重复分析。
- [x] S3-16 Hook 设置本地超时和 fail-open；daemon 不可用时只 warning，不阻塞编辑。
- [x] S3-17 Hook 路径明确禁止 HTTP、Context7、LLM、embedding 与外部 telemetry。
- [x] S3-18 本地日志仅记录 event type、耗时、path count、digest 和 reason code，不记录代码正文。

### MCP/Agent 体验

- [x] S3-19 `archcontext_checkpoint` 返回 delta，而不是重复完整 prepare payload。
- [x] S3-20 Agent guidance 明确区分：new issue、resolved issue、proof required、stale session。
- [x] S3-21 Skills 只编排 checkpoint SOP，不复制 practice 文本或 matching 规则。
- [x] S3-22 对无变化 checkpoint 返回 no-op digest，避免 Agent 噪声。

### 测试与实跑

- [x] S3-23 单测覆盖 debounce、dedupe、delta diff、stale、rename/delete 和 fail-open。（新增 path classification matrix；既有覆盖 coalesce、dedupe、delta added/removed、stale、fail-open。）
- [x] S3-24 独立进程 E2E：Agent/脚本进程 → hook CLI → daemon → CodeFacts → checkpoint result。（installed `archctx hook checkpoint` E2E 通过 loopback daemon 和 real CodeGraph。）
- [x] S3-25 真实 fixture 中 prepare 无警告，编辑后新增跨层 import，checkpoint 返回对应 practice。（installed `archctx hook checkpoint` E2E 覆盖 prepare 不含 dependency-direction、编辑 `src/web/page.ts` import `../domain/order-service`、checkpoint added `modularity.respect-dependency-direction`。）
- [x] S3-26 回滚编辑后再次 checkpoint，原 practice 被 removed/downgraded。（core observed-cycle removed；installed hook compatibility revert downgraded。）
- [x] S3-27 daemon stop/crash/stale lock 场景不阻断编辑，并可在恢复后继续同一 session。（hook fail-open、runtime stale-lock recovery、baseline restart recovery 均有测试覆盖。）
- [x] S3-28 编写 `docs/verification/practice-assets-s3-checkpoint-gate.md`，附真实 Hook readback。

## 11.3 Exit Gates

- [x] S3-EG1 Hook 不包含网络调用；packet/audit 证明 egress = 0。（`docs/verification/practice-hook-egress-readback.json` + `scripts/practice-hook-egress-readback.mjs` 证明 hook success/fail-open/adapter 均 local-only，packet capture `totalRequests = 0`，且 DLP 通过。）
- [x] S3-EG2 warm checkpoint p95 ≤ 250ms；cold checkpoint p95 ≤ 750ms，测试仓库规模与环境写入证据。
- [x] S3-EG3 连续 10 次 Write/Edit 事件最多触发 1 次有效分析和 1 次结果回传。
- [x] S3-EG4 daemon 不可用时 Hook fail-open，退出码与用户提示符合 contract。
- [x] S3-EG5 prepare → edit → checkpoint → revert → checkpoint 的 practice delta 可复现。（core added/removed fixture 和真实 installed hook edit/revert fixture 均覆盖。）
- [x] S3-EG6 central-first Hook 配置无需将 `hook_source` 设置为 `repo`。

## 11.4 验证命令

```bash
bun test packages/core/application
bun test packages/local-runtime/runtime-daemon
bun test packages/surfaces/cli
bun test packages/surfaces/mcp-local
bun run e2e:local-no-cloud
node scripts/practice-hook-egress-readback.mjs readback --evidence docs/verification/practice-hook-egress-readback.json --json
bun run verify
```

## 11.5 Rollback

- `practices.checkpointHooks.enabled: false` 即时禁用自动触发，手动 `archctx checkpoint` 保留。
- Hook adapter 版本不兼容时跳过触发，不影响 daemon、prepare 或 complete。

---

# 12. Sprint 4 — Deterministic Practice Enforcement

> Suggested branch: `feat/practice-enforcement`
> Suggested PR: `feat(practices): enforce deterministic repo policies at complete`
> Target evidence: E2
> User-visible result: 仓库显式启用的确定性 practice 可在 complete 阶段给出结构化 fail/action，支持有期限 waiver。

## 12.1 目标

把“建议”与“规则”严格分开，只允许可验证、可解释、可复现的 checker 进入 Gate。

## 12.1.1 S4 执行记录

- 2026-06-24：从 S3 stacked head 创建 `codex/practice-enforcement`，实现 S4 deterministic complete enforcement 第一刀。
- 实现边界：新增 practice policy / waiver / check-result contracts 与 schemas，新增 `practice-engine` checker registry 和 enforcement evaluator，runtime daemon 在 repo policy `mode=active` 时加载 `.archcontext/policies/practices.yaml` 与 `.archcontext/waivers/*.yaml`，用 current guidance + previous checkpoint baseline 计算 complete-stage enforcement。
- 首批 checker：`compatibility-contract-required` 与 `no-new-cycle`。`no-new-cycle` 只阻断 baseline 后新增 import-cycle evidence；无 baseline 时返回 `not_applicable:no-baseline`，不追责历史存量。
- Trust boundary：CLI/MCP 仍只传 task/posture/head/compatibility/cleanup metadata；`practiceEnforcement`、`practiceViolations`、waiver outputs 和 practice digests 全部加入 caller-provided denylist。
- Deferred：`dependency-direction`、`owner-required`、migration review/removal、required-test-evidence 仍未实现。
- 验证证据写入 `docs/verification/practice-assets-s4-enforcement-gate.md`。
- 2026-06-24：full verification 通过，`bun run verify` readback 为 595 pass / 0 fail / 3529 expects；FG3 adversarial review conclusion evidence 已按扩展后的 practice attestation denylist 重新生成。
- 2026-06-24：从 S4 enforcement stacked head 创建 `codex/practice-waiver-governance`，补齐 owner-aware waiver validation 与 ChangeSet-backed waiver draft/apply/readback。
- 实现边界：waiver owner registry 从 `.archcontext/model/nodes/**` 的 `ownership.lifecycle` / `ownership.data` 读取；`.archcontext/waivers/*.json|*.yaml` 的 JSON-compatible waiver 文件读取时拒绝未知 owner；`archctx practices waivers` 只读列表，`archctx practices waive` 只生成 `write_waiver` ChangeSet draft。
- 写入边界：实际文件写入仍必须通过既有 `applyUpdate` / `archctx apply --approved --expected-worktree-digest ...`，继承 ChangeSet expected hash、worktree digest、policy-engine allowlist、symlink denial、journal 与 rollback。
- 验证证据写入 `docs/verification/practice-assets-s4-waiver-governance.md`。
- 2026-06-24：waiver governance full verification 通过，最终 `bun run verify` readback 为 597 pass / 0 fail / 3556 expects；期间一次 local-product E2E 15s 子进程超时已单独重跑通过后再跑全量通过。
- 2026-06-24：从 waiver governance stacked head 创建 `codex/practice-compat-dedupe`，完成 S4-22 compatibility finding 去重。
- 实现边界：当 `compatibility-contract-required` practice violation 的 subjects 已由直接 compatibility contract gate 报出时，`completeTaskGate` 保留 `practiceViolations`、policy/check digests 与 `actionsRequired`，但 suppress 重复的 user-facing `practice:*` finding 和错误计数；suppressed finding 记录在 `extensions.suppressedPracticeFindings`。
- 验证证据写入 `docs/verification/practice-assets-s4-compat-dedupe.md`。
- 2026-06-24：compatibility dedupe full verification 通过，`bun run verify` readback 为 598 pass / 0 fail / 3564 expects。
- 2026-06-24：从 compat dedupe stacked head 创建 `codex/practice-dependency-direction`，完成 S4-09 `dependency-direction` deterministic checker。
- 实现边界：checker 只接受 explicit repo layer/boundary profile 派生的 non-heuristic `architecture-model` / `import-edge` violation subjects，例如 `declared-layer-violation:*`、`boundary-violation:*`、`dependency-direction-violation:*`；普通 import edge 只可参与召回，不能 hard-fail complete。
- Baseline 行为：与 `no-new-cycle` 一致，只阻断 checkpoint baseline 后新增的显式 dependency-direction violation；无 baseline 时返回 `not_applicable:no-baseline`，不追责历史存量。
- 验证证据写入 `docs/verification/practice-assets-s4-dependency-direction.md`。
- 2026-06-24：dependency-direction full verification 通过，`bun run verify` readback 为 599 pass / 0 fail / 3572 expects。
- 2026-06-24：从 dependency-direction stacked head 创建 `codex/practice-owner-required`，完成 S4-10 `owner-required` deterministic checker。
- 实现边界：owner checker 只检查 explicit governed component/resource evidence；plain symbol evidence 不会 hard-fail。owner proof 来自 daemon-owned `.archcontext/model/nodes` owner registry 或 explicit lifecycle-owner evidence，且 owner identity 必须解析到 daemon registry 中 exactly one known lifecycle owner。
- Catalog 边界：`ownership.explicit-lifecycle-owner` 从 checkpoint-only 晋升为 repo opt-in complete-capable，内置 catalog manifest digest 同步更新。
- 验证证据写入 `docs/verification/practice-assets-s4-owner-required.md`。
- 2026-06-24：owner-required full verification 通过，`bun run verify` readback 为 600 pass / 0 fail / 3581 expects。
- 2026-06-24：从 owner-required stacked head 创建 `codex/practice-migration-state`，完成 S4-11 `migration-review-date` 与 `migration-removal-condition` deterministic checker。
- 实现边界：migration checker 只接受 explicit migration `architecture-model` / `diff` evidence；plain symbol 和 task text 不会 hard-fail。review date 必须是 exactly one `YYYY-MM-DD`，removal condition 必须是 exactly one durable non-vague condition。
- Catalog 边界：`migration.target-and-removal-state` 从 checkpoint-only 晋升为 repo opt-in complete-capable，内置 catalog manifest digest 同步更新。
- 验证证据写入 `docs/verification/practice-assets-s4-migration-state.md`。
- 2026-06-24：migration-state full verification 通过，`bun run verify` readback 为 601 pass / 0 fail / 3590 expects。
- 2026-06-24：从 migration-state stacked head 创建 `codex/practice-test-evidence`，完成 S4-12 `required-test-evidence` deterministic checker。
- 实现边界：policy rule 新增可选 `testEvidence.commands` / `testEvidence.subjects`；checker 仅在 policy 明确声明测试命令或证据 subject 时启用。未声明时返回 `not_applicable`，task text、symbol evidence 和 heuristic-only evidence 都不能触发或满足 complete hard gate。
- Catalog 边界：`api.contract-before-implementation` 从 checkpoint-only 晋升为 repo opt-in complete-capable，并要求 enforcement evidence 包含 `test` kind；内置 catalog manifest digest 同步更新。
- 验证证据写入 `docs/verification/practice-assets-s4-test-evidence.md`。
- 2026-06-24：test-evidence full verification 通过，`bun run verify` readback 为 603 pass / 0 fail / 3601 expects。

## 12.2 Checklist

### Enforcement contract

- [x] S4-01 定义 enforcement levels：`advisory | checkpoint | complete`，与 severity 分离。
- [x] S4-02 定义 `PracticeCheckDefinitionV1`、`PracticeCheckResultV1`、reason code 和 remediation contract。
- [x] S4-03 定义 repo opt-in policy：`.archcontext/policies/practices.yaml`。
- [x] S4-04 built-in practice 默认 advisory；只有 repo policy 显式列出的 ID 可晋升。
- [x] S4-05 dynamic external resource、heuristic-only match 和 unknown checker 的 enforcement ceiling 固定为 advisory。

### Deterministic checker registry

- [x] S4-06 实现纯函数 checker registry；checker 只能读取 normalized facts、model、policy 与 digest，不读取网络或 LLM。
- [x] S4-07 首批实现 `compatibility-contract-required`。
- [x] S4-08 首批实现 `no-new-cycle`，只阻断本次变更新增的 cycle，不追责历史存量。
- [x] S4-09 首批实现 `dependency-direction`，基于显式 repo layer/boundary profile。
- [x] S4-10 首批实现 `owner-required`，只对声明为 governed 的 component/resource 生效。
- [x] S4-11 首批实现 `migration-review-date` 与 `migration-removal-condition`。
- [x] S4-12 首批实现 `required-test-evidence`，仅在 policy 明确指定测试命令/证据时启用。
- [x] S4-13 Checker 结果包含 inspected fact digests、violation subjects、existing/new 状态和 remediation。

### Waiver 与治理

- [x] S4-14 定义 `.archcontext/waivers/*.yaml`：practiceId、scope、owner、reason、createdAt、expiresAt、evidenceDigest。
- [x] S4-15 Waiver 必须有 owner、耐久理由、具体 scope 和过期时间；禁止 `temporary`、`cleanup later` 等空泛理由。
- [x] S4-16 过期、扩大 scope、digest 不匹配或未知 owner 的 waiver 被拒绝。
- [x] S4-17 Waiver 创建/更新必须走 ChangeSet engine、expectedWorktreeDigest 与路径白名单。
- [x] S4-18 CLI 增加 `archctx practices waive/waivers`，写操作要求显式 approval。

### Complete gate 集成

- [x] S4-19 `completeTaskGate` 在 stale、catalog/context digest 有效后运行 practice checks。
- [x] S4-20 stale-context 优先于 practice violation，避免对旧上下文给出错误结论。
- [x] S4-21 complete 输出新增 `practiceViolations`、`waiversApplied`、`actionsRequired`。
- [x] S4-22 兼容现有 compatibility contract 与 incomplete intervention gate，不重复或矛盾报错。
- [x] S4-23 Gate 结果与 device attestation 绑定 catalog digest、policy digest 和 check result digest。

### 测试

- [x] S4-24 negative tests 证明 task text 无论多强烈都不能单独阻断 complete。
- [x] S4-25 historical debt fixture 证明只阻断新增 violation，除非 policy 显式启用 full baseline。
- [x] S4-26 waiver valid/expired/overscoped/tampered matrix 全覆盖。
- [x] S4-27 CLI 与 MCP 不能传入或伪造 `pass`、enforcement level 或 check result。
- [x] S4-28 complete 的 deterministic rerun 在相同 inputs 下产生相同 digest。
- [x] S4-29 编写 `docs/verification/practice-assets-s4-enforcement-gate.md`。

## 12.3 Exit Gates

- [x] S4-EG1 100% complete-blocking 结果来自注册 deterministic checker。
- [x] S4-EG2 heuristic-only、Context7、LLM 或 Agent 字段造成的 hard-gate 数量 = 0。
- [x] S4-EG3 同一 head/worktree/catalog/policy 输入重复执行结果 digest 一致。
- [x] S4-EG4 invalid/expired/tampered waiver 拦截率 = 100%。
- [x] S4-EG5 关闭 repo enforcement policy 后，所有 built-in practices 恢复 advisory，不改变旧 complete gates。
- [x] S4-EG6 attestation 中可验证 catalog/policy/check digests，且不包含代码正文。

## 12.4 验证命令

```bash
bun test packages/core/practice-engine
bun test packages/core/policy-engine
bun test packages/core/review-engine
bun test packages/core/changeset-engine
bun test packages/contracts/test
bun evals/run.ts --check
bun run verify
```

## 12.5 Rollback

- `practices.enforcement.mode: advisory` 全局降级，不删除 policy/waiver 数据。
- 单条规则可通过 policy 显式降级；禁止直接修改 built-in asset 绕过历史 attestation。

---

# 13. Sprint 5 — Privacy-bounded Context7 Provider

> Suggested branch: `feat/context7-external-docs`
> Suggested PR: `feat(context7): add privacy-bounded dynamic documentation resources`
> Target evidence: E3
> User-visible result: 用户可按 exact library/version 获取 Context7 文档资源，并在 prepare 中作为 advisory reference 使用。

## 13.1 目标

增加动态版本文档能力，但保持 Local Core 默认零依赖、默认零 egress、Gate 完全确定性。

## 13.2 Checklist

### ADR 与 Port

- [x] S5-01 新增 ADR-0038：`External Documentation Is Advisory and Untrusted`。（已用 ADR-0039 落地；ADR-0038 已被 Versioned Practice Assets 占用。）
- [x] S5-02 定义 `ExternalDocumentationPort`，core 不依赖 Context7 SDK、HTTP client 或 MCP client。
- [x] S5-03 定义 provider capability、resolve、query、cache、purge、health typed contract。
- [x] S5-04 定义 `ExternalDocumentationResourceV1`，强制 trust=`external-unverified`、enforcement=`advisory-only`。

### Context7 adapter

- [x] S5-05 新建 `packages/local-runtime/context7-adapter`。
- [x] S5-06 优先使用官方 SDK/REST adapter；不在默认实现中 shell out 到 `ctx7`，不在 ArchContext MCP server 内递归调用另一个 MCP server。
- [x] S5-07 API key 只从 OS credential/env/user data 读取，不进入 repo、SQLite 明文或日志。
- [x] S5-08 配置默认 `enabled: false`，支持 `manual | prepare-unknowns` 两种模式。
- [x] S5-09 Context7 library ID 必须写入 lockfile；模糊 resolve 需要用户确认后固定。
- [x] S5-10 从 package lock/manifest 获取 exact version；无法确定版本时只返回 unknown，不猜测 latest。

### Query minimization 与 DLP

- [x] S5-11 实现 structured intent builder，只发送 libraryId、version、受限 intent 和 sanitised query。
- [x] S5-12 建立 denylist/shape validator，拒绝 repository 名称、绝对路径、代码块、Diff、symbol list、secret-like token。
- [x] S5-13 Provider request/response 日志只记录 digest、status、latency、byte count、libraryId 和 version。
- [x] S5-14 外部内容经过 size limit、control-character cleanup、instruction-boundary 标记和 URI validation。
- [x] S5-15 将 Provider 内容标为 untrusted documentation data，禁止覆盖 system/agent instructions。
- [x] S5-16 建立 rate limit、timeout、retry budget、circuit breaker；失败回退缓存或 static-only。

### Cache 与 provenance

- [x] S5-17 SQLite 增加 external docs cache：provider、libraryId、version、queryDigest、contentDigest、retrievedAt、expiresAt。
- [x] S5-18 默认 TTL 可配置；过期内容标 stale，不静默当作 fresh。
- [x] S5-19 Cache key 不包含 raw task；purge 支持 provider/library/all。
- [x] S5-20 Context7 返回资源只写入 `resources`/`unknowns`，不能填充 enforceable constraints。
- [x] S5-21 `archcontext://external-docs/context7/<digest>` 只从本地 daemon resource 读取。

### CLI/MCP/prepare

- [x] S5-22 增加 `archctx docs resolve <library>`，显示候选但不自动写 lockfile。
- [x] S5-23 增加 `archctx docs pin <libraryId> --version <version>`，显式 approval 后写 `.archcontext/integrations/context7.lock.yaml`。
- [x] S5-24 增加 `archctx docs fetch <libraryId> --query <intent>`、`status`、`purge`。
- [x] S5-25 `prepare-unknowns` 只在 static match 已确认 framework scope 且存在版本相关 unknown 时调用。
- [x] S5-26 Hook/checkpoint/complete 路径加入硬断言：不得调用 ExternalDocumentationPort。
- [x] S5-27 MCP 暴露只读 external resource，不增加可让 Agent 绕过 allowlist 的通用 HTTP 工具。

### 安全与实跑

- [x] S5-28 Unit tests 使用 fake transport 验证 request minimization、redaction、TTL、stale 和 circuit breaker。
- [x] S5-29 DLP packet fixture 验证源码、Diff、路径、symbol、secret 路由数 = 0。
- [x] S5-30 真实 Context7 readback 使用公开 fixture package 与无敏感 task，记录 exact library ID/version。
- [x] S5-31 验证 Context7 关闭、无 key、无网络、429、timeout、malformed response 时 Local Core 结果不变。
- [x] S5-32 编写 `docs/verification/practice-assets-s5-context7-gate.md`。

## 13.3 Exit Gates

- [x] S5-EG1 默认安装与默认 prepare 的 egress = 0。
- [x] S5-EG2 Outbound payload 只含 allowlisted 字段；敏感字段泄漏测试拦截率 = 100%。
- [x] S5-EG3 Context7 内容参与 hard gate 的路径数 = 0，具有代码级断言与 negative test。
- [x] S5-EG4 exact library/version 可重放命中 cache，并显示 provider、retrievedAt、expiresAt、content digest。
- [x] S5-EG5 Provider 不可用时 static practice IDs、pressure、posture、complete conclusion 与禁用 Provider 时一致。
- [x] S5-EG6 真实 Provider readback 明确记录社区内容不保证准确，不宣称端到端可审计。

## 13.4 验证命令

```bash
bun test packages/local-runtime/context7-adapter
bun test packages/local-runtime/local-store-sqlite
bun test packages/core/context-compiler
bun test packages/surfaces/cli
bun run record:s5:context7
bun run readback:s5:context7
bun run record:s5:context7:live
bun run readback:s5:context7:live
bun run e2e:local-no-cloud
bun run verify
```

## 13.5 Execution Record — 2026-06-24

Completed S5 manual Context7 external docs vertical slice on branch
`codex/context7-external-docs`.

- Contracts: `ExternalDocumentationPort`, provider health/resolve/fetch/purge/cache DTOs, `ExternalDocumentationResourceV1`, JSON schema, and fixture.
- Runtime: disabled-by-default Context7 provider, explicit `docs status|resolve|pin|fetch|purge`, daemon-owned lockfile, daemon-owned sanitized query digest, SQLite cache, stale readback, and purge.
- Adapter: REST transport path, bounded intent builder, outbound DLP validator, size/control-character cleanup, HTTPS URI validation, advisory-only resource projection, and no shell/MCP recursion.
- Evidence: `docs/adr/ADR-0039-external-documentation-advisory-untrusted.md`, `docs/verification/practice-assets-s5-context7-gate.md`, and `docs/verification/practice-context7-readback.json`.
- Verified: `bun test scripts/practice-context7-readback.test.ts packages/local-runtime/context7-adapter/test/context7-adapter.test.ts`, `bun run record:s5:context7`, `bun run readback:s5:context7`, focused runtime/store/CLI/contracts suites, and `bun run typecheck`.

Remaining S5 work is intentionally not marked complete: real live Context7
readback and the full provider failure matrix.

## 13.6 Execution Record — 2026-06-24

Completed S5 `prepare-unknowns` advisory integration on branch
`codex/context7-prepare-unknowns`.

- Runtime: `prepare` now augments context only when Context7 is explicitly
  enabled in `prepare-unknowns` mode, compiled context already exposes
  dependency/version pressure, the library is pinned in
  `.archcontext/integrations/context7.lock.yaml`, and the package version is
  exact in `package-lock.json` or `package.json`.
- Context shape: external docs are appended only as `context.resources` and
  `context.unknowns`; `constraints`, `realConstraints`, and
  `practiceGuidance.resources` remain static and deterministic.
- Failure behavior: framework tasks without version unknowns and fuzzy manifest
  versions do not call the provider; provider failure leaves static practice
  IDs, pressure, posture, and complete behavior unchanged.
- Evidence: `docs/verification/practice-context7-readback.json` now records
  prepare-unknowns cache replay, advisory resource metadata, and zero
  checkpoint/complete provider references.
- Verified: `bun run typecheck`, focused runtime tests for
  `external docs|prepare-unknowns`, `bun test scripts/practice-context7-readback.test.ts`,
  `bun run record:s5:context7`, `bun run readback:s5:context7`, broader
  runtime/CLI/readback tests, `node scripts/sprint-status-check.mjs`, and
  `bun run verify`.

## 13.7 Execution Record — 2026-06-24

Completed S5 provider observability/resilience module on branch
`codex/context7-provider-resilience`.

- Adapter: Context7 provider calls now use metadata-only telemetry, classified
  provider errors, bounded retry budget, local rate limit, timeout handling, and
  circuit breaker. Telemetry fields are restricted to provider, operation,
  query digest, status, latency, byte count, library ID, and version.
- Runtime fallback: prepare-unknowns keeps Local Core unchanged on provider
  failure, and expired cached docs fall back as `cacheStatus=stale` advisory
  resources instead of failing prepare.
- Evidence: `docs/verification/practice-context7-readback.json` now records
  provider telemetry allowlist assertions, with raw query/content/credential
  presence all false.
- Verified: `bun test packages/local-runtime/context7-adapter/test/context7-adapter.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts scripts/practice-context7-readback.test.ts --timeout 20000`, `bun run record:s5:context7`, `bun run readback:s5:context7`, and `bun run typecheck`.

Remaining S5 work is intentionally not marked complete: live real Context7
provider readback and the full disabled/no-key/no-network/429/timeout/malformed
Local Core failure matrix.

## 13.8 Execution Record — 2026-06-24

Completed S5 MCP read-only external-docs resource module on branch
`codex/context7-mcp-resource`.

- Store/runtime: SQLite and `TestLocalStore` can read external docs by
  provider/content digest; daemon exposes `readResource(root, uri)` and validates
  only `archcontext://external-docs/context7/sha256:<digest>` URIs.
- RPC/MCP: `RuntimeRpcClient` and loopback server dispatch `readResource`;
  `McpLocalServer` exposes `resources/list` and `resources/read` for daemon
  cached external docs, plus local HTTP `/mcp/resources` and
  `/mcp/resources/read` routes.
- Safety: MCP did not add any generic HTTP/fetch/request tool. Unsupported
  external URIs and missing cache entries do not trigger provider/network
  access.
- Evidence: `docs/verification/practice-context7-readback.json` now records
  `runtime.mcpResource` readback with `listed=true`, `readOk=true`,
  matching URI, external-unverified data classification, and
  `genericHttpToolPresent=false`.
- Verified: `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts scripts/practice-context7-readback.test.ts --timeout 20000`, `bun test packages/surfaces/mcp-local/test/chatgpt-surface.test.ts`, `bun run record:s5:context7`, `bun run readback:s5:context7`, `node scripts/sprint-status-check.mjs`, and `bun run typecheck`.

Remaining S5 work is intentionally not marked complete: live real Context7
provider readback and the full disabled/no-key/no-network/429/timeout/malformed
Local Core failure matrix.

## 13.9 Execution Record — 2026-06-24

Completed S5 provider failure matrix module on branch
`codex/context7-failure-matrix`.

- Runtime tests: `prepare-unknowns` now has an explicit six-case matrix for
  disabled provider, no key, no network, 429, timeout, and malformed response.
  Each case compares prepare/complete Local Core projection against the static
  no-provider baseline.
- Evidence: `docs/verification/practice-context7-readback.json` now records
  `runtime.failureMatrix` with `rowCount=6`, all failure statuses, zero
  external-docs resources added, and unchanged practice IDs, constraints, real
  constraints, posture, pressure, and complete output.
- Inspector: `scripts/practice-context7-readback.ts` rejects missing/incomplete
  matrix rows, unexpected failure statuses, nonzero external-docs resources, and
  false `failureMatrixKeepsLocalCoreUnchanged` assertions.
- Verified: `bun test packages/local-runtime/context7-adapter/test/context7-adapter.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts scripts/practice-context7-readback.test.ts --timeout 20000`, `bun run record:s5:context7`, `bun run readback:s5:context7`, `node scripts/sprint-status-check.mjs`, `bun run typecheck`, `git diff --check`, and `bun run verify`.

Remaining S5 work is intentionally not marked complete: live real Context7
provider readback and S5-EG6 community-content disclaimer readback.

## 13.10 Execution Record — 2026-06-24

Completed S5 live Context7 provider readback module on branch
`codex/context7-live-readback`.

- Adapter: `HttpContext7Transport` now uses the current Context7 public
  `GET /api/v2/context` endpoint and projects `codeSnippets`/`infoSnippets`
  into the existing internal external-document resource shape.
- Evidence: `docs/verification/practice-context7-live-readback.json` records the
  public fixture `/vercel/next.js@v15.1.8`, bounded intent
  `app router metadata api`, metadata-only telemetry, content/query digests,
  advisory trust labels, and explicit community-content disclaimer.
- Inspector: `scripts/practice-context7-readback.ts` now has explicit
  `live`/`inspect-live` commands and rejects missing exact library/version,
  sensitive task fields, raw-content leakage, missing disclaimer, and any claim
  that the live provider readback is end-to-end auditable.
- Verified: `bun test scripts/practice-context7-readback.test.ts packages/local-runtime/context7-adapter/test/context7-adapter.test.ts --timeout 20000`, `bun run record:s5:context7:live`, and `bun run readback:s5:context7:live`.

S5 is now complete. Remaining work moves to Sprint 6 catalog expansion,
evaluation, packaging, and release gates.

## 13.11 Rollback

- `externalDocs.context7.enabled: false` 完全禁用 Provider；缓存可保留或显式 purge。
- Adapter 不可用不得影响 daemon 启动、prepare、checkpoint、complete 或 attestation。

---

# 14. Sprint 6 — Catalog Expansion, Evals, Packaging and Release

> Suggested branch: `release/practice-assets-v1`
> Suggested PR: `release(practices): expand curated assets and close production gates`
> Target evidence: E4
> User-visible result: 具备足够覆盖、可量化质量、跨平台打包与安全回滚的 Practice Assets v1。

## 14.1 目标

从 MVP vertical slices 升级为可发布能力，完成资产来源、评测、性能、分发、文档、灰度和长期维护机制。

## 14.2 Checklist

### Catalog 扩展

- [x] S6-01 将 built-in catalog 扩展到 40–60 条高质量 practice，不追求数量超过质量。
- [x] S6-02 每个 category 至少 3 条，且包括至少一个 negative-scope fixture。
- [x] S6-03 建立 6–10 个 profiles：generic-service、library、typescript、java、kubernetes、event-driven、monorepo 等。
- [x] S6-04 对 MADR、Backstage、ArchUnit、Structurizr DSL、Twelve-Factor、OpenTelemetry、Kubernetes、OpenSSF 完成 pinned source records。
- [x] S6-05 OWASP/arc42 未完成 ShareAlike 分发评审前保持 reference-only，不进入默认 package。
- [x] S6-06 所有 assets 的 provenance、license policy、curator、review date、revision、digest 完整率 = 100%。
- [x] S6-07 建立 asset deprecation/supersession 流程，不允许删除仍被 policy/attestation 引用的历史 revision。

### Eval 数据集

- [x] S6-08 建立至少 120 个代表性场景：正例 ≥ 60、负例 ≥ 60。
- [x] S6-09 中文场景占比 ≥ 25%，包含自然语言改写、同义词和混合中英文代码词。
- [x] S6-10 至少 30 个 no-keyword structural positives。
- [x] S6-11 至少 30 个 keyword-heavy benign negatives。
- [x] S6-12 至少 20 个 enforcement/waiver adversarial cases。
- [x] S6-13 至少 20 个 budget/irrelevant resource cases。
- [x] S6-14 数据集记录 expected practice IDs、expected evidence minimum、prohibited IDs、expected enforcement ceiling。

### 质量指标

- [x] S6-15 Practice Top-3 recall ≥ 92%。
- [x] S6-16 Constraint recall ≥ 95%。
- [x] S6-17 Irrelevant ratio ≤ 15%。
- [x] S6-18 Benign precision ≥ 95%。
- [x] S6-19 No-keyword structural recall ≥ 85%。
- [x] S6-20 Heuristic-only hard-gate rate = 0%。
- [x] S6-21 Dynamic-doc hard-gate rate = 0%。
- [x] S6-22 Waiver invalid/tampered rejection = 100%。

### 性能与可靠性

- [x] S6-23 100 assets catalog warm load p95 ≤ 50ms。
- [x] S6-24 Practice matching 增量给 prepare 增加的 warm p95 ≤ 150ms。
- [x] S6-25 Hook checkpoint warm p95 ≤ 250ms，且不依赖网络。
- [x] S6-26 Catalog/cache corruption 返回 typed recovery path，不导致数据静默错误。
- [x] S6-27 SQLite migration 可前滚/回滚，旧 daemon 对未知表安全忽略或给版本错误。
- [x] S6-28 Daemon upgrade 后旧 session 明确 stale 或迁移，不混用不同 catalog digest。

### 打包与跨平台

- [x] S6-29 packaged CLI/tarball 包含 catalog、source registry、schemas 和必要 attribution。
- [x] S6-30 Linux/macOS/Windows 安装、升级、卸载与 data retention matrix 通过。
- [x] S6-31 `npm pack --dry-run`/产品分发 manifest 明确列出 assets，防止 `.npmignore` 漏包。
- [x] S6-32 本地无云 E2E 覆盖 `init → sync → practices validate → prepare → checkpoint → complete`。
- [x] S6-33 Context7 作为 optional dependency/capability，不扩大 Local Core 的强制安装面。

### 文档与运营

- [ ] S6-34 README 增加 Static Assets 与 Dynamic Docs 的信任边界说明。
- [ ] S6-35 增加“如何编写 repo practice”“如何晋升 enforcement”“如何添加 waiver”“如何接入 Hook”。
- [ ] S6-36 增加“如何 pin Context7 library/version”“哪些数据不会发送”的隐私文档。
- [ ] S6-37 建立 source update runbook、license incident runbook、false-positive rollback runbook。
- [ ] S6-38 建立资产季度 review 机制与 owner。
- [ ] S6-39 建立 feature flags 与逐级 rollout readback。
- [ ] S6-40 编写 `docs/verification/practice-assets-s6-release-gate.md`。

## 14.3 Exit Gates

- [x] S6-EG1 所有质量与性能 KPI 通过 `bun evals/run.ts --check` 或独立 gate 脚本。
- [x] S6-EG2 所有发布 assets provenance/license/digest 完整率 = 100%。
- [x] S6-EG3 三大 OS packaged product E2E 全绿。
- [x] S6-EG4 默认配置保持 static-only、zero-egress、advisory-first。
- [ ] S6-EG5 enforcement 与 Context7 均可独立关闭，关闭后旧 Local Core 行为保持兼容。
- [ ] S6-EG6 至少一个真实 Agent host 的 central Hook readback 完成。
- [ ] S6-EG7 发布、回滚、catalog revision、session stale 和 cache purge runbook 实跑通过。

## 14.4 验证命令

```bash
bun run typecheck
bun test
bun evals/run.ts --check
bun run e2e:local-no-cloud
bun run e2e:local-product-tarball
bun run verify:acceptance-ledger
bun run verify
```

## 14.5 Rollout

1. **Phase A — Catalog only**：S1 合并，用户可 list/validate，无行为变化。
2. **Phase B — Advisory prepare**：S2 合并，built-in matching 默认 advisory。
3. **Phase C — Opt-in hooks**：S3 合并，只有安装/启用 Hook 的用户触发 checkpoint。
4. **Phase D — Repo opt-in enforcement**：S4 合并，默认仍不阻断。
5. **Phase E — Opt-in Context7**：S5 合并，默认关闭。
6. **Phase F — v1 release**：S6 指标和跨平台 Gate 全绿后，宣告 Practice Assets v1。

## 14.6 Execution Record — 2026-06-24

Completed the S6 catalog-scale slice on branch
`codex/practice-assets-s6-catalog-scale`.

- Catalog: 41 total built-in practices, 40 active practices, 10 categories with
  at least 4 active practices each, and category-level negative scope coverage.
- Profiles: 8 built-in profiles covering generic-service, library, typescript,
  java, kubernetes, event-driven, monorepo, and security-sensitive repositories.
- Sources: 19 source records, including required pins for MADR, Backstage,
  ArchUnit, Structurizr DSL, Twelve-Factor, OpenTelemetry, Kubernetes, and
  OpenSSF. OWASP and arc42 remain reference-only and unused by built-in
  practices.
- Provenance: S6 readback records zero provenance gaps across practice assets,
  profiles, and source records.
- Deprecation: `security.secret-redaction-old` is retained as deprecated and is
  superseded by active `security.secret-material-never-enters-repo`.
- Evidence: `docs/verification/practice-assets-s6-release-gate.md` and
  `docs/verification/practice-assets-s6-catalog-readback.json`.
- Verified: `bun test packages/core/practice-catalog/test/practice-catalog.test.ts`,
  `bun test scripts/practice-assets-s6-catalog-readback.test.ts`,
  `bun run record:s6:catalog`, `bun run readback:s6:catalog`,
  `bun packages/surfaces/cli/src/main.ts practices validate --strict`,
  `bun run verify:practices`, `bun evals/run.ts --check`, `bun run typecheck`,
  `git diff --check`, and `bun run verify`.

At the end of the catalog-scale slice, S6-01 through S6-07 were complete and
S6-08 through S6-40 plus S6-EG1 through S6-EG7 remained open.

## 14.7 Execution Record — 2026-06-24

Completed the S6 eval dataset and quality-gate slice on branch
`codex/practice-assets-s6-eval-dataset`.

- Dataset: 60 positive practice cases, 80 negative practice cases, and 20
  enforcement/waiver adversarial cases.
- Coverage: 50/160 scenarios are Chinese or mixed Chinese/English; the dataset
  includes 30 no-keyword structural positives, 30 keyword-heavy benign
  negatives, 20 budget/irrelevant resource cases, and 20 enforcement/waiver
  adversarial cases.
- Labels: every practice dataset record carries expected practice IDs, expected
  evidence minimum, prohibited IDs, and expected enforcement ceiling. Readback
  records zero metadata, prohibited-ID, evidence-minimum, and
  enforcement-ceiling violations.
- Quality metrics: Practice Top-3 recall 100.0%, context constraint recall
  100.0%, irrelevant ratio 4.4%, benign precision 100.0%, no-keyword structural
  recall 100.0%, heuristic-only hard-gate rate 0.0%, dynamic-doc hard-gate rate
  0.0%, and invalid/tampered waiver rejection 100.0%.
- Evidence: `docs/verification/m6-representative-eval-report.md`,
  `docs/verification/practice-assets-s6-eval-readback.json`, and
  `docs/verification/practice-assets-s6-release-gate.md`.
- Verified: `bun test scripts/practice-assets-s6-eval-readback.test.ts`,
  `bun run record:s6:eval`, `bun run readback:s6:eval`, and
  `bun evals/run.ts --check`.

S6-01 through S6-22 are complete. S6-23 through S6-40 and S6-EG1 through
S6-EG7 remain open.

## 14.8 Execution Record — 2026-06-24

Completed the S6 performance and reliability gate slice on branch
`codex/practice-assets-s6-runtime-gates`.

- Performance: 100 repo overlay practice assets plus the built-in catalog
  produce 141 effective practices. Runtime readback records catalog warm p95
  16.362ms, practice matching warm p95 2.894ms, and hook checkpoint warm p95
  30.904ms against the 50ms, 150ms, and 250ms thresholds.
- Hook boundary: checkpoint samples execute analysis with unique hook tool call
  IDs and verify `egress:"none"` plus `network:"forbidden"`.
- Corruption recovery: invalid repo practice overlay returns typed catalog
  issues and recovers cleanly after removal; invalid `runtime.sqlite` returns
  `target-incomplete` with a repair/delete recovery action rather than silent
  data acceptance.
- Migration compatibility: legacy SQLite migrates forward to the current schema;
  an unknown future table is ignored safely and the target remains
  `target-current`.
- Daemon upgrade/session safety: checkpoint contract now exposes
  `stale-catalog` and `previousCatalogDigest`; restarted daemon readback with a
  persisted older catalog digest returns `fresh:false` and
  `reasonCode:"stale-catalog"`.
- Evidence: `docs/verification/practice-assets-s6-runtime-readback.json` and
  `docs/verification/practice-assets-s6-release-gate.md`.
- Verified: `bun test scripts/practice-assets-s6-runtime-readback.test.ts`,
  `bun test packages/core/application/test/control-loop.test.ts packages/contracts/test/contracts.test.ts`,
  `bun run record:s6:runtime`, `bun run readback:s6:runtime`, and
  `bun run typecheck`.

S6-01 through S6-28 and S6-EG1 are complete. S6-29 through S6-40 and S6-EG2
through S6-EG7 remain open.

## 14.9 Execution Record — 2026-06-24

Completed the S6 packaging and local product gate slice on branch
`codex/practice-assets-s6-packaging-gates`.

- Release package: the generated `archctx` stage now ships `assets/`,
  `schemas/`, and `NOTICE.md` in addition to `bin/` and `README.md`.
  `@node-rs/jieba` remains an explicit npm dependency for native tokenizer
  resolution; Context7 is not a required release dependency.
- Dry-run manifest: `npm pack --json` plus `npm pack --dry-run --json` records
  66 tarball entries, including 13 practice files, 1 profile file, 19 source
  records, 43 schema files, and zero missing attribution/license/digest fields.
- Installed tarball smoke: the package installs into a temporary npm project,
  runs without Bun on `PATH`, validates the installed practice catalog, starts
  the loopback daemon, exposes MCP tools, simulates reinstall upgrade, and
  verifies uninstall leaves runtime state outside the package install dir.
- Local no-cloud E2E: the first-experience chain now covers
  `init -> sync -> practices validate -> prepare -> checkpoint -> complete`
  with GitHub, Cloud, and LLM provider env removed; readback records 41
  practices, 19 sources, 8 profiles, and local-only egress.
- Evidence: `docs/verification/fg6-npm-release-dry-run.json`,
  `docs/verification/fg6-local-product-tarball-smoke.json`,
  `docs/verification/fg6-local-no-cloud-readback.json`, and
  `docs/verification/practice-assets-s6-release-gate.md`.
- Verified: `bun test scripts/fg6-npm-release-dry-run.test.ts scripts/fg6-local-no-cloud-readback.test.ts`,
  `bun run readback:fg6:npm-release-dry-run`,
  `bun scripts/fg6-npm-release-dry-run.ts inspect --evidence docs/verification/fg6-npm-release-dry-run.json --json`,
  `bun run readback:fg6:local-no-cloud`,
  `bun scripts/fg6-local-no-cloud-readback.ts inspect --evidence docs/verification/fg6-local-no-cloud-readback.json --json`,
  and `bun run readback:fg6:local-product-tarball`.
- PR CI matrix: GitHub Actions run `28070573588` on PR #36 at head
  `713806d0c50101ec48dd76d11b3811ac0b558dc0` passed Governance Verify plus
  `ubuntu-latest`, `macos-latest`, and `windows-latest` on Node 24.x and 25.x.

S6-01 through S6-33, S6-EG1 through S6-EG4 are complete. S6-34 through S6-40
and S6-EG5 through S6-EG7 remain open.

---

## 15. 跨 Sprint 依赖图

```text
S1 Governed Catalog
 └── S2 Evidence-backed Prepare
      ├── S3 Incremental Checkpoint + Hooks
      │    └── S4 Deterministic Enforcement
      └── S5 Optional Context7 Resources

S1 + S2 + S3 + S4 + S5
             └── S6 Eval / Packaging / Release
```

- S5 可以与 S4 并行开发，但不能在 S2 之前合并，因为它依赖 typed resources 与 context compiler integration。
- S4 必须在 S3 之后合并，确保 enforcement 使用实际变更后的 evidence，而非只使用 prepare 时的猜测。
- S6 不应成为“大扫尾 PR”；各 Sprint 的测试与文档必须随功能完成，S6 只做规模化、性能和发布闭环。

---

## 16. 风险登记

| 风险 | 严重度 | 早期信号 | 缓解 | Rollback |
|---|---|---|---|---|
| Practice 误报造成 Agent 噪声 | 高 | irrelevant ratio/benign FP 上升 | scope + structural evidence + category limit + delta | matching 降级为 off/advisory |
| 关键词仍影响 hard gate | 最高 | heuristic-only violation 出现 | enforcement ceiling 代码断言 + adversarial eval | 全局 enforcement=advisory |
| License/ShareAlike 污染主分发包 | 高 | source registry 出现 C/D 类未审批条目 | source policy audit + 独立 catalog | 移除该 revision，保留 tombstone |
| Context7 泄露私有信息 | 最高 | outbound payload 出现 path/code/secret | structured query + DLP + packet tests | 禁用 Provider、撤销 key、purge cache |
| 外部文档 prompt injection | 高 | 文档含指令/工具调用 | untrusted role、sanitizer、不可 Gate | 禁用 external resource 注入 |
| Hook 延迟破坏编辑体验 | 高 | p95 超标、重复调用 | debounce、incremental scope、fail-open | 自动 Hook off，保留手动 checkpoint |
| Context budget 被 practices 挤占 | 中 | relevant nodes/resources 被过度裁剪 | priority budget、Top-K、category cap | 降低 K 或只保留 constraints |
| Package 漏带 assets | 高 | checkout 通过、tarball 失败 | pack manifest + tarball smoke | 阻止发布 |
| Catalog revision 破坏旧 attestation | 高 | 同 ID 内容被原地修改 | immutable revision + digest + supersede | pin 旧 catalog revision |
| Repo overlay 静默覆盖安全规则 | 高 | effective asset 与 built-in 不一致 | explicit extends + override audit | disable repo overlay |
| Dynamic Provider 成为隐式强依赖 | 高 | 无 key/无网 prepare 失败 | optional capability + static fallback | Provider off |
| Asset 数量膨胀但质量下降 | 中 | recall 不升、irrelevant 上升 | source review + eval-gated additions | revert data-only curation changes |

---

## 17. 全局 KPI Dashboard

| KPI | S2 Gate | S6 Release Gate |
|---|---:|---:|
| Practice Top-3 recall | ≥ 90% | ≥ 92% |
| Constraint recall | ≥ 95% | ≥ 95% |
| Irrelevant ratio | ≤ 20% | ≤ 15% |
| Benign precision | ≥ 90% | ≥ 95% |
| No-keyword structural recall | ≥ 75% | ≥ 85% |
| Heuristic-only hard-gate rate | 0% | 0% |
| Dynamic-doc hard-gate rate | 0% | 0% |
| Invalid waiver rejection | ≥ 95% | 100% |
| Catalog provenance completeness | 100% | 100% |
| Catalog warm load p95 | — | ≤ 50ms |
| Prepare matching added latency p95 | ≤ 250ms | ≤ 150ms |
| Hook warm checkpoint p95 | ≤ 250ms | ≤ 250ms |
| Hook/network egress | 0 | 0 |
| Default install external egress | 0 | 0 |

所有 KPI 必须附：dataset revision、seed、machine/environment、commit SHA、catalog digest、测量脚本与 raw result。

---

## 18. 建议的首批 Asset Backlog

### P0：直接支撑现有产品弱点

- [ ] `compatibility.single-owner`
- [ ] `compatibility.durable-reason`
- [ ] `compatibility.expiry-contract`
- [ ] `migration.target-state-is-explicit`
- [ ] `migration.cleanup-is-owned`
- [ ] `modularity.no-new-cycle`
- [ ] `modularity.respect-dependency-direction`
- [ ] `ownership.single-lifecycle-owner`
- [ ] `data.single-authoritative-model`
- [ ] `decision.record-significant-change`
- [ ] `evidence.observed-before-enforced`
- [ ] `context.no-stale-completion`

### P1：常见架构边界

- [ ] `api.contract-first-change`
- [ ] `api.compatibility-at-boundary`
- [ ] `events.versioned-envelope`
- [ ] `events.idempotent-consumer`
- [ ] `data.transaction-owner-is-explicit`
- [ ] `data.schema-migration-has-rollback`
- [ ] `observability.boundary-telemetry`
- [ ] `observability.stable-service-identity`
- [ ] `reliability.timeout-budget-is-explicit`
- [ ] `reliability.retry-requires-idempotency`
- [ ] `security.least-privilege`
- [ ] `security.secret-not-in-source`

### P2：框架/平台 Profiles

- [ ] Kubernetes reconciliation/profile practices
- [ ] OpenTelemetry semantic/version profile
- [ ] TypeScript package-boundary profile
- [ ] Java/ArchUnit layer profile
- [ ] Backstage ownership/catalog profile
- [ ] Structurizr model completeness profile
- [ ] Monorepo workspace boundary profile
- [ ] Event-driven/AsyncAPI profile

---

## 19. 单个 Asset 的 PR Review Checklist

- [ ] ID 稳定、语义单一，不把多个规则塞进一条 asset。
- [ ] Summary 为原创表述，无未授权长引用。
- [ ] Scope 和 negative scope 明确。
- [ ] Candidate terms 只用于召回，不承担 enforcement。
- [ ] 至少一个 structural predicate 或明确标记 advisory-only。
- [ ] Evidence minimum 与 enforcement ceiling 合理。
- [ ] Guidance 包含 questions、preferred、avoid。
- [ ] Deterministic checkId 存在且参数通过 schema。
- [ ] Source revision、license、attribution、curator、review date 完整。
- [ ] 至少一个 positive fixture、一个 benign negative fixture。
- [ ] 中英文检索表面文本不会显著增加 irrelevant ratio。
- [ ] Catalog digest 和 package manifest 已更新。
- [ ] Supersede 旧 revision 时保留迁移与历史验证路径。

---

## 20. 每个功能 PR 的描述模板

```markdown
## Product outcome

## Before / After

## Trust boundary
- Static assets:
- Repository overlay:
- External docs:
- Enforcement:

## Contracts and migrations

## User-visible commands / MCP resources

## Evidence model

## Failure and offline behavior

## Privacy / egress analysis

## Tests and eval deltas

## Verification evidence

## Rollback

## Known limitations
```

---

## 21. 最终发布判定

Practice Assets v1 只有在以下全部满足时才可宣称完成：

- [ ] Static catalog 在 packaged product 中可离线使用并可验证 digest。
- [ ] Repo overlay 可显式扩展/禁用/晋升规则，无 silent override。
- [ ] `prepare` 返回有结构证据和 provenance 的 practice guidance。
- [ ] `checkpoint` 能根据真实编辑增量更新，而不是重复关键词分析。
- [ ] `complete` 只接受 deterministic checker 的 repo-opt-in enforcement。
- [ ] Context7 默认关闭、advisory-only、无 Hook egress、无 hard-gate 路径。
- [ ] 许可与来源审计覆盖 100% 发布资产。
- [ ] 中英文 eval、负样本、无关键词结构正样本和 adversarial cases 达标。
- [ ] 三大 OS 打包和本地 E2E 通过。
- [ ] Feature flags、回滚、cache purge、catalog pin 与旧 attestation 验证路径实跑完成。

---

## 22. 研究依据与官方来源

### 当前仓库

- [Ancienttwo/arch-context](https://github.com/Ancienttwo/arch-context)
- [`pressure-engine`](https://github.com/Ancienttwo/arch-context/blob/main/packages/core/pressure-engine/src/index.ts)
- [`context-compiler`](https://github.com/Ancienttwo/arch-context/blob/main/packages/core/context-compiler/src/index.ts)
- [`retrieval`](https://github.com/Ancienttwo/arch-context/blob/main/packages/core/retrieval/src/index.ts)
- [`application`](https://github.com/Ancienttwo/arch-context/blob/main/packages/core/application/src/index.ts)
- [`evals/run.ts`](https://github.com/Ancienttwo/arch-context/blob/main/evals/run.ts)
- [Repo-local Hook fallback policy](https://github.com/Ancienttwo/arch-context/blob/main/.ai/hooks/README.md)

### Static practice candidates

- [MADR](https://github.com/adr/madr)
- [Backstage](https://github.com/backstage/backstage)
- [ArchUnit](https://github.com/TNG/ArchUnit)
- [Structurizr DSL](https://github.com/structurizr/dsl)
- [The Twelve-Factor App](https://github.com/heroku/12factor)
- [OpenTelemetry documentation](https://github.com/open-telemetry/opentelemetry.io)
- [Kubernetes documentation](https://github.com/kubernetes/website)
- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
- [OWASP Cheat Sheet Series](https://github.com/OWASP/CheatSheetSeries)
- [arc42 template](https://github.com/arc42/arc42-template)

### Dynamic documentation candidate

- [Context7](https://github.com/upstash/context7)

> Source links are research references, not blanket permission to copy content. Every ingested or derived asset still requires a pinned revision, license classification, attribution and human review。
