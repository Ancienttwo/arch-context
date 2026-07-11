# Plan: AR0 Deterministic Bounded Topology Kernel

> **Status**: Archived
> **Created**: 20260712-0301
> **Slug**: ar0-deterministic-topology-kernel
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-contract-row
> **Source Ref**: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR0
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Topology unit/surface/compiler regression, typecheck, verify:explorer, deterministic and default/max performance readback
> **Rollback Surface**: Code-only renderer rollback; no authority, database, cache, or public contract migration
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md`
> **Task Review**: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md`
> **Implementation Notes**: `tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md`

## Agentic Routing
- Selected route: think
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR0
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md`
- Sprint contract: `tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md`
- Sprint review: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md`
- Implementation notes: `tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md`
- Review file: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md`
- Implementation notes file: `tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Code-only renderer rollback; no authority, database, cache, or public contract migration
- **Verification boundary**: Topology unit/surface/compiler regression, typecheck, verify:explorer, deterministic and default/max performance readback
- **Review/acceptance boundary**: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md`, `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md`, and `tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Code-only renderer rollback; no authority, database, cache, or public contract migration

## Captured Planning Output

# Objective

Replace the current O(N x E) Explorer card renderer with a deterministic,
self-contained SVG topology renderer that consumes only the already bounded
`ExplorerProjectionV2`. AR0 changes no public contract, database, authority model,
query semantics, or browser navigation behavior.

# Success Criteria

- Default/context/detail projections render topology from the exact returned
  occurrences and relations; the relation table and Inspector remain accessible.
- Identical semantic input produces byte-identical render plan and SVG regardless of
  array order.
- Layout/index work is O(N + E), with no per-node full relation scan.
- Empty, disconnected, cyclic, self-loop, parallel-edge, long-label, hostile-label,
  and missing-endpoint behavior is explicit and tested.
- Default 80/160 render p95 is <= 50 ms over 20 warm runs; public maximum 1000/5000
  p95 is <= 500 ms over 10 warm runs.
- Default HTML is <= 1 MiB and public-maximum HTML is <= 8 MiB.
- No runtime/package dependency, CDN, external asset, Mermaid parser, semantic
  fallback, card compatibility path, or hidden unbounded fetch is introduced.

# P1 · Architecture Map

- Input authority: `ExplorerProjectionV2` in `packages/contracts/src/ports.ts`.
- Current consumer: `packages/local-runtime/explorer-html/src/index.ts`.
- New internal module: `packages/local-runtime/explorer-html/src/topology.ts`.
- Surface acceptance: `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`.
- Renderer unit tests: `packages/local-runtime/explorer-html/test/topology.test.ts`.
- Readback: `scripts/explorer-view-compiler-readback.mjs` plus AR0 JSON/Markdown
  evidence under `docs/verification/`.
- Out of scope: contracts, schemas, daemon query/SSE behavior, SQLite, ledger,
  navigation/CSP/runtime-script changes, new views, Inspector history.

# P2 · Concrete Flow

```text
ExplorerProjectionV2
  -> canonical occurrence/relation ordering
  -> O(N + E) occurrence + adjacency indexes
  -> choose overview-groups | context-bands | detail-focus mode
  -> deterministic integer geometry
  -> escaped self-contained SVG
  -> existing relation table + Inspector
  -> one HTML response
```

Missing endpoints are renderer invariant failures in pure tests; production HTML may
not fabricate an endpoint or silently replace topology with a legacy card view.

# P3 · Decision

Recover the safe hand-written status-band/focus SVG patterns from Git commit
`16f1f36` and adapt them to V2 occurrences. Do not port OMM Dagre/Marked/CDN code.
Geometry is disposable presentation state, never persisted or exported as authority.

At 10x scale the first failure is SVG/DOM size. The phase therefore preserves public
compiler budgets and fails the declared benchmark rather than dropping returned items.

# Internal Contract

`renderExplorerTopology({ projection, focusSubjectId })` returns an immutable plan and
SVG. The internal plan contains mode, viewBox size, node rectangles, edge points, and
omitted counts. It is package-private and must not enter the public contract.

Rules:

- canonical order: occurrence ID, then relation occurrence ID;
- finite integer coordinates within viewBox;
- stable offsets for parallel edges and visible self-loop paths;
- disconnected subjects in a labeled overflow band;
- derived groups have no canonical subject identity or mutation affordance;
- long labels are visually truncated but retain escaped full title/text;
- no recursive layout and no geometry-derived semantic identity.

# File Changes and Allowed Paths

- `packages/local-runtime/explorer-html/src/index.ts`: replace card topology output
  with the new pure renderer while retaining relation table and Inspector.
- `packages/local-runtime/explorer-html/src/topology.ts`: deterministic indexes,
  three layouts, SVG serialization, escaping, and invariant checks.
- `packages/local-runtime/explorer-html/test/topology.test.ts`: pure topology and
  determinism/complexity cases.
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`: HTML/accessibility/no-
  external-assets acceptance.
- `scripts/explorer-view-compiler-readback.mjs`: renderer timing, size, determinism,
  and privacy evidence.
- `docs/verification/explorer-ar0-topology-readback.json`: machine evidence.
- `docs/verification/explorer-ar0-topology-readback.md`: human readback.

No other implementation path is authorized. Package lockfiles and manifests are
explicitly excluded because no dependency may be added.

# Test Plan

- Unit: empty overview, overview groups, context bands, detail focus.
- Unit: reversed input byte identity and repeated render byte identity.
- Unit: cycle, self-loop, parallel edge, disconnected node, missing endpoint.
- Unit: long Unicode/hostile labels and attribute/text escaping.
- Unit: finite/bounded coordinates and linear index instrumentation.
- Surface: SVG, relation table, Inspector, accessible titles, no external URL/assets.
- Readback: default/max render p95, body size, determinism, privacy denylist.
- Regression: existing Explorer projection/query tests remain green.

# Verification Commands

```bash
bun test packages/local-runtime/explorer-html/test/topology.test.ts
bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
bun run typecheck
bun run verify:explorer
repo-harness run verify-contract --contract <ar0-contract> --strict
```

# Failure and Rollback

- Benchmark failure stops AR0; do not hide nodes or raise compiler budgets.
- Renderer invariant failure is visible in tests and prevents shipping.
- Rollback restores the prior renderer code only. No data/cache/ledger migration or
  SQL operation is allowed.
- If implementation requires a public contract, daemon semantic change, database
  change, compatibility reader, external asset, or new dependency, stop and revise.

# Task Breakdown

- [x] Add the pure deterministic topology module and O(N + E) indexes.
- [x] Implement overview-group, context-band, and detail-focus render plans.
- [x] Serialize typed edges, loops, parallel edges, disconnected nodes, and labels.
- [x] Cut explorer HTML from card topology to SVG while retaining table/Inspector.
- [x] Add unit/surface regression coverage including hostile and missing data.
- [x] Extend readback with default/max timing, body, determinism, and privacy evidence.
- [x] Run the full AR0 verification boundary and record exact results.

# Definition of Done

AR0 is independently usable and mergeable: topology is visible and deterministic,
all scoped tests and budgets pass, the public/data authority model is untouched, and
there is one renderer path with no compatibility fallback.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->
