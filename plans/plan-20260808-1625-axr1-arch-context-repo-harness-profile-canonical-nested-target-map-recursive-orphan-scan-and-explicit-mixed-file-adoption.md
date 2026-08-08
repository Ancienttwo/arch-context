# Plan: Sprint task: AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption

> **Status**: Done
> **Created**: 20260808-1625
> **Slug**: axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md`; after execution revert branch `codex/axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md`
> **Task Review**: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md`
> **Implementation Notes**: `tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md`
- Sprint contract: `tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md`
- Sprint review: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md`
- Implementation notes: `tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md`.

## Approach
### Strategy
先冻结一个纯 `layout.ts` authority，把 repo-harness node identity、nested module path、
`extensions.contractFiles`、target collision/path safety 与 projection-owned paths 归一化；
renderer/index/agent-context/loader 都消费这一份结果。随后以纯 `adoption.ts` 构造一次性
adoption preview：mixed marker-free 文件普通 apply 一律拒绝，只有 explicit adopt 在
preview ID、approved flag 与 expected worktree digest 同时匹配时才通过既有 ChangeSet
落盘。目标读取与 orphan discovery 分离：expected paths 精确读取，configured roots
递归扫描仅用于发现 marker orphan。

### P1 · Architecture Map

- Boundary: `packages/core/projection-engine` owns deterministic layout/render/adoption；CLI
  only parses intent and delegates writes to daemon ChangeSet；ChangeSet engine remains the sole
  filesystem mutation authority.
- Entrypoints: `archctx docs plan|preview|apply|adopt --profile repo-harness/v1` and
  `renderArchitectureDocumentationProjection({ profile })`.
- Authorities: `.archcontext/model/nodes/*.yaml` node facts；repo-harness profile parser for
  `capability.<domain>.<name>` and `extensions.contractFiles`；renderer v2 markers；current
  worktree digest and ChangeSet preimage hashes.
- Strong dependencies: layout target map → renderer/index links/loader/write allowlist；adoption
  plan → CLI → daemon plan/apply → journaled ChangeSet.
- Out of scope: AXR2 provenance/CodeGraph 1.5, AXR3 node v2/semantic flow compiler, AXR4 signal
  producer, repo-harness runtime consumer.

### P2 · Concrete Trace

`docs adopt --profile repo-harness/v1` loads the model, parses each strict node profile, resolves
exact nested targets and contract files, exact-reads expected files, recursively scans module roots
for orphan markers, renders candidate regions, and builds an adoption preview bound to current
worktree digest and per-file preimage/preserved-region hashes. Without `--approved` it writes zero
bytes. Approved execution must repeat the same preview ID and expected digest, then submits one
`render_projection` ChangeSet; the engine rechecks preimages, journals every file, atomically
commits or rolls back. A second profile apply sees marker-owned output and returns noop.

### P3 · Decision Rationale

- Existing append-on-missing-marker behavior cannot distinguish safe creation from unsafe
  brownfield takeover; the preserved invariant is that ordinary apply never invents ownership.
- Profile semantics are strict and fail closed; generic source-derived agent-context targets remain
  only for nodes without `contractFiles`, not as a fallback after a malformed repo-harness profile.
- Adoption does not introduce a second writer or compatibility reader. It is a bounded one-time
  transformation whose receipt can be discarded after markers and manifest establish normal v2
  projection ownership.
- At 10x documents, exact reads stay O(expected targets), orphan discovery O(files under declared
  roots), and ChangeSet remains one bounded transaction; the first pressure point is total
  brownfield Markdown parsing, so ambiguous heading/range detection stops the entire adoption.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Append generated region during normal apply | Minimal code | Duplicates P1/P2 and silently claims ownership | Reject |
| Infer nested/contract paths from source include | Works for simple repos | Diverges from repo-harness human authority | Reject |
| Direct file writer for adoption | Easy preview/apply coupling | Bypasses ChangeSet journal, rollback and preimages | Reject |
| Strict layout + explicit ChangeSet adoption | One authority, safe brownfield migration, deterministic retry | Adds one-time protocol and tests | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `packages/core/projection-engine/src/layout.ts` | add | canonical profile parser, target map, exact path safety/collision rules, recursive orphan discovery |
| `packages/core/projection-engine/src/adoption.ts` | add | adoption range parser, preview/receipt identities, preserved-region hashes and output builder |
| `packages/core/projection-engine/src/index.ts` | edit | consume/re-export layout/adoption, fail normal mixed marker-free render, profile-aware links/loaders/contract display |
| `packages/core/projection-engine/test/layout.test.ts` | add | nested paths, exact contract paths, collision/traversal/symlink/recursive orphan cases |
| `packages/core/projection-engine/test/adoption.test.ts` | add | zero-write preview, ambiguous headings, preserved hashes, preimage drift contract, idempotence |
| `packages/surfaces/cli/src/main.ts` | edit | `docs adopt --profile repo-harness/v1`, explicit approval/preview/worktree gates, profile apply noop |
| `packages/surfaces/cli/test/cli.test.ts` | edit | process/programmatic manual adoption route and fail-closed arguments |
| `packages/surfaces/renderer/test/renderer.test.ts` | edit | replace the obsolete implicit-adoption assertion with explicit adoption-required and marker-preservation coverage |
| `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts` | edit | real ChangeSet adoption, rollback/preimage drift and second apply noop |

### Code Snippets
Profile identity is exact `repo-harness/v1`. Node IDs match
`capability.<domain>.<name>` and resolve to
`docs/architecture/modules/<domain>/<name>.md`. `extensions.contractFiles.agents` and
`.claude` are required repo-relative POSIX paths. Adoption plan IDs are canonical digests over
profile, worktree digest, target ranges, preimages, outputs and preserved prefix/suffix hashes.

### Data Flow
`model → parseRepoHarnessNodeProfile → resolveArchitectureDocumentationLayout → exact target
reads + recursive orphan scan → renderer plan`. Brownfield path continues as `adoption range proof
→ preview ID → explicit approval + expected worktree digest → daemon ChangeSet → journaled apply
→ marker/preimage readback → second-run noop`.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Existing mixed docs have ambiguous P1/P2/P3 headings | Medium | High | fail entire adoption with typed human action; zero operations |
| Two nodes resolve one nested module or contract path | Low | High | canonical target-map collision rejection before render |
| Recursive scan follows a symlink outside repo | Low | High | lstat every traversal component and reject symlinks |
| Preview and apply observe different bytes/worktree | Medium | High | plan ID + explicit expected worktree digest + ChangeSet preimage checks |
| Generic profile regresses | Medium | Medium | preserve default layout tests; repo-harness strictness activates only via explicit profile or declared contractFiles |

## Task Contracts
- Contract file: `tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md`
- Review file: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md`
- Implementation notes file: `tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md`; after execution revert branch `codex/axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md`, `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md`, and `tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md`; after execution revert branch `codex/axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption

## Context

- Sprint: `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md`
- Backlog row: 2
- Mode: contract
- Read the sprint Source PRD and Architecture Notes before implementation.
- The sprint row is a long-task waypoint, not a detailed implementation plan.

## Goal

Deliver backlog task `AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption` so that the acceptance line holds: nested fixture resolves exact module/index/contract paths; unmarked mixed file writes zero bytes; approved adoption preserves all marker-external hashes; second apply is noop

## Planning Expansion

Before editing code, use `$think` to expand this sprint row into a decision-complete implementation plan. The `$think` pass should read the sprint file, preserve the acceptance line, name concrete files or commands, and produce the detailed `plans/plan-*.md` body that drives contract execution.

## Task Breakdown

- [x] Run `$think` for backlog task `AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption` using sprint `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md` and acceptance: nested fixture resolves exact module/index/contract paths; unmarked mixed file writes zero bytes; approved adoption preserves all marker-external hashes; second apply is noop
- [x] Capture the approved `$think` output with `repo-harness run capture-plan --source waza-think --source-ref sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR1 [arch-context] repo-harness profile, canonical nested target map, recursive orphan scan, and explicit mixed-file adoption`
- [x] Verify acceptance: nested fixture resolves exact module/index/contract paths; unmarked mixed file writes zero bytes; approved adoption preserves all marker-external hashes; second apply is noop

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Run `$think` for backlog task and freeze P1/P2/P3 design above
- [x] Capture the approved sprint row and expand it into this decision-complete plan
- [x] T1 implement strict layout/profile parser and profile-aware target/index/contract path consumers
- [x] T2 implement exact target loader plus recursive fail-closed orphan discovery
- [x] T3 implement explicit adoption preview/range/hash protocol and normal-apply rejection
- [x] T4 wire CLI/daemon ChangeSet flow with approval, preview ID and worktree/preimage gates
- [x] T5 run targeted/full verification and external acceptance review
- [x] Verify acceptance: nested fixture resolves exact module/index/contract paths; unmarked mixed file writes zero bytes; approved adoption preserves all marker-external hashes; second apply is noop
