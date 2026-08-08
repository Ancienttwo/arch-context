# Plan: Sprint task: AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator

> **Status**: Done
> **Created**: 20260808-1504
> **Slug**: axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md`; after execution revert branch `codex/axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md`
> **Task Review**: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md`
> **Implementation Notes**: `tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md`
- Sprint contract: `tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md`
- Sprint review: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md`
- Implementation notes: `tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md`.

## Approach
### Strategy
1. 在 `@archcontext/contracts` 建立唯一 projection wire authority：runtime JSON Schema、TypeScript 类型和版本常量同源命名；所有对象 `additionalProperties: false`，不允许 source body、diff、prompt/completion 穿越协议。
2. `archctx capabilities --json` 是不启动 daemon 的静态 handshake。它报告当前 package version、projection request/result/refresh schema identity、`archcontext.docs-renderer/v2` 和仅限 AXR0 已落地的 feature 集。
3. renderer identity 升级到 v2，继续沿用已有 marker/output digest 语义；identity 变化有意让旧 v1 projection 显示 drift，不做兼容回退。
4. Mermaid skill 继续作为 agent authoring/review 能力；仓库依赖只增加 exact dev-only `@mermaid-js/mermaid-cli@11.16.0`。validator 扫描 checked-in `docs/architecture/**/*.md|*.mmd`、抽取每个 Mermaid source 到 temp dir、逐一渲染 SVG，空 corpus 或任一 block 失败即退出非零。
5. FG6 release dry-run 增加 release manifest dependencies 与 tarball file list 的负面断言，明确排除 `mermaid`、`@mermaid-js/*`、Puppeteer/Chromium。工具链不进入 production manifest。

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| 复用 envelope/v1 承载 capability handshake | CLI 形状一致 | repo-harness 需要解 envelope 且 capability contract 不可独立校验 | 否，输出独立 `ArchctxCapabilitiesV1` |
| Mermaid skill 作为 release validator | 无 npm install | skill 不是确定性 runtime/toolchain，无法在 CI 证明语法 | 否 |
| exact Mermaid CLI devDependency | CI/本地同版本、可离线复验 | install 体积增加 | 采用；FG6 证明不进入生产包 |
| renderer v1/v2 双读 | 平滑迁移 | 隐藏 stale projection，形成永久兼容分支 | 否；消费者必须拒绝 v1 |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/projection.ts`、`src/index.ts` | add/edit | projection/capability wire types、schema/version/feature constants与 exports |
| `schemas/runtime/*projection*.schema.json`、`architecture-refresh-signal.schema.json`、`archctx-capabilities.schema.json` | add | runtime validators，含 adopt conditional 与 closed object shapes |
| `packages/contracts/test/fixtures/**`、`packages/contracts/test/contracts.test.ts`、`publishability.test.ts` | add/edit | valid/invalid contract、privacy/publishability regression guards |
| `packages/core/projection-engine/src/index.ts` | edit | docs renderer identity v1 → v2 |
| `packages/surfaces/cli/src/main.ts`、`test/cli.test.ts` | edit | local `capabilities --json` command、help 与 exact output test |
| `package.json`、`bun.lock` | edit | exact dev-only Mermaid CLI 与 validator script |
| `scripts/verify-architecture-mermaid.mjs` | add | temp-only corpus extraction/render validation |
| `scripts/verify-architecture-mermaid.test.ts` | add | CommonMark fence extraction false-positive/false-negative regression coverage |
| `scripts/fg6-npm-release-dry-run.ts` | edit | production tarball/dependency negative assertions |

### Code Snippets
Wire identity 固定为：`archcontext.projection-request/v1`、`archcontext.projection-result/v1`、`archcontext.architecture-refresh-signal/v1`、`archcontext.capabilities/v1`、`archcontext.docs-renderer/v2`。capability features 使用排序后的 closed enum，不声明 AXR1+ 尚未实现的能力。

### Data Flow
`repo-harness subprocess → archctx capabilities --json → ArchctxCapabilitiesV1 schema validation → protocol/renderer feature gate`。Mermaid 验证路径为 `docs/architecture source → fenced-block extractor/.mmd reader → temp .mmd → local exact mmdc → temp SVG → cleanup`。FG6 路径为 `root manifest → explicit production stage manifest → npm pack --dry-run JSON → dependency/file negative assertions`。

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| renderer identity 升级使现有 docs 显示 drift | High | Medium | 这是预期 fail-closed 信号；AXR1+ 负责重新 projection，不伪造 v1 compatibility |
| Mermaid CLI/Chromium 增大开发安装 | High | Low | exact devDependency；生产 stage 显式依赖 allowlist，FG6 加负面断言 |
| JSON Schema 与 TypeScript 漂移 | Medium | High | fixtures 走 runtime validator；CLI output 以 exported builder/constant 构造并测试 |
| capabilities 过度声明未来功能 | Medium | High | feature enum/常量只列 AXR0 实现；后续 work-package 才扩展 |
| corpus scanner 漏图或修改 docs | Low | High | 同时扫描 `.md` fenced blocks 与 `.mmd`；temp-only output；空 corpus fail |

## Task Contracts
- Contract file: `tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md`
- Review file: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md`
- Implementation notes file: `tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md`; after execution revert branch `codex/axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md`, `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md`, and `tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md`; after execution revert branch `codex/axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator

## Context

- Sprint: `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md`
- Backlog row: 1
- Mode: contract
- Read the sprint Source PRD and Architecture Notes before implementation.
- The sprint row is a long-task waypoint, not a detailed implementation plan.

## Goal

Deliver backlog task `AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator` so that the acceptance line holds: contracts/CLI tests pass; every generated fixture renders with `@mermaid-js/mermaid-cli@11.16.0`; production tarball excludes Mermaid/Chromium; `archctx capabilities --json` reports exact protocol/renderer/features

## Planning Expansion

Before editing code, use `$think` to expand this sprint row into a decision-complete implementation plan. The `$think` pass should read the sprint file, preserve the acceptance line, name concrete files or commands, and produce the detailed `plans/plan-*.md` body that drives contract execution.

## Task Breakdown

- [x] Run `$think` for backlog task `AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator` using sprint `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md` and acceptance: contracts/CLI tests pass; every generated fixture renders with `@mermaid-js/mermaid-cli@11.16.0`; production tarball excludes Mermaid/Chromium; `archctx capabilities --json` reports exact protocol/renderer/features
- [x] Capture the approved `$think` output with `repo-harness run capture-plan --source waza-think --source-ref sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR0 [arch-context] projection protocol, renderer v2 identity, and Mermaid release validator`
- [x] Verify acceptance: contracts/CLI tests pass; every generated fixture renders with `@mermaid-js/mermaid-cli@11.16.0`; production tarball excludes Mermaid/Chromium; `archctx capabilities --json` reports exact protocol/renderer/features

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] P1/P2/P3 expansion：确认 contracts → local CLI handshake → repo-harness consumer 与 docs → mmdc → FG6 production pack 两条真实路径
- [x] T1：实现 projection request/result、refresh signal、capabilities TypeScript/JSON Schema/fixtures 与 privacy guards
- [x] T2：升级 docs renderer identity v2，实现无 daemon `archctx capabilities --json` 与 CLI tests
- [x] T3：加入 exact dev-only Mermaid CLI 与 temp-only architecture corpus validator
- [x] T4：加强 FG6 production pack 对 Mermaid/Chromium 的负面断言
- [x] T5：运行 targeted contracts/CLI/projection tests、Mermaid render、FG6 dry-run、typecheck/package boundary
- [x] T6：记录 notes/review/AcceptanceReceipt，通过 strict contract/sprint gate 后提交并回并主线
