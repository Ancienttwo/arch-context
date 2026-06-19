# Sprint 4: ArchContext — Local Explorer & Semantic Retrieval

> **Status**: Done
> **Slug**: archctx-s4
> **Created**: 2026-06-20
> **Updated**: 2026-06-20
> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`
> **Source Spec**: `docs/spec.md`
> **Prior Sprints**: `archctx-sprint.md`（MVP）· `archctx-sprint-2.md`（多仓/可信 Runner/年付）· `archctx-sprint-3.md`（生态/GA，repo-local Complete；production GA external readback pending）
> **Goal Mode**: incremental
> **Completion Scope**: repo-local deterministic；production GA / external readback debt remains pending

做掉两个延后面：**本地浏览器 Architecture Explorer** 与 **语义检索（Embedding，eval-gated）**。Explorer 是本地 loopback、只读、零出域；Embedding 默认关、必须先过 eval 才落地。每行可跟踪，带稳定 ID（如 `BX-08`）；状态列 ◻ / ◐ / ☑。验证命令以 **Bun** 为准。

## Sprint 目标与边界

- **目标**：① 本地只读 Architecture Explorer（交互式浏览节点/关系/Declared-Observed-Verified/压力/Intervention/多仓 landscape），不写模型、不出域；② 语义检索 eval：建 eval harness，跑 FTS5 baseline vs Embedding，**按判据决定是否落地** Embedding（默认 off）。
- **明确不做**：不关闭 S1–S3 的**生产 GA / 外部 readback 债**（托管 CI 矩阵、真实 benchmark、外部安全审计、GPT Directory 真实上架、生产抓包等仍 pending，留待专门的"生产就绪"sprint）；不自研可视化编辑器（Explorer 只读，写仍走 ChangeSet）；不无条件实现 Embedding（不胜出就保持 off）；Team/Enterprise 治理继续排除；协作仍交给 Git。
- **不变量延续**：S1–S3 全部 Guardrails 保持；单仓/多仓行为不得回归；**本 sprint 完成 = repo-local；不得把 S1–S3 的 proxy/外部验证继承为生产已绿**。

## Architecture Notes

- **新增/扩展包**：新增 `explorer-ui`（本地只读浏览面）· 新增 `retrieval`（FTS5/Embedding 检索 port + eval harness）· `runtime-daemon`（loopback Explorer 服务）· `local-store-sqlite`（embedding 索引，条件）· `cli`（`explore` 命令）· `contracts`（Explorer 投影 / Embedding / eval 契约）。
- **依赖顺序**：CD4 契约增量 →（并行）BX Explorer、EM 语义检索 eval → HL4 加固与发布。EM 内部有**决策门**：eval 未胜出则跳过实现任务、记录保持 off。
- **Risks**：Explorer 本地服务的端口暴露面（仅 loopback + 短期 token + 默认关）；Embedding 引入复杂度但可能不胜出（先 eval 后决定，避免沉没成本）；新面让人误以为生产已就绪（HL4 显式声明仍 repo-local、生产 GA 仍 blocked）。

## Guardrails（延续 S1–S3 + Sprint 4 新增）

1–15. 延续 S1–S3 全部（零出域；写入必经 ChangeSet；兼容层持证；Target/Migration 分离；Proof Required；渐进治理；结果绑定 Digest；跨仓全本地；Runner 客户控制；按人头计费；单仓不回归；协作=Git；通知载荷最小化；Adapter Native-SoT；ChatGPT GA 隐私不变量）。
16. **Explorer 仅本地 loopback、只读、opt-in、默认关**：仅绑 `127.0.0.1` + 短期 token；不连 SaaS、不发代码；**浏览器不能写模型**（所有写仍走 ChangeSet/CLI/MCP）；撤销/停止后立即不可达。
17. **Embedding eval-gated**：默认 off；只有在代表性 eval 上**明确胜过 FTS5 baseline**才落地；向量索引全本地、不出域；未胜出则记录"保持 off"。
18. **本 sprint 不关生产 GA 债**：S1–S3 的 production/external readback 仍 pending，本 sprint 完成度仅限 repo-local + 确定性本地验证，不得对外宣称生产 GA。

## ADR Delta（Sprint 4）

| ADR | 标题 | 关系 | 状态 |
|---|---|---|:--:|
| ADR-0003 | Local-first Trust Boundary | 延伸到 Explorer（loopback 只读）与 Embedding（本地向量） | ☑ |
| ADR-0013 | Progressive Architecture | Embedding 仅在需要且胜出时才引入 | ☑ |
| ADR-0014 | Context Compiler with Budget | 语义检索（若启用）服务于任务上下文召回 | ☑ |
| **ADR-0032** | Browser Architecture Explorer（新） | 本地 loopback、只读、零出域、不写模型 | ☑ |
| **ADR-0033** | Semantic Retrieval / Embeddings（新） | eval-gated、默认 off、本地、经 retrieval port | ☑ |

## 进度总览

| 里程碑 | 范围 | 任务 | Exit Gate | 完成 |
|---|---|--:|--:|--:|
| CD4 | 契约增量 + 新 ADR | 7 | 4 | 11 / 11 |
| BX | 本地 Architecture Explorer | 14 | 6 | 20 / 20 |
| EM | 语义检索（eval-gated） | 11 | 5 | 16 / 16 |
| HL4 | 加固与发布（本 sprint 面） | 7 | 6 | 13 / 13 |
| **合计** | | **39** | **21** | **60 / 60** |

## Backlog（里程碑 waypoint 索引）

| # | Status | Task | Mode | Acceptance | Plan |
|---|--------|------|------|------------|------|
| 1 | [x] | archctx-s4-cd-contracts-delta | contract | Explorer 投影 / Embedding / eval 契约 + ADR-0032/33；CD4 Exit Gate 全绿 | Completed: schema/fixtures/ports + ADR-0032/0033 + approval record |
| 2 | [x] | archctx-s4-bx-explorer | contract | 本地 loopback 只读 Explorer + 多仓 landscape，零出域、不写模型；BX Exit Gate 全绿 | Completed: runtime loopback service + explorer-ui + CLI surface |
| 3 | [x] | archctx-s4-em-retrieval-eval | contract | eval harness + FTS5 baseline + Embedding 对比 + 决策门（胜出才落地）；EM Exit Gate 全绿 | Completed: eval decision = keep FTS5 / embedding off |
| 4 | [x] | archctx-s4-hl-hardening | contract | Explorer/Embedding 隐私回归 + S1–S3 回归 + 明确生产 GA 仍 blocked；HL4 Gate 全绿 | Completed: repo-local hardening and release gate |

---

# 里程碑开发清单

列含义：**St** 状态 · **Owner** 归属包 · **Est** 预估（团队填）· **Deps** 前置任务 ID。条件任务以「（条件）」标注，仅在 EM 决策门胜出后执行。

## CD4 · 契约增量与新 ADR

**目标**：先冻结 Explorer 只读投影、Embedding/eval 契约与决策门，避免下游分叉。
**关联 ADR**：0032、0033（并扩展 0003、0013、0014）。 **前置**：S3 全绿。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| CD4-01 | ☑ | Explorer 只读投影 API 契约（nodes/relations/landscape/verification/pressure/intervention 只读视图） | contracts |  | — |
| CD4-02 | ☑ | Explorer 本地服务契约（loopback-only、只读、opt-in、短期 token；复用 MVP local HTTP 模式） | contracts |  | CD4-01 |
| CD4-03 | ☑ | Embedding 索引/配置 Schema（默认 off；本地；provider 可插拔） | contracts |  | — |
| CD4-04 | ☑ | Retrieval 评测契约（eval set 格式 + 指标：context-recall/constraint-recall/无关比例/tool-call） | contracts |  | — |
| CD4-05 | ☑ | 定义 Embedding 决策门判据（FTS5 baseline vs Embedding 的明确胜出阈值） | contracts |  | CD4-04 |
| CD4-06 | ☑ | 撰写 ADR-0032 Browser Architecture Explorer（本地只读、loopback、零出域、不写模型） | docs/adr |  | CD4-01,02 |
| CD4-07 | ☑ | 撰写 ADR-0033 Semantic Retrieval / Embeddings（eval-gated、默认 off、本地、经 retrieval port） | docs/adr |  | CD4-03,05 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| CD4-EG1 | ☑ | 新契约正反边界 fixture 全绿 | `bun test packages/contracts/test/contracts.test.ts` |
| CD4-EG2 | ☑ | Explorer 投影 schema 断言只读、无写字段、无 SaaS 出域字段 | schema 白名单测试 |
| CD4-EG3 | ☑ | Embedding 决策门判据可机检（明确阈值） | 判据单测 |
| CD4-EG4 | ☑ | ADR-0032/0033 记录并 Human Gate 批准 | `docs/approvals/archctx-sprint-4-cd4.md` |

## BX · 本地 Architecture Explorer

**目标**：本地只读交互式浏览架构；写仍走 ChangeSet；零出域。
**关联 ADR**：0032、0003。 **前置**：CD4-01/02；MVP 本地 HTTP 模式（M4）；S2 多仓。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| BX-01 | ☑ | archctxd 本地 loopback HTTP Explorer 服务（仅 127.0.0.1、opt-in、默认关、短期 token） | runtime-daemon |  | CD4-02 |
| BX-02 | ☑ | 只读投影 API 实现（复用 Core，绝不暴露写操作） | runtime-daemon |  | CD4-01 |
| BX-03 | ☑ | 架构图交互视图（nodes/relations，缩放/展开/钻取） | explorer-ui |  | BX-02 |
| BX-04 | ☑ | Declared/Observed/Verified 状态可视（MATCHED/DRIFT/UNKNOWN…） | explorer-ui |  | BX-02 |
| BX-05 | ☑ | Architecture Pressure / Intervention 浏览 | explorer-ui |  | BX-02 |
| BX-06 | ☑ | Compatibility Contract / Migration 状态浏览 | explorer-ui |  | BX-02 |
| BX-07 | ☑ | ADR / Constraint 浏览 + 交叉链接 | explorer-ui |  | BX-02 |
| BX-08 | ☑ | 多仓 Landscape 视图（跨仓边，复用 S2 多仓） | explorer-ui |  | BX-02 |
| BX-09 | ☑ | 搜索（复用 SQLite FTS5） | explorer-ui |  | BX-02 |
| BX-10 | ☑ | Evidence 钻取（节点→source selector→symbol，只读） | explorer-ui |  | BX-02 |
| BX-11 | ☑ | 只读保证：浏览器无法改模型（写仍走 ChangeSet/CLI/MCP） | runtime-daemon |  | BX-02 |
| BX-12 | ☑ | 零出域：Explorer 完全本地，不连 SaaS、不发代码 | runtime-daemon |  | BX-01 |
| BX-13 | ☑ | CLI：`archctx explore`（启动/停止/状态/撤销 token） | cli |  | BX-01 |
| BX-14 | ☑ | 无障碍/键盘/对比度基础 | explorer-ui |  | BX-03 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| BX-EG1 | ☑ | `archctx explore` 启动本地只读浏览面 | `bun test packages/runtime-daemon packages/cli` |
| BX-EG2 | ☑ | 仅绑 loopback，外部不可达 | 绑定/可达性测试 |
| BX-EG3 | ☑ | 浏览器无法触发任何模型写入 | POST 负向测试 |
| BX-EG4 | ☑ | Explorer 零出域 | repo-local route/UI audit；HL4 继续做 capture gate |
| BX-EG5 | ☑ | 多仓 landscape 正确渲染 | projection + landscape e2e |
| BX-EG6 | ☑ | 撤销 token/停止后服务不可达 | 撤销测试 |

## EM · 语义检索（Embedding，eval-gated）

**目标**：先用真实 eval 判断 Embedding 是否优于 FTS5；**胜出才落地**，否则保持 off 并记录。
**关联 ADR**：0033、0013、0014、0003。 **前置**：CD4-03/04/05；MVP FTS5（M1）。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| EM-01 | ☑ | 建立 Retrieval 评测 harness（可重复、确定性 seed） | retrieval |  | CD4-04 |
| EM-02 | ☑ | 构造代表性 context-recall eval set（多场景任务） | retrieval |  | EM-01 |
| EM-03 | ☑ | FTS5 baseline 跑分（context-recall/constraint-recall/无关比例/tool-call） | retrieval |  | EM-02 |
| EM-04 | ☑ | 本地 Embedding 索引原型（默认 off，经 retrieval port，provider 可插拔） | retrieval |  | CD4-03 |
| EM-05 | ☑ | Embedding 跑同一 eval set | retrieval |  | EM-02,04 |
| EM-06 | ☑ | **决策门**：按 CD4-05 判据比对 FTS5 vs Embedding，记录结果 | retrieval |  | EM-03,05 |
| EM-07 | ☑ | （条件·胜出）本地 Embedding 索引落地（增量、重建、隐私本地） | local-store-sqlite |  | EM-06；决策未胜出，条件不触发 |
| EM-08 | ☑ | （条件·胜出）retrieval port 融合 FTS5 + Embedding（混合检索） | retrieval |  | EM-07；决策未胜出，条件不触发 |
| EM-09 | ☑ | （条件·未胜出）记录"保持 off"，更新 ledger 与 ADR-0033 状态 | docs/adr |  | EM-06 |
| EM-10 | ☑ | 隐私：Embedding 全本地，向量不出域，默认 off | retrieval |  | EM-04 |
| EM-11 | ☑ | 文档：何时开启、代价、与 FTS5 的关系 | docs |  | EM-06 |

**Exit Gate**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| EM-EG1 | ☑ | eval harness 可复现 | 同 seed 同结果 |
| EM-EG2 | ☑ | FTS5 baseline 有报告 | `docs/verification/s4-retrieval-eval.md` |
| EM-EG3 | ☑ | 决策门产出明确 pass/fail + 证据 | decision = `keep-fts5` |
| EM-EG4 | ☑ | 条件实现仅在胜出后启用；默认仍 off | 配置默认测试 |
| EM-EG5 | ☑ | Embedding 向量零出域 | 本地断言；HL4 继续做 capture gate |

## HL4 · 加固与发布（本 sprint 面）

**目标**：新面隐私回归 + S1–S3 全回归 + 诚实声明（不关生产 GA 债）。
**关联 ADR**：0003 及全部不变量回归。 **前置**：BX/EM 全绿（EM 含决策门闭合）。

| ID | St | 任务 | Owner | Est | Deps |
|----|:--:|------|-------|:--:|------|
| HL4-01 | ☑ | S1–S3 不变量全回归（零出域、单仓/多仓、attestation、计费、通知/adapter/GA） | cross |  | — |
| HL4-02 | ☑ | 隐私审计扩展到 Explorer + Embedding（无代码/向量出域） | cross/security |  | BX-12,EM-10 |
| HL4-03 | ☑ | Explorer/Embedding 文档与示例 | docs |  | BX-13,EM-11 |
| HL4-04 | ☑ | 安全复审（loopback 服务、短期 token、本地端口暴露面） | cross/security |  | BX-01 |
| HL4-05 | ☑ | 性能（Explorer 大 landscape 渲染、Embedding 索引开销） | explorer-ui |  | BX-08 |
| HL4-06 | ☑ | 显式声明：S1–S3 生产/外部 readback 仍 pending，本 sprint 不继承为生产已绿 | docs |  | — |
| HL4-07 | ☑ | 更新 deferred ledger（Embedding 决策结果、Explorer 完成、剩余项） | docs |  | EM-06 |

**Exit Gate（本 sprint 面，非生产 GA）**

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| HL4-EG1 | ☑ | Explorer/Embedding 抓包零出域 | `docs/security/captures/sprint4-explorer-retrieval.har.json` + manifest readback |
| HL4-EG2 | ☑ | 浏览器只读（无写入路径）回归 | runtime POST 405 negative test |
| HL4-EG3 | ☑ | S1–S3 回归全过 | `bun test` + privacy/sprint gates |
| HL4-EG4 | ☑ | Embedding 决策门已闭合（建或不建都有记录） | `docs/verification/s4-retrieval-eval.md` + ledger |
| HL4-EG5 | ☑ | Critical/High 安全 Finding 为零（本 sprint 面） | `node scripts/privacy-route-audit.mjs` + `privacy-audit` tests |
| HL4-EG6 | ☑ | 诚实声明到位：本 sprint=repo-local，生产 GA 仍 blocked | `docs/verification/s4-hardening-release.md` |

---

## Post-Sprint-4（仍延后）

**生产就绪与真实发布**（关闭 S1–S3 全部 proxy/外部 readback 债：托管 CI 矩阵、真实大仓 benchmark、代表性 eval 报告、外部安全审计、安装演练、GPT Directory 真实上架、真实通知投递、生产抓包、跑 production-ga-readback）——这是真正发 v1.1 前的必经 sprint。· 更深的 IDE 原生插件 · Team/Enterprise 治理（持续排除，除非另行决策）。

## Execution Log

Keep this section last; `.ai/harness/scripts/sprint-backlog.sh complete-task` appends rows here。逐条完成时同步更新行状态、「进度总览」完成数与「ADR Delta」状态；EM 决策门结果回写 ledger。

| When | Task | Plan | Result |
|------|------|------|--------|
| 2026-06-20 | CD4 contracts delta | Add Explorer projection/service schemas, retrieval config/eval/decision schemas, fixtures, ports, ADR-0032/0033, and approval record. | Completed; `bun test packages/contracts/test/contracts.test.ts` passed 60 tests. |
| 2026-06-20 | BX local explorer | Add `explorer-ui`, runtime loopback Explorer service, read-only projection API, CLI `explore` surface, token revoke/stop behavior, and model/landscape/evidence summary rendering. | Completed; `bun test packages/explorer-ui packages/runtime-daemon packages/cli` passed 11 tests; `bun run typecheck` passed. |
| 2026-06-20 | EM retrieval eval | Add deterministic retrieval eval harness, FTS5 baseline, local deterministic embedding prototype, decision gate, and eval report. | Completed; decision is `keep-fts5`, embedding remains default off; `bun test packages/retrieval` and `bun run typecheck` passed. |
| 2026-06-20 | HL4 hardening closeout | Extend privacy route audit to Explorer/Retrieval, add Sprint 4 capture fixture, harden capture manifest strict external readback, update repo-local completion docs, and run full verification. | Completed; Sprint 4 is `60 / 60` repo-local deterministic. Production GA/external readback remains pending. |
