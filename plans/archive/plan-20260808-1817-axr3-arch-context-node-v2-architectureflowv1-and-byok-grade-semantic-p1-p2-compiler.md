# Plan: Sprint task: AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler

> **Status**: Archived
> **Created**: 20260808-1817
> **Slug**: axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler
> **Artifact Level**: work-package
> **Promotion Reason**: semantic_authority_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md`; after execution revert branch `codex/axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md`
> **Task Review**: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md`
> **Implementation Notes**: `tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md`
- Sprint contract: `tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md`
- Sprint review: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md`
- Implementation notes: `tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md`.

## Approach
### Strategy
以一次原子 contract cutover 把 `archcontext.node/v1` 升为
`archcontext.node/v2`，并把 `source.entrypoints` 从路径字符串改成显式
`{id,path,symbols[{name,sinks[{id,path,symbol}]}]}`。同时新增
`ArchitectureFlowV1`：semantic participant、正常步骤、success/error terminal outcome
由模型明确声明；CodeGraph 只负责把 flow step 引用的 entrypoint/sink selector 绑定到真实
call evidence，不再枚举 top-five symbol 或从目录名、路径、函数名猜业务语义。

新增 pure `semantic-diagrams.ts` compiler，输入 node/relation/flow authority 与已经冻结的
CodeGraph evidence snapshot，输出 `proven | not-applicable | unprovable` proof matrix、P1
flowchart AST、P2 sequence AST 和结构化 diagnostics。renderer 只在 `proven` 时输出
BYOK-grade semantic Mermaid：显式业务 label、success/error `alt`、terminal outcome、quoted
labels、稳定 ID 与 dark/light class styles；`not-applicable` 输出理由，`unprovable` 输出
human-action-required，不生成看似可信的图。

在扩展模型前先以 repo-harness 的
`verification/codegraph-readiness` 和 `runtime-harness/hook-adapters` 两个 synthetic
fixture 作 fidelity gate。两者都必须 proven，并记录 declaration LOC、selector coverage、
unbound selectors、rendered SVG 与人工 review minutes；任一 unprovable 就停止，不把其余八个
capability 纳入本 work package。

### P1 · Architecture Map

- `schemas/repo/architecture-node.schema.json` 与 contracts fixtures：node v2 唯一 schema
  authority；禁止 v1 runtime reader。
- `schemas/repo/architecture-flow.schema.json` 与 `.archcontext/model/flows/*.yaml`：P2 semantic
  order、participants、branch/outcome authority。
- `packages/local-runtime/model-store-yaml` 与 `packages/core/architecture-ledger`：node v2 / flow
  model load、project/import authority；仍通过 ChangeSet/ledger writer，不增加直接写 YAML 的路径。
- `packages/local-runtime/codegraph-adapter`：按 node v2 的 exact source symbol → sink symbol
  selector 查询 immutable AXR2 snapshot，返回 evidence binding，不决定 label、顺序或 outcome。
- `packages/core/projection-engine/src/semantic-diagrams.ts`：pure proof/compiler boundary；
  `index.ts` 只消费 AST/render result。
- `scripts/verify-architecture-mermaid.mjs` 与 Mermaid skill：前者是自动 parse/render gate，后者
  只做 Architecture 人工 review evidence；两者都不是 semantic authority。

### P2 · Concrete Trace

`archctx docs plan --profile repo-harness/v1` 先由 AXR2 handshake 冻结 CodeGraph snapshot，
再从 `.archcontext/model/nodes|relations|flows` 载入 node v2 与 flow v1。adapter 对每个
`source.entrypoints[].symbols[].sinks[]` 执行 bounded exact-symbol query，形成带 selector ID、
source/sink symbol/path 与 call-site anchor 的 evidence binding。compiler 验证 flow 的
capability/participant/node/relation/selector 全部存在、每条 required step 都唯一绑定 evidence、
每个 required flow 同时有 success 和 error terminal outcome、无截断/歧义/unbound selector；
随后生成 semantic P1/P2 AST 与 proof digest。renderer 仅对 proven AST 输出 Mermaid，并把
proof matrix/digest 纳入 entity render input和 projection manifest。任一绑定缺失、branch/outcome
不完整、selector 截断或仅有 raw path/call trail时返回 unprovable，文件保持未被虚假图覆盖。

### P3 · Decision Rationale

- node v2 与 flow v1 同一 merge unit原子切换；不接受 string/object 双读，不让兼容路径长期
  存在。
- semantic declaration 是业务含义 authority；CodeGraph evidence 只能证明确切代码绑定，不能
  从调用图反推用户动作、错误语义或终态。
- proof status 是 compiler output，不允许 YAML 自称 proven；`not-applicable` 只允许显式 rationale
  且没有 steps/outcomes 的 flow。
- Mermaid skill 不加 runtime/npm dependency；现有 exact dev-only mmdc 继续负责自动 render，
  skill 负责人工视觉/信息架构 review。
- 10x 最先失败的是 per-selector CodeGraph query；adapter 必须去重 selector、共享一次 snapshot、
  固定 budget/timeout，并在 truncation 时 fail closed。

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Semantic model + exact evidence compiler | 业务含义可审查、可证明、可重放 | schema cutover 与声明成本较高 | **Use** |
| 保留现有 raw path/top-five diagram | 改动小 | 不能证明顺序、分支、参与者或终态 | Reject |
| 让 agent/LLM 在投影时自由补图 | 表面信息丰富 | 不确定、不可重放、越过 authority/ChangeSet contract | Reject |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `schemas/repo/architecture-node.schema.json` | Modify | node v2 + structured entrypoint symbol/sink selectors |
| `schemas/repo/architecture-flow.schema.json` | Add | flow v1 semantic participants/steps/success+error outcomes |
| `packages/contracts/fixtures/{valid,boundary,invalid}/**` | Modify/Add | atomic v2 fixtures and flow proof adversaries |
| `packages/contracts/test/contracts.test.ts` | Modify | v2/flow schema registry, no-v1 assertion, unknown-field/shape tests |
| `.archcontext/model/nodes/capability.architecture-context.yaml` | Modify | repository authority migrates atomically to node v2 |
| `packages/local-runtime/model-store-yaml/src/index.ts` | Modify | init node v2 and recursively include flows in model digest/load |
| `packages/core/architecture-ledger/src/index.ts` | Modify | project/import node v2 and flow records; remove v1 reader |
| `packages/core/architecture-ledger/test/**`, runtime/CLI/domain fixtures | Modify | replace v1 fixture truth with v2; assert v1 unsupported |
| `packages/core/projection-engine/src/semantic-diagrams.ts` | Add | pure proof matrix + P1/P2 AST compiler and Mermaid renderer |
| `packages/core/projection-engine/src/index.ts` | Modify | load flows, consume semantic proof, remove heuristic P1/P2 renderer |
| `packages/core/projection-engine/test/semantic-diagrams.test.ts` | Add | proven/NA/unprovable, escaping, outcome and adversarial tests |
| `packages/core/projection-engine/test/fixtures/semantic-pilot/**` | Add | two repo-harness fidelity fixtures and expected evidence |
| `packages/core/projection-engine/test/entity-summary.test.ts` | Modify | semantic P1/P2 projection and no-heuristic regressions |
| `packages/local-runtime/codegraph-adapter/src/index.ts` | Modify | exact node-v2 selector evidence bindings, no seed-budget lane |
| `packages/local-runtime/codegraph-adapter/test/capability-projection-inputs.test.ts` | Modify | exact binding, ambiguity/truncation/missing sink failures |
| `tasks/notes/...axr3....notes.md`, `tasks/reviews/...axr3....review.md` | Add | pilot LOC/coverage/unbound/minutes/SVG review evidence |

### Code Snippets
1. Migrate every runtime/fixture schemaVersion to `archcontext.node/v2`; reject v1 before render/import.
2. Add strict flow loader for `.archcontext/model/flows/*.yaml` and include flow bodies in model digest.
3. Query only declared source symbol/sink pairs and produce stable typed evidence bindings.
4. Compile semantic declarations + evidence into proof matrix and P1/P2 AST.
5. Render only proven diagrams; incomplete/missing/ambiguous data yields typed unprovable diagnostics.
6. Bind proof digest/status into entity target source digest and projection manifest.
7. Run two-fixture fidelity gate, mmdc SVG render and Mermaid skill Architecture review.

### Data Flow
```text
node/v2 + relation/v1 + flow/v1
              |
              v
 exact CodeGraph selector bindings (AXR2 frozen snapshot)
              |
              v
 semantic compiler -> proof matrix + P1 AST + P2 AST
              | proven only
              v
 Mermaid renderer -> entity docs -> mmdc SVG validation -> ChangeSet
```

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| atomic v2 cutover touches many fixtures | High | hidden v1 reader survives | repo-wide v1 search gate + full verify; no dual parser |
| CodeGraph call result is ambiguous/type-only | Medium | false proven flow | require unique exact source/sink binding; truncation/ambiguity unprovable |
| declarations merely restate prose | Medium | costly model without proof value | two-fixture LOC/coverage/review-time gate before any broader modeling |
| Mermaid labels break parser/theme | Medium | release failure or unreadable dark mode | quoted escaping, stable IDs, explicit classDef and mmdc render gate |
| per-selector query cost grows at 10x | Medium | projection timeout | deduplicate selectors, one snapshot, bounded query budget/timeout |

## Task Contracts
- Contract file: `tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md`
- Review file: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md`
- Implementation notes file: `tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md`; after execution revert branch `codex/axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: semantic_authority_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md`, `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md`, and `tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md`; after execution revert branch `codex/axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler

## Context

- Sprint: `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md`
- Backlog row: 4
- Mode: contract
- Read the sprint Source PRD and Architecture Notes before implementation.
- The sprint row is a long-task waypoint, not a detailed implementation plan.

## Goal

Deliver backlog task `AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler` so that the acceptance line holds: v1 dual reader absent; proven/not-applicable/unprovable matrix passes; semantic P1 and success/error P2 render; raw path/top-five heuristic cannot produce verified diagram

## Planning Expansion

Before editing code, use `$think` to expand this sprint row into a decision-complete implementation plan. The `$think` pass should read the sprint file, preserve the acceptance line, name concrete files or commands, and produce the detailed `plans/plan-*.md` body that drives contract execution.

## Task Breakdown

- [ ] Run `$think` for backlog task `AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler` using sprint `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md` and acceptance: v1 dual reader absent; proven/not-applicable/unprovable matrix passes; semantic P1 and success/error P2 render; raw path/top-five heuristic cannot produce verified diagram
- [ ] Capture the approved `$think` output with `repo-harness run capture-plan --source waza-think --source-ref sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR3 [arch-context] node v2, ArchitectureFlowV1, and BYOK-grade semantic P1/P2 compiler`
- [ ] Verify acceptance: v1 dual reader absent; proven/not-applicable/unprovable matrix passes; semantic P1 and success/error P2 render; raw path/top-five heuristic cannot produce verified diagram

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Expand AXR3 into this decision-complete P1/P2/P3 work package.
- [x] T1: atomically migrate node schema/model/ledger/runtime fixtures to v2 and add flow v1 contracts/loader.
- [x] T2: replace seed-budget call trails with exact node-v2 source/sink evidence bindings.
- [x] T3: compile node/relation/flow + evidence into proof matrix and semantic P1/P2 AST.
- [x] T4: render proven BYOK-grade diagrams, bind proof digest, and fail closed for NA/unprovable cases.
- [ ] T5: pass two-fixture fidelity gate, targeted/full verify, external review, AcceptanceReceipt and Sprint archive.
