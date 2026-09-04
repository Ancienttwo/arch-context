# Handoff：repo-harness 主动架构发现与提案闭环

> Date: 2026-09-05
> From: arch-context upstream review / architecture-evidence-integrity work-package
> To: 另一台机器上的 repo-harness orchestrator
> Status: 待下游核对当前实现后排程；不是要求重做已完成任务
> Downstream reviewed SHA: a95f41e3c2e5d39d8dc765ffdc89fb75eb8ff6aa
> Upstream reviewed SHA: 79c5ef88480684ce3d419c4399f04d70aa714db9 (0.5.6)
> Implementation source: 9b587af0d3983901b360d7a0187d460ab134348a; acceptance evidence: tasks/reviews/20260905-architecture-evidence-integrity.review.md

## 先核对，再派工

用户说明 repo-harness 正在另一台机器并行作业。本单只依据上述本地 source snapshot；开始前检查你的最新 HEAD、active plan/sprint、uncommitted WIP、已分工 ownership 和下面函数的 caller。已完成项以最新源代码和验收证据关闭；不要覆盖、cherry-pick 或重复制作已有实现。

本会话只修改 arch-context，上游不会直接修改 repo-harness checkout。上游修复 legacy pressure/prepare 的伪 observed / 默认高置信度 / 固定目标问题，并在既有 RF2 validator 拒绝 requiredRelations 与 temporaryRelations 的交集；没有新增 schema 形状或兼容转换。该源码修复未经新版本发布前不能当成你已安装 provider 的行为。

配套 review：`docs/researches/20260905-repo-harness-upstream-architecture-review.md`（arch-context repo）。旧 `20260903-program-b-dispatch.md` 的0.5.0/0.5.1阶段与“尚未发布”只是历史状态；当前按实际 manifest/lock/registry与capabilities核对，不能照旧版本执行。

## D1：首选工作包——显式 shadow discovery/author/assessment 产品入口

**本次已确认的缺口**：

- `src/effects/refactor/discovery-authoring.ts:66` 的 discoverRefactorCandidates 与 assessRefactorProposal 在 src/scripts/assets 中无production caller。
- `src/core/refactor/proposal-authoring.ts:45` 只校验typed draft和责任主体，不调用LLM。
- `src/cli/commands/refactor.ts:122` 已有生命周期CLI，但无discover/assess/author入口。
- hook route和heartbeat triage未调用refactor discovery；`.ai/harness/policy.json` 的mode=off是有意的activation边界。
- Module 2 archived plan将持久化、controller/CLI和author dispatch交给Module 4；优先补既有Module 4，不另造新平台。

**目标**：由一个公开的显式入口，在shadow范围完成当前revision扫描 → 候选展示 → 有责任主体的agent proposal → 同一事实基准上的ArchContext assessment。复用已有功能，禁止仅import库函数的测试代替产品入口测试。

**文件入口/建议ownership**：

- controller/effect owner：`src/effects/refactor/discovery-authoring.ts` 与现有program orchestration。
- CLI owner：`src/cli/commands/refactor.ts`；与controller同批时由同一worker写，避免共享文件并发。
- author runner接入：复用现有agent-runtime/author lane，先确认当前已有实现；不要为此新增provider平台。
- tests：对应discovery/proposal-authoring与CLI/controller tests，使用已有disposable fixture规范。

**必须保留的边界**：

1. 无proposal扫描的scale/proposalDigest必须为null，候选不得被当成执行方案。
2. 作者只能提供intent/scopePaths/targetDelta/targetOutcomes/killList和合法authoredBy；不得声明scale、route或resolved。GPT Pro内容由已有合法责任主体采纳，不能自创author kind。
3. proposal author读取bounded evidence，输出typed proposal。不能用文件名/regex推断业务职责或合成kill list。
4. assessment绑定发现时的实际repository/workspace/HEAD/worktree/model identity；未携带expected identity的初次scan，在后续assessment前必须显式固定返回identity。若当前schema不能表达需要的binding，向上游提交具体contract问题，不加私有兼容字段。
5. recommendation fingerprint、状态、冷却、回归关系以ArchContext为准；触发去重和执行预算归harness。无第二份recommendation状态ledger。
6. shadow不创建执行Lease，不自动物化Work Package，不改用户产品代码；现有activation和architecture approval保持。

**验收**：

- 从公开CLI/controller触发，确实到达provider和author，不是只有导出函数。
- exact重复触发只产生一份逻辑需求/提案；author/provider预算耗尽时有明确状态，不无限重试。
- 无索引、partial、ownership ambiguous均进proof_required或对应typed失败，零执行产物。
- 异步author过程中HEAD/worktree变化时，旧候选不能静默绑定新scope。
- resolved/superseded与active去重尊重上游权威；没有候选时不会自动发起author。
- 责任主体非法、proposal强行填scale、route降级、空/错误scope均拒绝。
- 含正常无事负例，证明不是每次运行都制造重构任务。

完成这一条显式入口后再接一个稳定的architecture queue事件源。hook登记需求，受控runner去扫描；不要在每次PostEdit/Stop同步跑全仓分析。这个自动触发阶段独立验收，避免把CLI连通与主动常驻合并成无限工作包。

## D2：独立验证工作包——真实发布产物 conformance

`docs/verification/axr5-archctx-clean-room-readback.json`当前source=7875565（源码版本0.5.3）、package version=0.5.6；`scripts/axr5-archctx-clean-room.ts:233`会改导出源码的manifest/product-version再pack。本地源码fixture测试有效，但它不是已发布0.5.6字节的证据。

保持source-fixture测试用途，单独对exact已发布tarball验证integrity/provenance，并跑最小consumer路径：capabilities → proposal-free scan → authored assessment → record/readback → exact post-change verify。覆盖0.5.4-0.5.6修正的live checkout identity与historical ledger partition区别。测试baseline以lockfile/runtime实际版本为准，不篡改版本字符串制造满足。

只在冻结target后生产一次证据；不复制完整发布矩阵，不用“version字符串一致”替代artifact一致。记录package integrity、provider binary、Node version、feature集、被测source/target identity及实际command。

## 本地安装差异不是远端机器故障结论

评审机器repo-harness的manifest pin为0.5.6，但node_modules两包仍是0.4.4。focused route/discovery tests因缺refactor export在module load阶段失败。请只检查你自己机器的install readback；若已一致直接关闭此项。不要基于本单更改另一并行worker的依赖目录或全局工具。

## 上游负责的事项与暂不交给下游的事项

- Legacy evidence integrity：上游当前实施；不要在harness补regex或替代confidence算法。
- legacy prepare不再返回自动生成的intervention；显式readiness字段缺失时为unknown，不能把score=0解读为测得覆盖率0。具体proposal仍由accountable author经RF2提供。
- 新validator将以AC_SCHEMA_INVALID拒绝同一relation同时为target required和migration temporary。作者必须明确最终结构与迁移桥，不能通过改写digest接受语义冲突；schema版本未变不代表旧非法输入继续被接受。
- directionViolation实际测量、test/caller coverage、scope增量采集：上游后续独立能力；当前null/unknown必须诚实保留。不要消费“字段存在”作为“producer已实现”。
- scale是改动范围，不是收益评分；任务优先级和执行预算在harness，结构事实与复测在ArchContext。
- 5000 import-node预算触顶导致partial；下游不能伪造complete或改用自建CodeGraph分析绕过。必要时向上游提出scope coverage contract请求。

## 交付回报

回报 `RESULT: DONE/PARTIAL/BLOCKED`，附最新base/head、变更路径、公开入口的实际运行证据、dependency/runtime readback、shadow负例与去重/预算测试、未解决的upstream contract问题。实现提交、已合并源码、已发布包、实际installed runtime分别报告。

不要将本单当成当前执行授权的替代；在你已有用户授权/active plan内纳入这两个独立工作包，冲突则保留WIP并向该机器orchestrator报告。上游合并不意味着下游已交付或新包已发布。
