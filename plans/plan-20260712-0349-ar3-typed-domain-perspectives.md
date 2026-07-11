# Plan: AR3 Typed Data-Flow and External Integrations

> **Status**: Completed
> **Created**: 20260712-0349
> **Slug**: ar3-typed-domain-perspectives
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-contract-row
> **Source Ref**: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR3
> **Artifact Level**: work-package
> **Promotion Reason**: shared_contract_boundary
> **Verification Boundary**: Contract/schema/compiler/HTTP/CLI/HTML/package typed positive/negative/empty/stale/budget/digest coverage plus strict Sprint readback
> **Rollback Surface**: Atomic V2 catalog/schema/compiler/fixture revert; disposable manifest-addressed cache misses without rewrite
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md`
> **Task Review**: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md`
> **Implementation Notes**: `tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md`

## Agentic Routing
- Selected route: think
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR3
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-0349-ar3-typed-domain-perspectives.md`
- Sprint contract: `tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md`
- Sprint review: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md`
- Implementation notes: `tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260712-0349-ar3-typed-domain-perspectives.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260712-0349-ar3-typed-domain-perspectives.md`.

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
- Contract file: `tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md`
- Review file: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md`
- Implementation notes file: `tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260712-0349-ar3-typed-domain-perspectives.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Atomic V2 catalog/schema/compiler/fixture revert; disposable manifest-addressed cache misses without rewrite
- **Verification boundary**: Contract/schema/compiler/HTTP/CLI/HTML/package typed positive/negative/empty/stale/budget/digest coverage plus strict Sprint readback
- **Review/acceptance boundary**: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: shared_contract_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260712-0349-ar3-typed-domain-perspectives.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md`, `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md`, and `tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Atomic V2 catalog/schema/compiler/fixture revert; disposable manifest-addressed cache misses without rewrite

## Captured Planning Output

# Objective

Atomically add `data-flow` and `external-integrations` to the Explorer V2 public
view catalog. Both perspectives must be compiled only from typed graph facts already
selected by the bounded daemon read plan. Names, paths, Mermaid text, CodeGraph prose,
and local heuristics have no authority to classify a subject or relation.

# Success Criteria

- `ExplorerViewIdV2`, query/projection schemas, fixtures, compiler, HTTP parser, CLI,
  HTML surface, and packaged smoke accept the same five-view catalog in one merge unit.
- `data-flow` contains only relations whose typed `kind` is exactly `reads`, `writes`,
  `publishes`, or `subscribes`, plus the exact endpoints of those relations.
- `external-integrations` starts only from typed `external-system` architecture
  entities and contains only those seeds, their directly adjacent typed relations,
  and the exact opposite endpoints. It does not include unrelated edges between two
  included neighbors.
- Both views return honest empty projections when no typed match exists. They do not
  fall back to `system-map`, names, paths, observed prose, or derived classifiers.
- Overview grouping, context/detail focus, backlinks, stale-cursor rejection, and
  hard node/relation budgets continue to use the existing V2 semantics.
- Every view definition declares its full input-domain requirements and carries a
  machine-readable selection policy in `viewDefinitionDigest`, so old cache entries
  cannot masquerade as the new semantics.
- Positive, negative, adversarial-name/path, empty, deterministic, focus, stale,
  budget, HTTP, CLI, HTML, schema, and packaged-product tests pass.
- No compatibility reader, legacy view alias, fallback classifier, database migration,
  cache rewrite, or second authority source is introduced.

# P1 · Architecture Map

- Public authority: `packages/contracts/src/ports.ts` owns the view union, per-view
  input requirements, and canonical bounded read plan.
- Runtime JSON authority: Explorer query/projection V2 schemas and canonical fixtures.
- Projection semantics: `packages/local-runtime/runtime-daemon/src/explorer-projection.ts`.
  It already builds canonical typed subject/relation occurrences before view selection;
  AR3 changes only the deterministic selection step and view definitions.
- Runtime entrypoint: daemon HTTP query parsing in `packages/local-runtime/runtime-daemon/src/index.ts`.
- Product surfaces: CLI projection command, generic HTML view navigation, and packaged
  CLI smoke. The HTML renderer remains projection-only and adds no classification.
- Operational dependency: manifest-addressed SQLite cache consumes the query and
  view-definition digest. It remains disposable runtime state and needs no migration.
- Scale boundary: the existing `ProjectionReadPlanV1` and query budget remain the only
  data boundary. AR3 cannot preload a wider graph to improve a view.

Out of scope: new entity/relation vocabularies, graph inference, parser authority,
filesystem hierarchy, database changes, cache mutation, and editing.

# P2 · Concrete Flows

```text
GET/CLI query view=data-flow
  -> exact five-value query validation
  -> canonical bounded read plan
  -> typed entity/relation occurrence compilation
  -> retain exact reads|writes|publishes|subscribes relations
  -> retain only their exact endpoints
  -> existing overview/focus/budget/page/compiler-digest pipeline
  -> projection/HTML/CLI output
```

```text
GET/CLI query view=external-integrations
  -> exact five-value query validation
  -> canonical bounded read plan
  -> seed architecture-entity occurrences with kind=external-system
  -> retain only relations directly adjacent to a seed
  -> retain seed and opposite endpoints
  -> existing overview/focus/budget/page/compiler-digest pipeline
  -> projection/HTML/CLI output
```

For either flow, zero typed matches produces zero subjects and zero relations. A
missing focus is rejected by the existing fail-closed query path. A stale cursor is
rejected before compilation by the daemon/store authority boundary.

# P3 · Decision

Use one internal `selectViewGraph(subjects, relations, view)` operation that returns a
coherent subject/relation subgraph. Keeping selection together prevents the
external-integration perspective from accidentally admitting unrelated edges between
included neighbors. Existing task-impact and drift-pressure semantics move through
the same operation unchanged.

Keep schema version V2 and perform an atomic pre-1.0 catalog extension. Encode exact
selection-policy discriminators in the view definition digest. Manifest-addressed
cache misses provide invalidation; rewriting or accepting old cache shapes is
forbidden. At 10x the public budget the bounded read fails first, not the selector:
selection remains linear in returned subjects plus relations.

# Public View Policies

| View | Typed selection | Input requirements | Empty behavior |
|---|---|---|---|
| `data-flow` | exact flow relation kinds and endpoints | authority, graph, evidence, observed, bindings required; existing optional event/drift/pressure/task domains | zero subjects/relations |
| `external-integrations` | `external-system` architecture entities, directly adjacent relations, and endpoints | authority, graph, evidence, observed, bindings required; existing optional event/drift/pressure/task domains | zero subjects/relations |

All five views remain advertised in canonical order. The two AR3 views are enabled
when their required input domains are ready; absence of matching data is an enabled
empty result, not an unavailable view.

# File Changes and Allowed Paths

- `packages/contracts/src/ports.ts`
- `schemas/runtime/explorer-projection-query-v2.schema.json`
- `schemas/runtime/explorer-projection-v2.schema.json`
- `packages/contracts/fixtures/valid/explorer-projection-v2.json`
- `packages/contracts/test/contracts.test.ts`
- `packages/local-runtime/runtime-daemon/src/explorer-projection.ts`
- `packages/local-runtime/runtime-daemon/src/index.ts`
- `packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts`
- `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`
- `packages/surfaces/cli/src/main.ts`
- `packages/surfaces/cli/test/cli.test.ts`
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`
- `scripts/packaged-cli-smoke.mjs`
- `docs/verification/ar3-domain-perspectives-readback.json`
- `docs/verification/ar3-domain-perspectives-readback.md`
- phase plan/contract/review/notes, strict check snapshot, and sprint status artifacts

Boundary/bad fixtures and topology/runtime-script tests may be read but must not be
edited unless the required public union causes a verified type/schema failure. Any
database schema or cache lifecycle change is a stop condition requiring a new plan.

# Task Breakdown

- [x] Create the bounded AR3 contract/worktree and record the base commit.
- [x] Extend the public union, per-view requirements, schemas, fixtures, and canonical
      view validation atomically.
- [x] Implement exact typed subgraph selection and digest policy discriminators.
- [x] Advertise both views and extend subject backlinks without inferring authority.
- [x] Add compiler positives, adversarial negatives, honest-empty, focus, budget,
      determinism, digest, and stale-cursor coverage.
- [x] Add HTTP, CLI, generic HTML, schema, and packaged smoke coverage.
- [x] Write durable readback with old/new digest evidence and explicit no-fallback audit.
- [x] Run focused tests, typecheck, `verify:explorer`, packaged smoke, contract/sprint
      strict verification; complete review/notes and merge the isolated worktree.

# Verification

```bash
bun test packages/contracts/test/contracts.test.ts \
  packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts \
  packages/local-runtime/runtime-daemon/test/local-runtime.test.ts \
  packages/surfaces/cli/test/cli.test.ts \
  packages/surfaces/explorer-ui/test/explorer-ui.test.ts
bun run typecheck
bun run verify:explorer
bun run scripts/packaged-cli-smoke.mjs
repo-harness run verify-contract --contract <ar3-contract> --strict
REPO_HARNESS_DIFF_BASE=<ar3-base> repo-harness run verify-sprint -- --strict
```

Acceptance readback must additionally search for view aliases, name/path classifiers,
fallback branches, cache rewrites, migrations, external assets, and semantic inference.

# Rollback and Stop Conditions

Rollback is one atomic code/schema/fixture/catalog revert. Disposable cache entries
become unreachable through digest identity and are not rewritten or deleted. Git
authority, ledger events, evidence, snapshots, and user-authored docs remain untouched.

Stop if implementation needs a new database table, wider authority read, untyped
classification, schema compatibility reader, legacy alias, browser-side semantic
derivation, or cache rewrite. Stop on any contract path drift or stale-cursor bypass.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Create the bounded AR3 contract/worktree and record the base commit.
- [x] Extend the public union, per-view requirements, schemas, fixtures, and canonical
- [x] Implement exact typed subgraph selection and digest policy discriminators.
- [x] Advertise both views and extend subject backlinks without inferring authority.
- [x] Add compiler positives, adversarial negatives, honest-empty, focus, budget,
- [x] Add HTTP, CLI, generic HTML, schema, and packaged smoke coverage.
- [x] Write durable readback with old/new digest evidence and explicit no-fallback audit.
- [x] Run focused tests, typecheck, `verify:explorer`, packaged smoke, contract/sprint
