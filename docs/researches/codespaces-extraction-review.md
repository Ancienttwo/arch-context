# codespaces 萃取评估：diskd-ai/codespaces → arch-context

**研究日期**：2026 年 7 月 14 日

**对比对象**：`diskd-ai/codespaces` main 分支 commit `443ad95`（2026-07-13）与 `arch-context` main 分支 commit `0923904`（2026-07-12，同批记录 npm `0.3.0` 发布）。`diskd-ai/codespaces` 已 clone 到 `_ref/codespaces`（仓库约定的忽略外部参考目录），供后续直接查阅源码，不必每次重新拉取。

**方法论前提**：`peer-research2.md` 已经记录过一次教训——早期竞品分析"过度依据官网功能清单和 README，没有充分区分'声明支持某功能'和'真正形成可靠系统'"。本次对 codespaces 的每条断言都要求对照实现代码、测试和最近一次 commit 的 diff 核实，不停留在 README/SKILL.md 转述层面；对 arch-context 自身的断言，全部用 CodeGraph 重新核对当前磁盘上的源码，不采信任何转述。

## 一、核心结论

`diskd-ai/codespaces` 是一个面向 AI 编码代理的代码调查 skill：把仓库编译成 `.belief_map.sexp`，通过 symbol/deps/rdeps/flow/boundary 等查询缩小阅读范围，核心工作流是 "query before read"。它和 `peer-research2.md` 里定位的 CodeGraph 处于同一层——"底层代码事实引擎"，不是 arch-context 的直接竞争对手。

值得萃取的不是它的存储模型或解析器实现，而是两点经过验证的东西：query-before-read 这套交互习惯，以及它最近一次 commit 里"每修一个正确性 bug 就配一个回归测试"的工程纪律（`443ad95` 新增 `tests/test_audit_regressions.py`，257 行、10 个真断言测试，无一 skip/xfail）。

方案原本建议的四阶段落地计划——新增 `ChangeBoundaryV1` 领域对象（约 10 个嵌套字段）、`InvestigationScopePort`（4 个方法）、统一 MCP 工具、CLI 别名、eval fixture 目录、后续 IaC provider——规模超出了实际需要。对应的真实缺陷只有一处：一个没有任何调用方、零测试覆盖的孤儿函数。结论是先做一个范围很小的 PR，把四阶段计划整体搁置，直到这个小修复证明不够用为止。

## 二、P1 架构地图：核实方式

- **arch-context 一侧**：用 CodeGraph 对以下模块重新核对了当前磁盘源码——`packages/contracts/src/ports.ts`（`CodeFactsPort`、`NormalizedImpact`）、`packages/local-runtime/codegraph-adapter/src/index.ts`、`packages/core/context-compiler/src/index.ts`、`packages/core/pressure-engine/src/index.ts`、`packages/core/review-engine/src/index.ts`、`packages/surfaces/mcp-local/src/index.ts`、`packages/core/retrieval/src/index.ts`、`packages/local-runtime/runtime-daemon/src/index.ts`。
- **codespaces 一侧**：委托 deep-reasoner 直接抓取 GitHub 上的 `SKILL.md`、`README.md`、`scripts/build_belief_map.py`、`scripts/belief_search.py`，以及 `443ad95` commit 的完整 diff（含新增测试文件），逐条核实方案里的断言，而不是从方案的转述文字直接采信。

## 三、P2 具体追踪路径：真实缺口在哪

方案里最关键的一条断言——`getImpactRadius()` 的 `callers`/`callees` 被硬编码成空数组——完全属实，而且比方案描述的更极端：

1. `packages/contracts/src/ports.ts:123-132` 的 `CodeFactsPort` 接口定义没问题：`ensureReady`、`sync`、`buildTaskContext`、`findSymbols`、`getImpact`、`getCallers`、`getCallees`、`resolveEvidence` 都在；`NormalizedImpact`（98-103 行）有完整的 `callers`/`callees`/`affectedPaths` 字段。
2. `packages/local-runtime/codegraph-adapter/src/index.ts:98-108`，`CodeGraphCliProvider.getImpactRadius()` 只把 CLI 返回的 `affected` 数组映射成 `affectedPaths`，`callers: []`、`callees: []` 是写死的常量。
3. 同文件 279-285 行，`CodeGraphAdapter.getCallers()`/`getCallees()` 直接委托给这个恒为空的实现——contract、port、调用链路全部是通的，只是最底层的 CLI 输出解析没有接上真实数据。
4. 全仓库 grep 这三个方法，**没有任何调用方**，包括测试用的 mock（`codegraph-adapter/test/factories.ts`）也返回空值。也就是说这个缺口今天不影响任何可观察行为，是一段孤儿代码。CodeGraph 自身的 blast-radius 分析也标注 `getImpactRadius` "⚠️ no covering tests found"。
5. 再往上一层，`packages/local-runtime/runtime-daemon/src/index.ts:690-761` 的 `RuntimeDaemonClient` 接口有 30 多个 RPC 方法（init/sync/validate/context/prepare/checkpoint/jobs\*/auditRun/docs/practices/planUpdate/completeTask/applyUpdate/ledger\*/book/recommendations/repo\*/explorer\*/...），没有一个把 `getImpact`/`getCallers`/`getCallees`/`findSymbols` 往外暴露。
6. 再往上，`packages/surfaces/mcp-local/src/index.ts:41-72` 的 `LOCAL_MCP_TOOLS` 精确只有 6 个：`archcontext_prepare_task`、`archcontext_practices`、`archcontext_checkpoint`、`archcontext_plan_update`、`archcontext_apply_update`、`archcontext_complete_task`，没有任何 investigate/impact 工具。

三层缺口叠在一起：contract 层已正确定义 → adapter 层写死空值且零调用方 → daemon RPC 层从未暴露 → MCP 层也从未暴露。这不是"MCP 少一个工具"就能概括的，但也说明真正要修的落点很小，因为下面三层的骨架都已经搭好了。

deep-reasoner 还核实出一个更麻烦的前置问题：本地装的是 `codegraph@1.3.0`，adapter 锁定要求 `1.4.0`（`assertCompatible()` 会直接抛错）；而 1.3.0 的 `codegraph impact -j` 本身就不返回带方向的边，只报 `edgeCount` 数字，没有边数组；带方向的调用关系只存在于 `codegraph node` 的人类可读输出（"Calls →"/"Called by ←"），且这个命令没有 `--json`。所以修复很可能不是"补一段字段解析"，而是要在 1.4.0 上先确认 `impact -j` 是否已经带边数据，如果没有，就得再调一次 `node` 命令解析文本。这是动手前第一件要验证的事。

另有一处方案未提及、但会削弱其核心论点的发现：`packages/core/pressure-engine/src/index.ts` 里，`unjustified-wrapper-adapter`、`dual-track-business-concept`、`duplicate-responsibility` 等信号的 "observed" 判定本质上也是对 symbol/路径名字符串做正则匹配（如 `/wrapper|adapter|mapper|fallback/` 直接测子串），只有 `boundary-crossing-import`、`dependency-cycle`、`cross-boundary-data-access` 真正使用了边的结构信息（`hasImportEdge`/`hasBidirectionalImport`/`hasDataEdge`）。"codespaces 靠目录命名启发式，arch-context 靠 model/policy" 这个对比被高估了——arch-context 自己的 pressure-engine 目前也大量依赖命名正则。值得保留的是现成的分级机制：纯启发式信号的分数被硬顶在 25 分以内（`heuristicOnly ? Math.min(rawScore, 25) : rawScore`），永远到不了 high 级别——这正是"heuristic 不能单独触发 proof-required 级别的拦截"这条设计原则已经落地的地方，新增的判定逻辑应该复用它，而不是重新发明。

## 四、外部断言核实结果

| 断言 | 结论 | 证据 |
|---|---|---|
| `.belief_map.sexp` 扁平 S-expression 存储 | 属实 | `SKILL.md`、`README.md`、`references/sexp-notation.md` |
| Python `ast` + tree-sitter，LSP 可选增强，默认 Python/TS/TSX | 属实 | `build_belief_map.py`：`ast.parse`（L971）、`tree_sitter_typescript`（L49-50）、`class LspClient`（L2200），LSP 有真实的死循环 bug 修复和对应测试，非摆设 |
| search/analyze/boundary/deps/rdeps/flow/layers/invariants/query/repl | 属实 | `SKILL.md`、`belief_search.py` |
| "query before read" 强制工作流 | 属实 | `SKILL.md`："Never read code blindly"；`README.md`："Query before you read" |
| `443ad95` 修复批次（SHA-256 缓存、路径规范化含 macOS 别名、Python 相对导入、ESM `.js→.ts` 映射、LSP 引用环、layer 误判、确定性输出、不支持语言诊断） | 属实，且比方案转述更扎实 | commit `443ad95` 新增 `tests/test_audit_regressions.py`，10 个真断言测试对应全部 8 项，无 skip/xfail |
| Kustomize/Helm/Terraform infra topology | **部分不实** | Kustomize/Helm 是真实 `yaml.safe_load` 解析；Terraform 明确注释为 "regex fallback（不依赖 hcl2）"，只认最简单的 `module`/`resource` 块；边的实际命名是 `k8s-depends`/`k8s-service`/`helm-depends`/`tf-depends`，不是方案转述的 `deploys-to`/`configures`/`depends-on` |
| Mermaid 可视化（含 LSP 增强的 sequence diagram） | **不实** | `build_belief_map.py` 全文搜不到 `mermaid`/`sequenceDiagram`；`README.md` 只是建议调用它的 agent 自己把查询结果画成 Mermaid，是提示词层面的用法建议，不是代码实现 |
| 实现集中在少数大型 Python 脚本，非 ports/adapters 结构 | 属实 | `build_belief_map.py` 单文件约 132KB，无依赖注入/端口层，4 个脚本按关注点分文件但内部各自单体 |

## 五、P3 设计决策：为什么四阶段计划规模过大

方案提出的四阶段计划对应的真实缺陷范围很窄：一个没有任何调用方、零测试覆盖的孤儿函数。这正好撞上 arch-context 全局工程原则里"不为假设的未来需求引入抽象"的规则——现在的 agent/LLM 完全有能力直接用现有工具（CodeGraph 本身）做 caller/callee 分析，不需要在外面包一层新的领域对象和端口去代替它读代码。

具体的重复风险：`ChangeBoundaryV1` 的 `snapshot`/`impact`/`violations`/`coverage` 几个子结构，和现有的 `ObservedEvidence`（已有 `confidence: heuristic|observed|verified`、`coverage`、`polarity`）、`CompiledTaskContext.extensions.pressureSignals`（`PressureSignal[]`）、`NormalizedImpact` 有大量重叠。一旦引入，就要在 prepare/checkpoint/complete 和 pressure-engine 之间维护两套并行的证据模型同步——这本身就是 pressure-engine 定义的 `dual-track-business-concept` 那类坏味道。真正新的概念只有"有边界的读写范围"这一项，而 `CompiledTaskContext.relevantNodes: string[]`（`packages/core/context-compiler/src/index.ts:34`）已经是它的雏形。如果未来确实要做，应该是把 `relevantNodes` 升级成有类型的 read-set，而不是另起一个顶层领域对象。

## 六、结论与建议

**值得萃取**：query-before-read 的交互习惯；"每修一个正确性 bug 配一个回归测试"的纪律。这两点都在 `443ad95` 的真实测试里得到印证，不是 README 空谈。

**不建议现在做**：`ChangeBoundaryV1`、`InvestigationScopePort`、新 MCP 工具、CLI 别名、IaC provider、Explorer 可视化——四阶段计划整体搁置，直到下面的最小修复证明不够用。

**最小可行 PR（PR1）**：让 `CodeGraphCliProvider.getImpactRadius` 真正解析出 `callers`/`callees`。第一步先确认 `codegraph@1.4.0` 的 `impact -j` 或 `node` 输出里到底有没有方向性边这个数据源前提，再决定是纯字段解析还是需要新增一次 `node` 调用解析文本。配一个基于捕获输出的 fixture 回归测试（含负例：无边符号应仍返回空数组），呼应 codespaces `test_audit_regressions.py` 的做法。这个 PR 目前没有用户可见效果，因为没有任何调用方。

**PR2（按需触发，不预先建）**：把 `getImpact` 接入 daemon RPC（`RuntimeDaemonClient`）并加一个只读 MCP 工具返回 `NormalizedImpact`。只在真的出现需要读它的场景时再做。

**如果 1.4.0 验证结果推翻前提**：若 `impact -j` 已经带方向性边，PR1 缩小为几行的纯解析补全；若已有多个场景需要跨 prepare/checkpoint/complete 的有边界读写范围，`ChangeBoundaryV1` 里"read-set" 这一部分可以提前论证，但仍应作为 `relevantNodes` 的类型升级，不作为与 `PressureSignal`/`ObservedEvidence` 并行的新顶层对象。

## 关联

与 `peer-research2.md` 的定位一致：codespaces 和 CodeGraph 处于同一层——"底层代码事实引擎"，是可以合作、不值得重复造的能力；arch-context 的差异化仍在于"系统为什么这样设计、哪些边界不能破坏、当前任务应该如何修改架构"这一层语义，而不是符号查询本身。
