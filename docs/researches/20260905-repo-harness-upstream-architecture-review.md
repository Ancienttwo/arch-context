# ArchContext 作为 repo-harness 上游的整体架构评审

日期：2026-09-05。性质：源码与契约评审、针对性验证，以及用户授权的 evidence-integrity 实施。下述 Findings 记录评审基准，末尾实施记录区分已处理与待办。

## 基准与结论

- ArchContext：用户更新后的 `main@79c5ef88480684ce3d419c4399f04d70aa714db9`，源码版本 0.5.6。
- repo-harness：`a95f41e3c2e5d39d8dc765ffdc89fb75eb8ff6aa`，源码版本 0.18.0，声明依赖 `archctx` / `archctx-contracts` 0.5.6。
- 本次回读时 repo-harness 的两个已安装包仍是 0.4.4；源码拉取与依赖安装是不同状态。该下游 checkout 未作修改。

建议继续把 ArchContext 保持为独立、可复用的架构事实、评估、受控变更与复测上游；repo-harness 负责触发时机、提案作者、任务编排、执行和验收。不建议合并仓库或在 repo-harness 重写结构分析算法。

新 refactor 链具备可信的确定性基础，但目前更接近“可组合的结构评估与受控执行部件”，还不能宣称已经形成主动持续优化闭环。最重要的缺口是发现入口未接线、旧新证据标准分裂，以及实际可观测结构面小于产品愿景。

## P1：系统地图与所有权

| 层 | 当前职责与源码 | 权威边界 |
|---|---|---|
| CodeGraph / Git | `packages/local-runtime/codegraph-adapter/`、`git-adapter/`：源码事实、import edges、tracked files、索引状态 | 观察事实，不定义架构语义 |
| 声明模型 | `.archcontext/`、`packages/local-runtime/model-store-yaml/` | Git 中可审阅的架构声明；按 ADR-0040 的显式晋级规则处理 ledger authority |
| 确定性评估 | `packages/core/module-statistics/`、`refactor-assessment/`、`recommendation-engine/` | 模块度量、结构观察、提案判级、推荐 fingerprint、复测 disposition |
| 本地运行时 | `packages/local-runtime/runtime-daemon/`、`local-store-sqlite/` | 单写者、事务事件、历史分区、当前 Git 身份、证据绑定 |
| 受控变更与投影 | `packages/core/changeset-engine/`、`projection-engine/` | 经过批准和 digest 验证的模型/文档更新；下游不得旁路写 YAML/SQLite |
| 产品入口 | `packages/surfaces/cli/`、`mcp-local/`、Explorer、可选 Cloud governance | 同一 runtime 的适配层；Cloud 不应成为本地 refactor 的前置条件 |
| repo-harness | `src/core/refactor/`、`src/effects/refactor/`、`src/cli/commands/refactor.ts` | 提案责任、workflow route、Work Package/Sprint、授权、Cutover Closure、执行证据 |

应保留的设计：CodeFacts 隔离 CodeGraph、schema/digest fail closed、proposal 与 assessment 分权、declared/observed/verified/proposed/projected 分层、ChangeSet/daemon 单写者，以及 `merged_pending_measurement` 和 `resolved` 的严格区分。`RefactorProgram` 不复制 recommendation 生命周期，这是正确边界。

## P2：实际链路与缺口

1. repo-harness 的 `discoverRefactorCandidates` 调用精确 package-local `archctx refactor scan`，请求不带 proposal。
2. daemon 绑定当前 repo/worktree/HEAD/digest，读取 ledger 历史和模型，再读取 tracked files / CodeGraph imports。完成后再次检查 Git identity，变化则 `AC_REFACTOR_STALE`，不返回混合状态。
3. `buildModuleStatisticsSnapshot` 计算 ownership、footprint、模块图/SCC 和 coverage；`assessRefactor` 无 proposal 时返回 observations，`scale=null`。
4. repo-harness 的作者提交 `intent/scopePaths/targetDelta/targetOutcomes/killList`；上游再次评估，返回 `module/cross_module/architecture` 或缺证据/缺模型状态。
5. 显式 `refactor record` 将扫描结果转成 daemon-owned ledger 事件。scan 本身不持久化推荐；内存 assessment registry 容量为 8，过期/淘汰必须重新扫描。
6. repo-harness 根据上游 scale 路由，读取 accepted recommendation、校验 ProgramAuthorization，才物化 Work Package/Sprint；architecture 变化仍经过人类架构批准。
7. candidate verification 按 Contract → Cutover Closure → ArchContext verify → AcceptanceReceipt 执行；merge 后在目标 revision 复测，只有上游 resolution evidence 可以宣称 resolved。

主要入口证据：上游 `runtime-daemon/src/index.ts:3455`、`refactor-scan.ts:100`、`module-statistics/src/index.ts:90`、`refactor-assessment/src/index.ts:88`；下游 `discovery-authoring.ts:66`、`archctx-provider.ts:26`、`workflow-route.ts:47`、`board.ts:19`。

**链路在最前端断开。** 全量搜索下游 `src/ scripts/ assets/`，`discoverRefactorCandidates`、`assessRefactorProposal`、`authorRefactorProposal` 只有定义，无生产调用方。CLI `refactor.ts:122` 注册 start/status/materialize/verify 等生命周期命令，没有 discover/assess/author。当前 policy `refactor.mode=off` 是有意的激活边界，不是单纯改成 active 就能补齐的入口。

## Findings 与优化建议

### F1 / P1：把发现与作者阶段接成一个可验证的 shadow 用例

下游的 discovery 和 proposal-authoring 目前是函数与测试面；`authorRefactorProposal` 校验责任主体和字段，不调用 LLM，也不构成 local/GPT Pro 作者执行器。架构图对内部函数间 flow 的 proven 标记，不能证明从用户或 hook 触发的产品路径可达。

建议先增加显式的 shadow discovery/assessment 入口，复用已有 provider、上游推荐去重/状态和现有 agent runner。作者读取 bounded evidence，产出 typed proposal；不在 harness 用文件名/regex 猜 scale 或业务边界。先跑通公开入口，再把已存在的 architecture queue 的稳定事件作为一个触发源；hook 只登记需求，在受预算控制的执行点扫描，避免每次 edit 同步全仓分析。

完成标准：同一 revision 重复触发不生成重复推荐；有现存 accepted/resolved 状态时按上游 lifecycle 处理；无索引进入 proof_required；返回有责任主体的 proposal 和上游 scale；shadow 不物化任务、不修改产品代码。业务优先级和工作预算由 harness 决定，结构风险事实由 ArchContext 提供。

### F2 / P1：统一旧 prepare/checkpoint 与新 refactor 的证据标准

`pressure-engine/src/index.ts:76` 起根据路径/符号的 wrapper、legacy、owner 等字样生成 `observed` 信号。`application/src/index.ts:68` 在输入缺失时给 callerCoverage=0.8、testsAvailable=true、rollbackAvailable=true；daemon 的 prepare 调用没有提供这些真实观测。`refactor-decision/src/index.ts:54` 又构造固定 owner/relation/kill-list。

本次纯函数合成探针：仅 `files=[src/legacy-wrapper-owner.ts]`、`edges=[]`、普通 task，即得到 pressure=65/high；代入 prepare 的默认值，confidence=86/high，posture=intervention，并产出 `module.target-owner`、`symbol.legacyWrapper` 等固定目标。这证明判断路径存在，不代表真实项目里存在这些对象，也不表示已经发生自动变更。

新 `refactor-assessment/src/index.ts:42` 明确拒绝旧引擎的启发式观测，且新 module-statistics 不虚构 test/caller/rollback evidence。两条公开使用路径因而会对缺证据状态给出相反信任程度。

建议以新 typed assessment/evidence 作为结构提案评估的唯一来源；缺证据保留 unknown 并进入补证据流程。撤掉固定语义目标和未经测量的置信度默认值。已纳入本次独立工作包：legacy prepare 保留有界上下文提示，但不再 author intervention；RF2 是现有 accountable proposal 的评估入口。将完整 RF2 结果投影到所有 context 消费者仍是后续整合项，不能宣称本次已完成统一 classifier。

### F3 / P1：明确“结构异常检测”与“架构优化方案”之间的能力差距

当前真实可观测面以 ownership、文件规模、import graph 和跨模块 SCC 为主。`module-statistics/src/index.ts:235` 明确将 observedEntrypoints/lifecycleOwners/datastoreSubjects 留空，directionViolationCount/instability 为 null，测试与 callerCoverage 全为 unknown。dynamicInvocationRiskCount 等于模块数，是“尚不可证明无风险”的覆盖说明，不能解释成真实风险事件计数。

`buildObservations` 虽包含 direction-violation，但当前 snapshot producer 不测该值，因此不能宣传该检测已经接通。`scale` 是拟议变更的范围等级，不是重构收益，更不是自动发现最佳模块划分的证明。

建议先补一个可验收的事实能力：把声明依赖方向/边界与已测 import edges 做 exact policy comparison，产出 selector-bound directionViolation，附真实违规与合法例外的样本。业务职责重复、生命周期重组和持久化边界优化由有证据约束的 agent 提案，再经上游评估，不用本地字符串规则替代语义判断。后续 test/caller evidence 仍保留独立来源和 freshness，不拿测试文件数量冒充覆盖率。

### F4 / P2：主动扫描之前先设计 scope、缓存和预算

当前 `runRefactorScan` 即使 request.scope 为 node，仍先读取全仓 tracked source 与 import pairs；`CODEGRAPH_IMPORT_NODE_QUERY_LIMIT=5000`。触顶产生 partial，`selectScale` 对非 complete coverage 返回 insufficient_evidence。graph 使用 iterative Tarjan 已避免递归栈风险，首先限制扩展的是全量采集/ownership 匹配、外部 CLI 调用、ledger genesis replay 和这个覆盖上限，而非必须换一个图算法。

建议复用同一 current identity 的上游 snapshot，并以受影响模块及必要依赖闭包进行 bounded measurement；明确 scope coverage，不能把局部 complete 冒充全仓 complete。上游保留结构 fingerprint/cooldown/budget 权威，harness 只持有触发去重、调度预算和执行资源。只有基准显示必要时再做索引增量化；不要仅把 5000 上限调大或给每次 hook 增加同步调用。

### F5 / P1（验证证据）：把 source fixture 与发布产物 conformance 分开

下游 `docs/verification/axr5-archctx-clean-room-readback.json:6` 的 source revision 是 `7875565`，该提交 root package version 为 0.5.3；报告包版本为 0.5.6。`scripts/axr5-archctx-clean-room.ts:233` 显式修改导出源码的 manifests 与 product-version，再本地 pack。这是有用的 source-built fixture 证据，但不能证明公开 0.5.6 tarball 与被测字节一致；后续 book/record identity 修复也不能仅凭被重写的版本号视为已覆盖。

建议保留现有源代码 fixture 测试的用途，另以官方 immutable tarball + integrity/source provenance 做一次 consumer conformance：capabilities → proposal-free scan → proposal assessment → record/lifecycle readback → exact post-change verify。不要每轮重跑整套发布矩阵；冻结目标后只生成一次这条证据。

本次下游 focused test 还暴露已安装 contracts=0.4.4 导致缺 `REFACTOR_SCALE_REASON_CODES` 导出。这是当前工作区 dependency freshness 问题，不能据此断言已发布 0.5.6 本身损坏。本评审未自动安装或升级。

### F6 / P2：按领域收缩 runtime 组装层，保持部署单元稳定

`runtime-daemon/src/index.ts` 当前 8740 行，CLI main 4337 行；已有独立 refactor-scan/recording/verify 文件，但 daemon 仍集中大量领域方法、RPC/client/server/identity/evidence 组装。`packages/surfaces` 同时依赖 cloud、core、runtime；单个版本一致产品有助于 protocol/migration 原子升级，不应为行数而拆成服务或新仓库。

建议优先沿现有 refactor 领域继续抽取一个 cohesive application service，让 CLI/RPC/context 共享同一 use case；daemon 保留 session、事务、writer boundary、lifecycle 和路由。已有 projection/refactor 两个消费者共用 package-local invocation，下一步可以将它移到中性 provider runtime 模块，消除 refactor 对 projection effect 文件的命名与类型耦合。原生 koffi 写入安全边界必须保留，不因精简依赖而弱化。

## P3：取舍、优先级与停止边界

架构目标是减少错误重构和未闭环技术债，不是最大化 recommendation 或自动创建 Work Package 的数量。可信事实/收益判断/执行授权是三件不同的事：ArchContext 提供前者与结果测量；agent 对提案内容负责；harness 对执行选择和交付负责。

建议顺序：

1. 用已发布且安装一致的 provider 打通一个显式 shadow discovery → authored proposal → assessment 用例，补上公开入口可达性测试。
2. 在全局主动触发前统一旧新 evidence 标准，清除默认高置信度与固定语义目标。
3. 补一个真实可测的边界违规 signal，并用已修复缺陷、合法设计和缺证据案例对照评估误报、有效提案率与复测改善。
4. 基于真实成本数据接稳定事件触发和 bounded scope/cache；最后再考虑更广自动化和 runtime 模块整理。

无需现在合并仓库、引入新架构 agent 平台、新增第二个 recommendation ledger、启用向量检索或重写 CodeGraph。这些均不解决已证实的首要缺口。

## 本次验证与限制

- `bun test packages/core/module-statistics/test packages/core/refactor-assessment/test packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts`：161 pass，0 fail，782 assertions，8 files。
- `bun test tests/unit/refactor-policy.test.ts tests/unit/refactor-workflow-route.test.ts`（repo-harness）：3 policy tests pass；route suite 在模块载入时报错，原因是实际 installed `archctx-contracts@0.4.4` 缺少所需 export。
- 完成生产调用方搜索、CLI 命令注册核查、用户 pull 后两仓库 SHA/manifest/install 回读，以及旧 pressure/decision 的无 I/O 合成探针。
- 未跑完整 daemon/provider E2E、外部模型提案质量评估或 10x benchmark；未证明 runtime live 启用，也未重新验证 npm latest。性能部分是从当前算法和预算推导的瓶颈，非实测结论。
- 未修改 Git-visible 架构模型、运行态 ledger、生产配置或发布状态。实现范围及验收见下一节。

## 授权实施记录

计划：`plans/plan-20260905-architecture-evidence-integrity.md`。用户随后授权并行实施、验收、提交与合并；fast-worker=Terra/high，deep-worker=Sol/medium，parent 负责集成与验收。

- F2：去除 name/summary/data-read 伪 observed、未测 readiness 默认值，以及固定 target/kill-list 生成路径。single-repo、landscape 与 prepare 共享明确的 readiness 输入语义；缺失项投影为 unknown，显式 0/false 不被改写。cross-repo 的文字提示也不能提高 observed 分数。
- 当前 legacy observed 信号最多贡献 50/medium；没有提高权重来人为恢复 high。high → proof-required 的决策分支由直接真实形状输入验证；主动发现与 proposal 判级由 RF2 负责。低 pressure 不等于已证明没有架构问题。
- 原 drift eval 从 task 生成假 symbols/files，已列入切换范围。保留旧 32 条 ground truth，不重标；缺乏实测证据的 22 个正例会成为真实召回缺口。新增明确图/date 对照不能消除该限制。不能把 precision 合格宣传为广泛架构语义检测已达标。
- 旧 target/migration eval 每行都检查同一个固定 skeleton。改用真实 RF2 authored fixture 后发现 validator 未拒绝 required/temporary relation overlap；纳入唯一相邻修复，以既有 `AC_SCHEMA_INVALID` 拒绝，不新增 schema 形状。
- F1、F5 的下游部分交给 `docs/researches/20260905-repo-harness-refactor-discovery-handoff.md`。F3/F4 的上游能力与规模瓶颈保留在 deferred ledger，不以本次修复冒充完成。

精确测试、审阅与提交状态以 `tasks/reviews/20260905-architecture-evidence-integrity.review.md` 为准；本报告中的 0.5.6 是起始基准，不是本次源码变更的发布版本。
