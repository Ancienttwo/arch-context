# Sprint 2: ArchContext — Multi-repo & Trusted Attestation

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
> **Slug**: archctx-s2
> **Created**: 2026-06-19
> **Updated**: 2026-06-20
> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`
> **Source Spec**: `docs/spec.md`
> **Prior Sprint**: `plans/sprints/archctx-sprint.md`（MVP scaffold 已验收；生产 Launch Gate 仍有 proxy 验证待补）
> **Goal Mode**: incremental

把个人 MVP 扩展到**多仓上下文**与**组织可信 Review**，并加**年付**。计费保持按人头（$5/月、$99/年），**不做复杂的 Team/Enterprise 治理**——组织内每位开发者自有 seat。每行是可跟踪最小单元，带稳定 ID（如 `TR-05`）；状态列 ◻ 未开始 / ◐ 进行中 / ☑ 完成。验证命令以 **Bun** 为准（与 MVP 实现一致）。

## Sprint 目标与边界

- **目标**：① 跨仓库架构上下文（teams 有多个 repo）；② 组织受控 Trusted Runner 产出 `organization-attested` Review，修复 MVP 仅 `developer-attested`（无法证明 runtime 未被篡改）的信任缺口；③ 年付 $99 + 多仓权益，计费仍按人头。
- **明确不做（防范围蔓延）**：Team/Enterprise 治理平台、SSO/SCIM、org 统一账单/seat-pool、集中策略分发、审计导出；以及 Sprint 3 的生态项（LikeC4/Structurizr Adapter、Slack/Webhook/Email、浏览器 Explorer、ChatGPT App GA/Directory）。
- **不变量延续**：MVP 七条 Guardrails 全部保持；单仓行为不得回归；Sprint 1 中被标注为 proxy 的 launch 验证不得在 Sprint 2 中继承为生产已绿。

## Architecture Notes

- **新增/扩展包**：`architecture-domain`（跨仓节点/关系）· `runtime-daemon`（多 Session 编排）· `context-compiler`（跨仓上下文）· `codegraph-adapter`（多仓索引聚合）· `local-store-sqlite`（跨仓边/landscape 表）· `attestation`（trustLevel）· `github-app`（org runner 绑定）· `control-plane` / `cloud-db`（年付、org runner identity）· 新增 `runner`（受控执行 + 签名）· `cli`（repo/landscape 命令）。
- **依赖顺序**：CD 契约增量 → MR 多仓上下文 →（并行）TR 可信 Runner、BL 年付计费 → HL 加固与发布。TR 依赖 MVP Attestation（Sprint 1 M5）与 CD trustLevel；MR 依赖 MVP Runtime（Sprint 1 M1–M2）。
- **Risks**：跨仓索引开销（scope 控制 + LRU + 增量）；Trusted Runner 信任被夸大（明确"组织受控≠零信任"，文案约束）；多仓引入 SaaS 代码出域风险（路由/抓包回归）；年付 proration 边界（Stripe 端处理 + 幂等）。

## Guardrails（延续 MVP §1.3 + Sprint 2 新增）

1–7. 延续 MVP 七条（SaaS 不收代码/Diff/模型正文；写入必经 ChangeSet+Schema+Policy+原子；兼容层持证；Target/Migration 分离；高压力低信心 Proof Required；渐进式治理；结果绑定 Repo/HEAD/Worktree Digest）。
8. **跨仓内容仍全本地**；SaaS 跨仓只得 numeric repo/installation ID。
9. **Trusted Runner 由客户控制**，代码不进 ArchContext SaaS；runner 也只上传签名 + digest；`organization-attested` 不得宣传为绝对不可篡改。
10. **v1 计费仍按人头**（$5/月、$99/年）；不引入 team/enterprise 计费层、seat-pool 或 org 统一账单；组织内每人自有 seat。
11. **单仓（Sprint 1）行为不得回归**。
12. **协作 = Git + worktree，不自建**：同步、历史、分支、冲突、并行全部交给 Git；ArchContext 不做协作或同步服务。MR 只做跨仓代码情报；`landscape` 仅为 Git 跟踪文件 + 本地索引，绝不引入同步层。

## ADR Delta（Sprint 2）

| ADR | 标题 | 关系 | 状态 |
|---|---|---|:--:|
| ADR-0024 | Developer vs Organization Attestation | 实现组织侧（MVP 仅定义 + developer 侧） | ☑ |
| ADR-0023 | User-level Private Entitlement | 扩展：增加年付，保持按人头 | ☑ |
| ADR-0016 | Signed Local Attestation | 扩展：trustLevel + org runner key | ☑ |
| ADR-0003 | Local-first Trust Boundary | 延伸到跨仓与 runner（仍零代码出域） | ☑ |
| **ADR-0026** | Multi-repo Architecture Context（新） | 仓库仍 per-repo SoT，跨仓图为派生 | ☑ |
| **ADR-0027** | Trusted Runner Attestation（新） | 组织受控 runner 签名；信任级高于 developer；绑定 GitHub Installation；不含 team 计费 | ☑ |
| **ADR-0028** | Per-seat Billing v1（新） | 仍按人头 $5/月、$99/年；不做 team/enterprise 计费层 | ☑ |

## 进度总览

| 里程碑 | 范围 | 任务 | Exit Gate | 证据状态 |
|---|---|--:|--:|--:|
| CD | 契约增量 + 新 ADR | 11 | 4 | 14 deterministic / 15 tracked（CD-EG3 approval handoff exists; human completion pending） |
| MR | 多仓架构上下文 | 16 | 5 | 20 deterministic / 21 tracked（MR-EG5 production capture pending/proxy） |
| TR | 可信 Runner / 组织 Attestation | 12 | 5 | 16 deterministic / 17 tracked（TR-EG4 proxy） |
| BL | 按人头计费 v2（年付） | 9 | 5 | 14 deterministic / 14 tracked |
| HL | v1 加固与发布 | 8 | 6 | 12 deterministic / 14 tracked（HL-EG1/5 production/proxy pending） |
| **合计** | | **56** | **25** | **76 deterministic / 81 tracked** |

> Sprint 2 代码与本地确定性验证已交付；上表不再把 production capture、安全扫描、Eval、人类签批、真实 rebuild 证明计为全绿。`bun run verify` 证明 repo-local deterministic surface，不证明 production launch readiness。
> External/governance readback bundle: `docs/verification/s2-external-evidence-readback.md`; acquisition handoff: `docs/verification/s2-external-evidence-handoff.md`.

## Backlog（里程碑 waypoint 索引）

| # | Status | Task | Mode | Acceptance | Plan |
|---|--------|------|------|------------|------|
| 1 | [x] | archctx-s2-cd-contracts-delta | contract | 跨仓/landscape/trustLevel/年付 Schema + ADR-0026/27/28；CD deterministic gates 通过，Human Gate 归档待补 | schemas + contracts fixtures + ADR-0026/27/28 |
| 2 | [x] | archctx-s2-mr-multirepo | contract | Landscape + 多 Session + 跨仓 context/impact/drift/review；MR deterministic gates 通过，production capture 待补 | architecture-domain + codegraph-adapter + context-compiler + runtime/cli |
| 3 | [x] | archctx-s2-tr-trusted-runner | contract | trustLevel + org runner 签名 + SaaS 验证 + Check 展示；TR deterministic gates 通过，production capture 待补 | attestation + runner + github-app + control-plane |
| 4 | [x] | archctx-s2-bl-billing-v2 | contract | 年付 $99 + 月↔年切换 + 多仓权益 + 按人头；BL Exit Gate 全绿 | control-plane + cloud-db + control-plane-client |
| 5 | [x] | archctx-s2-hl-hardening-launch | contract | 跨仓/runner/计费回归 + 隐私审计 + 迁移；HL deterministic gates 通过，representative Eval 通过，production capture/scan 待补 | hardening + threat model + schema upgrade guide + full verify |

---

# 里程碑开发清单

列含义：**St** 状态 · **Owner** 归属包 · **Est** 预估（团队填）· **Deps** 前置任务 ID。

## CD · 契约增量与新 ADR

**目标**：先冻结多仓/可信 Runner/年付引入的 Schema 与决策，避免下游分叉。
**关联 ADR**：0026、0027、0028（并扩展 0023、0024、0016）。 **前置**：MVP M0 契约。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| CD-01 | ☑ | 新增 `CrossRepoRelation` Schema（source/target 带 repo 命名空间，via interface/event） | contracts |  | — |
| CD-02 | ☑ | 新增 `Landscape` Schema（多仓注册：repos、跨仓边、所有权） | contracts |  | — |
| CD-03 | ☑ | 扩展 Node/Relation ID 规则支持 repo 命名空间（跨仓稳定 ID） | contracts |  | CD-01 |
| CD-04 | ☑ | 扩展 `Attestation`：`trustLevel = developer \| organization` | contracts |  | — |
| CD-05 | ☑ | 新增 `OrgRunnerIdentity` Schema（GitHub Installation 绑定的 runner 公钥/标识） | contracts |  | CD-04 |
| CD-06 | ☑ | 扩展 `Entitlement`：`plan = monthly \| annual` / `billingInterval`；不加 team/seat-pool 字段 | contracts |  | — |
| CD-07 | ☑ | 定义 trustLevel 语义与 Check 展示映射 | contracts |  | CD-04 |
| CD-08 | ☑ | 撰写 ADR-0026 Multi-repo Architecture Context | docs/adr |  | CD-01,02 |
| CD-09 | ☑ | 撰写 ADR-0027 Trusted Runner Attestation | docs/adr |  | CD-04,05 |
| CD-10 | ☑ | 撰写 ADR-0028 Per-seat Billing v1（$5/月、$99/年；无 team 计费） | docs/adr |  | CD-06 |
| CD-11 | ☑ | Schema Version/Migration：单仓 v1 → 多仓平滑升级（向后兼容） | contracts |  | CD-01..06 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| CD-EG1 | ☑ | 新/扩展 Schema 正反边界 fixture 全绿 | `bun test packages/contracts` |
| CD-EG2 | ☑ | 旧单仓模型在新 Schema 下无损读取 | 向后兼容 round-trip 测试 |
| CD-EG3 | ◐ | ADR-0026/0027/0028 记录；Human Gate 批准记录待归档 | strict governance readback in `docs/verification/s2-governance-approval-readback.md`; approval handoff exists, human completion pending |
| CD-EG4 | ☑ | contracts 包仍不依赖 cli/mcp/db/cloud | 依赖断言无越界 |

## MR · 多仓架构上下文

**目标**：跨仓库的上下文、影响与 Review，仓库仍各自为 SoT。
**边界**：协作/同步/并行交给 Git + worktree；本里程碑只做跨仓代码情报，不建任何协作或同步服务（`landscape` 仅 Git 文件 + 本地索引）。
**关联 ADR**：0026、0008、0014、0003。 **前置**：CD 全绿；MVP M1–M2。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| MR-01 | ☑ | Landscape 注册（`.archcontext/landscape.yaml` 或用户级注册） | architecture-domain |  | CD-02 |
| MR-02 | ☑ | archctxd 多 Repo Session 编排（多 handle + LRU） | runtime-daemon |  | MR-01 |
| MR-03 | ☑ | 跨仓 CodeGraph 编排（per-repo index，聚合查询） | codegraph-adapter |  | MR-02 |
| MR-04 | ☑ | 跨仓节点/关系解析（repo 命名空间稳定 ID） | architecture-domain |  | CD-03 |
| MR-05 | ☑ | 跨仓 Relation Loader 与 Validation | architecture-domain |  | CD-01 |
| MR-06 | ☑ | 跨仓 Observed Evidence 映射（repo→symbol） | codegraph-adapter |  | MR-03 |
| MR-07 | ☑ | 跨仓 Declared/Observed/Verified 对齐 | reconcile-engine |  | MR-05,06 |
| MR-08 | ☑ | 跨仓 `prepare_task`（跨多 repo 组上下文，带预算） | context-compiler |  | MR-03,04 |
| MR-09 | ☑ | 跨仓 Impact（repo A 接口变 → repo B 受影响） | architecture-domain |  | MR-06 |
| MR-10 | ☑ | 跨仓 Drift / Review | review-engine |  | MR-07 |
| MR-11 | ☑ | 跨仓 Pressure 信号（跨仓环依赖、跨仓双轨） | pressure-engine |  | MR-09 |
| MR-12 | ☑ | Local store schema：cross-repo edges / landscape 表 + 索引 | local-store-sqlite |  | CD-02 |
| MR-13 | ☑ | CLI：`archctx repo add/list/remove`、`archctx landscape`、`archctx context --landscape` | cli |  | MR-01,08 |
| MR-14 | ☑ | Scope 控制（默认只激活相关 repo，避免全量索引） | runtime-daemon |  | MR-02 |
| MR-15 | ☑ | 隐私：跨仓内容仍全本地；SaaS 仅得 numeric repo IDs | architecture-domain |  | — |
| MR-16 | ☑ | 重建：删本地库后从各 repo Git + CodeGraph 重建跨仓图 | local-store-sqlite |  | MR-12 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| MR-EG1 | ☑ | 跨仓 Impact/Context 正确 | fixture landscape e2e |
| MR-EG2 | ☑ | per-repo 仍各自 SoT（单仓不回归） | 单仓回归测试全过 |
| MR-EG3 | ☑ | 删本地库可重建跨仓图 | `docs/verification/s2-multirepo-rebuild.md` |
| MR-EG4 | ☑ | 大 landscape 性能在预算内 | scope 生效 + 计时基准 |
| MR-EG5 | ◐ | 跨仓抓包无代码/路径进 SaaS | fixture 路由审计 + 抓包；strict external readback in `docs/verification/s2-production-capture-readback.md`; production capture pending |

## TR · 可信 Runner 与组织 Attestation

**目标**：组织受控 Runner 产出 `organization-attested` Review，信任级高于 developer-attested；不引入 team 计费/治理台。
**关联 ADR**：0024、0027、0016、0003。 **前置**：CD（trustLevel）；MVP M5（Attestation/GitHub App）。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| TR-01 | ☑ | trustLevel 模型落地：developer vs organization（实现 ADR-0024 组织侧） | attestation |  | CD-04 |
| TR-02 | ☑ | Org Runner 身份与签名密钥注册（绑定 GitHub Installation） | control-plane |  | CD-05 |
| TR-03 | ☑ | Runtime Runner 模式（CI/受控环境跑 `archctx review`，非开发者机器） | runner |  | — |
| TR-04 | ☑ | Runner 在受控环境执行 Review 并用 org key 签名 | runner |  | TR-02,03 |
| TR-05 | ☑ | SaaS Attestation Verifier 接受 org-runner attestation（验 org key/installation/SHA/nonce） | attestation |  | TR-02,04 |
| TR-06 | ☑ | Check Run 显示信任级（Organization-attested / Developer-attested） | github-app |  | TR-01,05 |
| TR-07 | ☑ | per-installation 开关：受保护 repo 可要求 organization-attested（最小化，不做治理台） | github-app |  | TR-05 |
| TR-08 | ☑ | Org key 轮换与撤销 | control-plane |  | TR-02 |
| TR-09 | ☑ | Device Integrity 信号（best-effort，诚实标注局限） | attestation |  | TR-01 |
| TR-10 | ☑ | Runner 设置文档（GitHub Actions self-hosted / 客户 CI） | docs |  | TR-04 |
| TR-11 | ☑ | Threat model 更新：runner 抗篡改 vs 开发者机器（组织受控≠零信任） | cross/security |  | TR-04 |
| TR-12 | ☑ | 隐私：runner 客户控制，只上传签名 + digest，代码不进 SaaS | runner |  | TR-04 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| TR-EG1 | ☑ | org-attested 以更高信任级通过；developer-attested 仍可用 | 双路径 e2e |
| TR-EG2 | ☑ | org key 撤销后旧 attestation 失效 | 撤销测试 |
| TR-EG3 | ☑ | replay/伪造/错 SHA/错 installation 全拒 | 负向测试套件 |
| TR-EG4 | ◐ | runner 不向 ArchContext SaaS 上传代码/Finding | fixture 抓包 + 路由审计；strict external readback in `docs/verification/s2-production-capture-readback.md`; production capture pending |
| TR-EG5 | ☑ | 文案不把 organization-attested 夸大为绝对不可篡改 | 文案走查 |

## BL · 按人头计费 v2（年付）

**目标**：加年付 $99，月↔年可切换，权益覆盖该用户全部私有仓（含多仓/多 org）；保持按人头，不做 team 计费。
**关联 ADR**：0028、0023。 **前置**：MVP M5（Stripe/Entitlement）；CD-06。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| BL-01 | ☑ | Stripe 年付价 $99/user/year | control-plane |  | — |
| BL-02 | ☑ | 保留月付 $5/user/month | control-plane |  | — |
| BL-03 | ☑ | 月↔年套餐切换（Stripe proration） | control-plane |  | BL-01,02 |
| BL-04 | ☑ | Entitlement 增加 billingInterval，覆盖用户全部私有仓（含多仓/多 org） | control-plane |  | CD-06 |
| BL-05 | ☑ | 组织私有仓每位开发者需自有 seat（重申 §7.3）；不做 org 统一计费/seat-pool | control-plane |  | BL-04 |
| BL-06 | ☑ | 年付续费、proration、取消与退款规则 | control-plane |  | BL-01 |
| BL-07 | ☑ | Dashboard：显示月/年、$5/$99、切换、续费日 | control-plane |  | BL-03 |
| BL-08 | ☑ | Stripe 年付生命周期 webhook（幂等/重放保护） | control-plane |  | BL-01 |
| BL-09 | ☑ | 离线 Entitlement 对年付有效期处理 | control-plane-client |  | BL-04 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| BL-EG1 | ☑ | 年付 $99 可购买并签发 Entitlement | 购买 e2e |
| BL-EG2 | ☑ | 月↔年切换计费正确（proration） | 切换 e2e |
| BL-EG3 | ☑ | 组织内每人单独 seat；无 team-billing 路径 | 路由/契约断言 |
| BL-EG4 | ☑ | 取消/退款按规则；公开能力不受影响 | e2e |
| BL-EG5 | ☑ | 跨多私有仓单 seat 无新增计费 | e2e |

## HL · v1 加固与发布

**目标**：跨仓 + runner + 计费回归与发布门禁。
**关联 ADR**：0003（隐私验证扩展）及全部不变量回归。 **前置**：MR/TR/BL 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| HL-01 | ☑ | 跨仓大规模性能与 scope 回归 | runtime-daemon |  | MR-14 |
| HL-02 | ☑ | Trusted Runner 安全/渗透复审 | cross/security |  | TR-11 |
| HL-03 | ☑ | 多仓 + runner 文档与示例 landscape | docs |  | MR-13,TR-10 |
| HL-04 | ☑ | 隐私审计扩展到多仓 + runner（无代码出域） | cross/security |  | MR-15,TR-12 |
| HL-05 | ☑ | 单仓→多仓平滑迁移（非破坏）；旧用户零改动可用 | architecture-domain |  | CD-11 |
| HL-06 | ☑ | MVP 不变量回归（Sprint 1 全部 Guardrails 仍成立） | cross |  | — |
| HL-07 | ☑ | 计费 v2 回归（月/年/取消/多仓） | control-plane |  | BL-* |
| HL-08 | ☑ | v1 发布说明与 Schema 升级指南 | docs |  | CD-11 |

**Launch Gate（任一未满足禁止宣称 v1 可用）**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| HL-EG1 | ◐ | 跨仓代码不进 SaaS repo-local 验证完成；生产验证待补 | fixture 抓包 + 路由审计；strict external readback in `docs/verification/s2-production-capture-readback.md`; production capture pending |
| HL-EG2 | ☑ | organization-attested 信任级端到端正确 | trust-level e2e |
| HL-EG3 | ☑ | 年付计费端到端正确，无 team-billing 残留 | billing e2e + 契约扫描 |
| HL-EG4 | ☑ | 单仓用户无回归（MVP 行为保持） | Sprint 1 回归套件全过 |
| HL-EG5 | ◐ | deterministic surface Critical/High 安全 Finding 为零；production scan 待补 | deterministic security review；strict production scan readback in `docs/verification/s2-production-security-scan-readback.md`; production scan pending |
| HL-EG6 | ☑ | 关键 Eval（跨仓 impact、trust-level、annual entitlement）有代表性覆盖 | `docs/verification/s2-representative-eval.md` |

---

## Post-Sprint-2（延后到 Sprint 3，防范围蔓延）

LikeC4 / Structurizr 导入导出 Adapter · Slack/Webhook/Email Notification Provider · 浏览器 Architecture Explorer · ChatGPT App GA + GPT App Directory（v1.1 完整发布）· Team/Enterprise 治理（SSO/SCIM/集中策略/org 统一账单）· Embedding/Vector（默认关闭，需 Eval）。

## Execution Log

Keep this section last; `.ai/harness/scripts/sprint-backlog.sh complete-task` appends rows here。逐条完成时同步更新行状态、「进度总览」完成数与「ADR Delta」状态。

| When | Task | Plan | Result |
|------|------|------|--------|
| 2026-06-19 | CD contracts delta | Add schema/fixtures for cross-repo relation, landscape, org runner identity, entitlement; extend ID and attestation trustLevel; add ADR-0026/27/28. | Repo-local implementation completed; `bun test packages/contracts` covered new and old fixtures. Strict governance approval readback added in `docs/verification/s2-governance-approval-readback.md`; approval handoff added in `docs/approvals/archctx-sprint-2.md`, human completion pending. |
| 2026-06-19 | MR multi-repo context | Implement landscape domain, repo-scoped IDs, multi-repo CodeGraph aggregation, bounded landscape context, local derived store, CLI repo/landscape commands, cross-repo reconcile/review/pressure. | Repo-local implementation completed; covered by architecture-domain/codegraph-adapter/context-compiler/runtime-daemon/cli/reconcile/review/pressure tests. Delete-local-store rebuild proof added in `docs/verification/s2-multirepo-rebuild.md`; production capture pending. |
| 2026-06-19 | TR trusted runner | Implement organization trustLevel, org runner identity binding, runner package signing, SaaS verifier path, Check Run display and protected repo requirement, docs and threat model. | Repo-local implementation completed; covered by attestation/runner/control-plane/github-app tests. Production runner capture pending. |
| 2026-06-19 | BL billing v2 | Add monthly/annual prices, billingInterval entitlement, Stripe event interval handling, switch proration, offline annual entitlement, D1 metadata. | Completed; covered by control-plane/control-plane-client/cloud-db tests. |
| 2026-06-19 | HL hardening launch | Add Sprint 2 hardening report, schema upgrade notes, runner setup, multi-repo example, privacy route audit and full regression. | Repo-local deterministic verification completed: `bun test`, `node scripts/privacy-route-audit.mjs`, `node scripts/sprint-status-check.mjs`. Representative Eval added in `docs/verification/s2-representative-eval.md`; strict external capture readback added in `docs/verification/s2-production-capture-readback.md`; strict production security scan readback added in `docs/verification/s2-production-security-scan-readback.md`; production capture and production scan pending. |
| 2026-06-20 | Sprint 2 external evidence bundle | Aggregate the remaining governance, packet capture, and security scan evidence gates into one readback command. | Added `docs/verification/s2-external-evidence-readback.md` and `bun run readback:s2:external`; current result remains blocked until human approval, external packet capture, and external security scan are recorded. |
| 2026-06-20 | Sprint 2 external evidence handoff | Turn the remaining external evidence blockers into a bounded acquisition packet without recording placeholder evidence. | Added `docs/verification/s2-external-evidence-handoff.md` and `bun run handoff:s2:external`; current result remains blocked until the external artifacts pass strict readback. |
| 2026-06-20 | Sprint 2 external evidence recorder | Add a single external evidence recorder for human-approved capture and scan artifacts. | Added `node scripts/sprint2-external-evidence-record.mjs record`; it preflights governance/capture/scan evidence, records the capture and scan manifests, and immediately runs strict Sprint 2 readback. Current repo state remains blocked because the real approval/capture/scan artifacts are not yet present. |
