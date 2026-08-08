# Plan: Sprint task: AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake

> **Status**: Executing
> **Created**: 20260808-1735
> **Slug**: axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md`; after execution revert branch `codex/axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md`
> **Task Review**: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md`
> **Implementation Notes**: `tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md`
- Sprint contract: `tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md`
- Sprint review: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md`
- Implementation notes: `tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md`.

## Approach
### Strategy
先建立一个可重算的 `ProjectionSnapshotV1`，把 base HEAD、完整 worktree、声明 source
tree、model、CodeGraph indexed worktree、renderer 与 layout 版本收口到同一个
`projectionInputDigest`。随后把 CodeGraph adapter 从“声明 provider.version + 目录存在”
改为 package-local 1.5.0 binary 的实际 `--version`、`status --json`、`sync`、再次
`status --json` 与 bounded facts query；任一步无证据或 snapshot 在查询期间变化都
fail closed。最后让 docs manifest、CLI plan/apply readback 与 freshness gate 消费同一
snapshot：freshness 比较 sourceTree/proof digest，不再因为 docs 与 source 同 commit
就把 clean dirty-worktree 误判成 fresh 或 stale。

### P1 · Architecture Map

- `packages/local-runtime/git-adapter`：repository/base HEAD/完整 worktree measurement。
- `packages/local-runtime/codegraph-adapter`：package-local binary、actual version、status/
  sync/query 与 indexed snapshot proof；不读取 `.codegraph` 内部文件。
- `packages/core/projection-engine`：declared source tree digest、model/layout/renderer input、
  manifest render/readback 与 pure freshness comparison。
- `packages/surfaces/cli` / `packages/local-runtime/runtime-daemon`：唯一 I/O orchestration
  entry，先冻结 input snapshot，再 query/render，再在写前重算 expected snapshot。
- `packages/contracts` + runtime schemas：跨 AXR5 consumer 的 snapshot/receipt wire authority。

### P2 · Concrete Trace

`archctx docs plan --profile repo-harness/v1` 读取 root/HEAD/worktree，解析 strict layout 与
model，按 source footprints 计算 `sourceTreeDigest`，解析 package-local CodeGraph 1.5.0
并 readback actual version；adapter 读取 pre-sync status、执行一次 sync、读取 post-sync
status，验证 root/index counts/status，再查询 P1/P2 facts并生成 `codeGraphDigest` 与
`indexedWorktreeDigest`。renderer 收到冻结 snapshot，产出 targets 与 manifest；CLI 返回
同一 `projectionInputDigest`。apply 前 daemon 重算 worktree snapshot并要求 expected digest
仍匹配，ChangeSet 成功后输出 result snapshot。freshness 对当前 source tree 与 manifest
recorded source/proof digests做比较；HEAD 只作 provenance/display，不作为 freshness truth。

### P3 · Decision Rationale

- 不从 `.codegraph` 数据库/WAL 推导状态；只信 package-local CLI 的 public readback。
- 不用 changed-path list 代替内容 digest；rename/delete/untracked source 都必须进入 digest。
- 不保留 1.4 compatibility lane；1.5.0 不可用或输出不符合 contract 直接失败。
- 10x 时首先受 CodeGraph sync/query 与 source hashing 限制；一次 projection 只做一次 sync，
  source file digest按排序路径线性计算，query有固定 timeout/budget。

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `package.json`, `bun.lock` | Modify | exact CodeGraph 1.5.0 package authority |
| `packages/contracts/src/projection.ts` | Modify | freeze complete snapshot/receipt fields and invariants |
| `schemas/runtime/projection-*.schema.json` + fixtures/tests | Modify | keep wire schema and fixtures exact |
| `packages/local-runtime/git-adapter/src/index.ts` | Modify | content-bound source/worktree measurements where Git is authoritative |
| `packages/local-runtime/codegraph-adapter/src/index.ts` | Modify | actual binary/version/status/sync/indexed snapshot handshake |
| `packages/local-runtime/codegraph-adapter/test/*` | Modify | stale/version/timeout/package-local/readback fixtures |
| `packages/core/projection-engine/src/index.ts` | Modify | source tree digest and snapshot-bound manifest/freshness |
| `packages/core/projection-engine/test/projection-freshness.test.ts` | Modify | dirty same-commit and mismatch regression coverage |
| `packages/surfaces/cli/src/main.ts`, CLI tests | Modify | one snapshot-aware plan/apply lane |
| `packages/local-runtime/runtime-daemon/src/index.ts`, tests | Modify | completion gate uses semantic snapshot freshness |

### Code Snippets
1. Measure repository/base HEAD/full worktree + model/layout/source tree.
2. Resolve package-local CodeGraph 1.5.0 and verify actual binary version.
3. Read status → sync once → read status → verify indexed snapshot → bounded facts queries.
4. Build canonical `ProjectionSnapshotV1` and `projectionInputDigest`.
5. Render docs/manifest and expose snapshot in plan/apply receipt.
6. Before apply, remeasure expected snapshot; mismatch is retryable failure, never best effort.
7. Freshness compares current semantic source/proof digest to manifest; HEAD is metadata only.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CodeGraph 1.5 status shape is weaker than indexed digest requirement | Medium | false freshness | bind canonical public status + measured source snapshot; if root/status cannot be proven, fail closed |
| full worktree digest changes when projection writes docs | High | no fixed point | distinguish input worktree from semantic source tree; freshness consumes source/proof digest |
| CodeGraph process hangs | Medium | hook/runtime stall | bounded subprocess timeout and typed failure |
| protocol fixture drift | Medium | AXR5 consumer mismatch | schemas, TS invariants, valid/invalid fixtures and clean-room CLI readback in same commit |

## Task Contracts
- Contract file: `tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md`
- Review file: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md`
- Implementation notes file: `tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md`; after execution revert branch `codex/axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md`, `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md`, and `tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md`; after execution revert branch `codex/axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake

## Context

- Sprint: `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md`
- Backlog row: 3
- Mode: contract
- Read the sprint Source PRD and Architecture Notes before implementation.
- The sprint row is a long-task waypoint, not a detailed implementation plan.

## Goal

Deliver backlog task `AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake` so that the acceptance line holds: actual binary/version/sync/indexed-worktree digests are bound to receipt; stale/mismatch cases fail closed; source+docs same commit remains fresh

## Planning Expansion

Before editing code, use `$think` to expand this sprint row into a decision-complete implementation plan. The `$think` pass should read the sprint file, preserve the acceptance line, name concrete files or commands, and produce the detailed `plans/plan-*.md` body that drives contract execution.

## Task Breakdown

- [ ] Run `$think` for backlog task `AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake` using sprint `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md` and acceptance: actual binary/version/sync/indexed-worktree digests are bound to receipt; stale/mismatch cases fail closed; source+docs same commit remains fresh
- [ ] Capture the approved `$think` output with `repo-harness run capture-plan --source waza-think --source-ref sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR2 [arch-context] dirty-worktree provenance and CodeGraph 1.5.0 snapshot handshake`
- [ ] Verify acceptance: actual binary/version/sync/indexed-worktree digests are bound to receipt; stale/mismatch cases fail closed; source+docs same commit remains fresh

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Expand AXR2 into this decision-complete P1/P2/P3 work package.
- [x] T1: freeze snapshot/provenance wire fields, schemas and fixtures.
- [x] T2: implement package-local CodeGraph 1.5.0 actual-version/status/sync handshake.
- [x] T3: bind source/model/layout/renderer/CodeGraph digests into docs manifest and CLI/daemon receipt.
- [x] T4: replace commit-only freshness with semantic source/proof snapshot comparison.
- [ ] T5: close targeted/full verification, external review, AcceptanceReceipt and Sprint archive.
