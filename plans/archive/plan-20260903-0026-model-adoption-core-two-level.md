# Plan: Model adoption: two-level architecture node tree (5 workspace modules + core components)

> **Status**: Archived
> **Created**: 20260903-0026
> **Slug**: model-adoption-core-two-level
> **Planning Source**: waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: archctx validate/docs drift/docs plan JSON gates, per-file archctx resolve ownership sweep, bun run verify, repo-harness capability-resolver validate and check-architecture-sync
> **Rollback Surface**: Inside the contract worktree: git checkout -- .archcontext/ docs/architecture/ .ai/context/capabilities.json tasks/workstreams/ plus git clean of new module docs; nothing committed or published
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md`
> **Task Review**: `tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0026-model-adoption-core-two-level.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from waza-think planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0026-model-adoption-core-two-level.md`
- Sprint contract: `tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md`
- Sprint review: `tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md`
- Implementation notes: `tasks/notes/20260903-0026-model-adoption-core-two-level.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0026-model-adoption-core-two-level.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0026-model-adoption-core-two-level.md`.

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
- Contract file: `tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md`
- Review file: `tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md`
- Implementation notes file: `tasks/notes/20260903-0026-model-adoption-core-two-level.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0026-model-adoption-core-two-level.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Inside the contract worktree: git checkout -- .archcontext/ docs/architecture/ .ai/context/capabilities.json tasks/workstreams/ plus git clean of new module docs; nothing committed or published
- **Verification boundary**: archctx validate/docs drift/docs plan JSON gates, per-file archctx resolve ownership sweep, bun run verify, repo-harness capability-resolver validate and check-architecture-sync
- **Review/acceptance boundary**: `tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0026-model-adoption-core-two-level.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md`, `tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md`, and `tasks/notes/20260903-0026-model-adoption-core-two-level.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Inside the contract worktree: git checkout -- .archcontext/ docs/architecture/ .ai/context/capabilities.json tasks/workstreams/ plus git clean of new module docs; nothing committed or published

## Captured Planning Output

## Goal

Replace the 2-node `.archcontext/` model with a 23-node two-level tree that mirrors the repo's real, machine-enforced module boundaries: 1 capability → 5 npm-workspace `module` nodes (`contracts`, `core`, `local-runtime`, `surfaces`, `cloud`) → 17 `component` nodes for the `packages/core/*` subpath exports (16 new plus the existing `component.architecture-context.projection-renderer`, re-parented under `module.architecture-context.core`). Every file under `packages/**/src/**` resolves to exactly one deepest owner. All writes go through `archctx plan` / `archctx apply` ChangeSets; no hand edits to `.archcontext/`, SQLite, WAL, or generated docs.

Granularity decision (user-approved 2026-09-03): stop at the workspace layer for `local-runtime`, `surfaces`, `cloud`; expand only `core` to subpath components, because that is where the refactor instrument's own logic lives and where module vs cross_module dogfooding matters. Further expansion is a later plan.

## Why

`plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` Key risk / Known Unknowns: the instrument's scale judgement is only as fine as the model. Today `capability.architecture-context` claims all of `packages/**/src/**` (`.archcontext/model/nodes/capability.architecture-context.yaml`), so every proposal resolves to one node and `module` / `cross_module` cannot be distinguished. The 5 workspaces and the `packages/core/*` subpath exports are already the enforced boundary (`packages/*/package.json` `exports`; `scripts/package-boundary-audit.mjs:6-12`).

Options weighed: flat 40 components under the capability (rejected: loses the workspace boundary the audit already enforces); flipping `.ai/harness/policy.json#context.capability_source` to `archcontext` (rejected: `capabilityRegistryFromArchcontextNodes` skips every node whose `kind !== "capability"` and requires non-empty `responsibilities`, so non-capability docs would become orphan errors); full 46-node expansion (deferred: 44 registry entries means a drift card for every touched subpath in daily work).

## Scope

- In scope: `.archcontext/model/nodes/` node set (21 new nodes + 1 re-parent); the resulting `docs/architecture` projection; 21 new `.ai/context/capabilities.json` registry entries.
- Out of scope: relations beyond the existing one; flows; `source.entrypoints` on new nodes; any `packages/**` source; `scripts/`, `evals/`, `tests/`, `deploy/`, `actions/` (unowned today, unchanged); `.ai/harness/policy.json`; root `CLAUDE.md` / `AGENTS.md`; components for `local-runtime` / `surfaces` / `cloud`; the pre-existing working-tree edit in `docs/architecture/index.md`'s PENDING REQUESTS block and untracked `docs/architecture/requests/root.md` (user WIP; preserve verbatim, and note the contract worktree starts from a clean `main` so neither is present there).

## Allowed Paths

```yaml
allowed_paths:
  # written only by archctx plan/apply ChangeSet:
  - .archcontext/model/nodes/
  - .archcontext/generated/ARCHITECTURE.md
  # written only by archctx docs apply:
  - docs/architecture/
  # written only by repo-harness run capability-config add:
  - .ai/context/capabilities.json
  - tasks/workstreams/architecture-context/
  # plan / contract / notes:
  - plans/plan-<stem>.md
  - tasks/contracts/<stem>.contract.md
  - tasks/reviews/<stem>.review.md
  - tasks/notes/<stem>.notes.md
```

## Node Design

Deterministic rule, no invented modules. `W` = workspace dir under `packages/`; `S` = a `packages/core` subpath export key with a real `src/`.

| nodeId | kind | parent | include | exclude | entrypoints |
|---|---|---|---|---|---|
| `capability.architecture-context` | capability | — | `packages/**/src/**` (unchanged) | `packages/**/test/**` (unchanged) | keep existing, untouched |
| `module.architecture-context.contracts` | module | `capability.architecture-context` | `packages/contracts/src/**` | none | later |
| `module.architecture-context.core` | module | `capability.architecture-context` | `packages/core/**/src/**` | none | later |
| `module.architecture-context.local-runtime` | module | `capability.architecture-context` | `packages/local-runtime/**/src/**` | none | later |
| `module.architecture-context.surfaces` | module | `capability.architecture-context` | `packages/surfaces/**/src/**` | none | later |
| `module.architecture-context.cloud` | module | `capability.architecture-context` | `packages/cloud/**/src/**` | none | later |
| `component.architecture-context.core.<S>` (16 new) | component | `module.architecture-context.core` | `packages/core/<S>/src/**` | none | later |
| `component.architecture-context.projection-renderer` (existing) | component | change `capability.architecture-context` → `module.architecture-context.core` | unchanged `packages/core/projection-engine/src/**` | none | none |

`<S>` for core (from `packages/core/package.json` `exports`, 17 total, `projection-engine` is the existing node, do NOT create a duplicate): `application`, `agent-orchestrator`, `architecture-delta`, `architecture-ledger`, `architecture-domain`, `changeset-engine`, `context-compiler`, `policy-engine`, `practice-catalog`, `practice-engine`, `pressure-engine`, `recommendation-engine`, `reconcile-engine`, `refactor-decision`, `retrieval`, `review-engine`. Re-derive this list from `exports` at execution time; if it differs, the derived list wins and the notes file records the delta.

Every node needs `schemaVersion: archcontext.node/v2`, `id`, `kind`, `name`, `status: active`, `summary` (required by `schemas/repo/architecture-node.schema.json`, `additionalProperties: false`). No `exclude` on new nodes (every `test/` dir is a sibling of `src/`; no `dist`/`build` under `packages/**`).

Overlap: only ancestor/descendant. `globLiteralPrefixLength` gives capability < module < component, so `resolveArchitectureOwnerForPath` returns the deepest node; sibling workspaces/subpaths are disjoint dirs, so no equal-specificity tie is possible.

## Mutation Path

Never touch `.archcontext/*.yaml`, SQLite, WAL, or `docs/architecture/**` with an editor (ADR-0012; ADR-0040). Never run `archctx init` (`initializeArchContextModel` overwrites `manifest.yaml`, `product.yaml`, and the capability node).

Per node, two CLI calls against the same persistent daemon (draft lives in daemon memory):

```
archctx plan  --id changeset.model-split-<n> --path .archcontext/model/nodes/<id>.yaml \
              --expected-hash missing --body "$(cat /tmp/nodes/<id>.yaml)" --json
# read data.draft.base.worktreeDigest from the JSON
archctx apply --id changeset.model-split-<n> --approved \
              --expected-worktree-digest <that digest>
```

Order: 5 module nodes, then 16 core components, then the re-parent of `projection-renderer` (`--expected-hash` = `digestJson({body})` of its current file, obtained from the failing-hash error or from `archctx docs plan --json`'s preview). Staging bodies under `/tmp/nodes/` is authoring, not repo mutation; the ChangeSet engine still enforces the `.archcontext/model/` allowlist, expected-hash, before/after `validateModel`, journal, and rollback.

Generated by the daemon, never authored: `.archcontext/generated/ARCHITECTURE.md` (rebuilt on every apply) and all of `docs/architecture/**` via `archctx docs apply`.

## Steps

1. `git status --short --branch -uall` in the contract worktree; confirm clean start from `main`.
2. Baseline: `archctx validate --json`, `archctx docs drift --json`, `bun run verify`; record results in the notes file.
3. Derive the core `<S>` list from `packages/core/package.json` `exports`; generate the 21 node bodies into `/tmp/nodes/` (deterministic; do not hand-invent names or summaries beyond one factual sentence each).
4. Apply the 5 `module` nodes via plan/apply.
5. Apply the 16 new core `component` nodes via plan/apply.
6. Re-parent `component.architecture-context.projection-renderer` via one plan/apply with its real `--expected-hash`.
7. `archctx validate --json` → `valid: true`.
8. Ownership sweep: for every file under `packages/**/src/`, `archctx resolve --path <f>` must exit 0 (exit 2 = ambiguous → stop).
9. Register the 21 registry entries before projecting: `repo-harness run capability-config add --prefix <include prefix> --id <node-id-with-dashes> --domain architecture-context --name <name> --agents AGENTS.md --claude CLAUDE.md --architecture-module docs/architecture/modules/<node-id-with-dashes>.md --workstream-dir tasks/workstreams/architecture-context/<W>[/<S>] --no-sync-contracts` (dry-run the first one; module-level prefixes are `packages/<W>`, component prefixes are `packages/core/<S>/src`).
10. `archctx docs plan --json` → read `majorChange.reasonCodes` and `majorChange.affectedNodeIds`.
11. `archctx docs apply --approved --id changeset.docs-model-split --accepted-change-set-id changeset.model-split-<last> --accepted-event-id idem_changeset.model-split-<last> --major-reason <each observed code> --affected-node <each observed id>`.
12. `archctx docs drift --json` → `ok: true`; re-run `bun run verify`; `repo-harness run capability-resolver validate`; `repo-harness run check-architecture-sync`.

## Exit Criteria

- `archctx validate --json` → `.data.valid == true`, `errors: []`.
- `archctx docs drift --json` → `.data.ok == true`, `drift.diffs == []`, `rejected == []`.
- `archctx docs plan --json` after apply → `.data.majorChange.mode == "refresh-required"`, not `human-action-required`.
- Every file under `packages/**/src/`: `archctx resolve --path <f>` exits 0; none exits 2.
- `.archcontext/model/nodes/` contains 23 files; `docs/architecture/modules/` contains 23 `.md`.
- `bun run verify` exits 0.
- `repo-harness run capability-resolver validate` → no `orphan architecture module`.
- `repo-harness run check-architecture-sync` → same verdict class as the step-2 baseline.
- `git status --short -- packages` is empty (no source edits).

## Risks & Stop Conditions

- No-workaround clause: a legitimate CLI path exists (`archctx plan` / `archctx apply`; `.archcontext/model/` is on the ALLOWLIST in `packages/core/policy-engine/src/index.ts:35-44`). If any step cannot be done through it, stop and report; never hand-edit YAML, SQLite, WAL, or generated docs.
- `archctx validate` only checks `schemaVersion` (`YamlModelStore.validateModel`), so a dangling `parent` passes validation but makes P1 unprovable and forces `docs plan` into permanent `human-action-required`. Steps 8 and 10 are the real gates.
- `--major-reason` must be a subset of observed reasons or `classifyArchitectureMajorChange` throws; always echo back what step 10 reported.
- `capability-config add` runs `validateRegistry` after every add, so registering after projecting fails on orphan docs. If step 9 must move after step 11, stop.
- 23 members make the capability's P1 mermaid a wide, edge-poor diagram. Cosmetic; flag, do not "fix" by inventing relations.
- `listScaleScanFiles` scans the working tree, not git; run steps 10-11 on a clean tree.
- Stop if `bun run verify` regresses, if any `resolve` returns exit 2, or if `docs plan` reports `rejected`.
- If `capability-resolver validate` requires `responsibilities` on non-capability nodes, stop and report before adding fields.

## Rollback Surface

`git checkout -- .archcontext/ docs/architecture/ .ai/context/capabilities.json tasks/workstreams/` plus `git clean -fd docs/architecture/modules/ tasks/workstreams/architecture-context/` restores everything; all writes are inside the contract worktree, no external state. A failed `apply` self-rolls-back via the ChangeSet journal. Nothing is committed, pushed, or published by this plan.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Execute captured plan: Model adoption: two-level architecture node tree (5 workspace modules + core components)
