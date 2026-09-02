# Implementation Notes: model-adoption-core-two-level

> **Status**: Active
> **Plan**: plans/plan-20260903-0026-model-adoption-core-two-level.md
> **Contract**: tasks/contracts/20260903-0026-model-adoption-core-two-level.contract.md
> **Review**: tasks/reviews/20260903-0026-model-adoption-core-two-level.review.md
> **Last Updated**: 2026-09-03 00:26
> **Lifecycle**: notes

## Design Decisions

- Derived the core subpath list from `packages/core/package.json` `exports` at execution time: 17 keys with a real `src/` (`agent-orchestrator`, `application`, `architecture-delta`, `architecture-domain`, `architecture-ledger`, `changeset-engine`, `context-compiler`, `policy-engine`, `practice-catalog`, `practice-engine`, `pressure-engine`, `projection-engine`, `recommendation-engine`, `reconcile-engine`, `refactor-decision`, `retrieval`, `review-engine`). The derived list is identical to the contract's expected list: 16 new components plus the existing `projection-engine` node. Zero delta.
- The `.` export (`./src/index.ts` -> `packages/core/src/`) is the workspace root export, not a subpath; it stays owned by `module.architecture-context.core` because `globToRegExp` expands `**/` to `(?:.*/)?` (zero segments allowed), so `packages/core/**/src/**` matches `packages/core/src/index.ts`. Verified: `archctx resolve --path packages/core/src/index.ts` -> `module.architecture-context.core`.
- All 22 model writes went through `archctx plan` + `archctx apply` ChangeSets (`changeset.model-split-1` .. `changeset.model-split-22`), one node per ChangeSet, with `--expected-hash missing` for the 21 new files and the real `digestJson({body})` hash `sha256:be4b27ca2d3f4f3ff40bbbd25d7ea726059ebfb99f2d4dfcd38e51f35be33ddf` for the `projection-renderer` re-parent. Bodies were staged under `/tmp/nodes/`; nothing under `.archcontext/`, SQLite/WAL, or `docs/architecture/` was hand-edited.
- Registry entries use the existing `.ai/context/capabilities.json` conventions: dotted node id with dashes as `id`, trailing segment as `name`, `domain: architecture-context`, root `AGENTS.md`/`CLAUDE.md`, `lsp_profile: typescript-lsp`, and the two existing verification hints (`bun run verify`, `bun run typecheck`) rather than the helper's placeholder default.

## Baseline (clean `main` @ ca2c8e5, before any change)

- `archctx validate --json` -> `valid: true`, `modelDigest sha256:51303677...`.
- `archctx docs drift --json` -> `ok: false`, single diff `docs/architecture/.projection-manifest.json` / `projection-manifest-stale`. Pre-existing on committed `main`; not introduced by this task.
- `repo-harness run capability-resolver validate` -> `[CapabilityResolver] OK` (exit 0).
- `repo-harness run check-architecture-sync` -> `mode=advisory ... blocking=0`, `[ArchitectureProjection] ... blocking=0 uncommitted=0` (exit 0).

## Observed major-change reference (echoed back verbatim)

`archctx docs plan --json` before projection reported `majorChange.mode = human-action-required` with `reasonCodes`: `constraint-changed`, `entrypoint-changed`, `interface-changed`, `lifecycle-changed`, `node-added`, `node-moved`, `node-renamed`, `ownership-changed`, `responsibility-changed`, `risk-boundary-changed`, `verified-flow-proof-changed`; and 22 `affectedNodeIds` (the 21 new/re-parented nodes plus `capability.architecture-context`). All 11 codes and all 22 ids were echoed back on `archctx docs apply --approved --id changeset.docs-model-split --accepted-change-set-id changeset.model-split-22 --accepted-event-id idem_changeset.model-split-22`, which returned `status: applied`, `majorChange.mode: refresh-required`. `rejected` stayed empty throughout.

## Deviations From Plan Or Spec

- **Two `docs apply` runs, not one.** After the first (accepted-reference) apply, `archctx docs drift --json` still reported `projection-manifest-stale` — the same pre-existing baseline condition, because the manifest records the worktree/CodeGraph digests measured before the projection files were written. A second `archctx docs apply --approved --id changeset.docs-model-split-2` (no accepted-change flags needed; `majorChange.mode` was already `none`) reached the fixed point and drift went `ok: true`, `diffs: []`. Committed `main` is left in the un-converged state; this branch converges it.
- **[RESOLVED by orchestrator directive, 2026-09-03] Test-fixture `src/` dirs are no longer owned.** Orchestrator ruled that the five module nodes must mirror the capability's test exclusion so ownership stays consistent up the tree. Applied `source.exclude` via five ChangeSets, real `--expected-hash` each, every other field byte-identical: `changeset.model-split-23` contracts (`packages/contracts/test/**`), `-24` core, `-25` local-runtime, `-26` surfaces, `-27` cloud (each `packages/<W>/**/test/**`). Re-projected with `changeset.docs-model-split-3` (echoing the observed `ownership-changed` / `capability.architecture-context`) then `changeset.docs-model-split-4` for the fixed point; `archctx docs drift --json` -> `ok:true, diffs:[], rejected:[]`. All three fixture files now return `matched:false, ambiguous:false` (CLI exit 1 = no-match, not exit 2 = ambiguous). Falsifier pair still returns two distinct unambiguous components.
- **RESOLVED (orchestrator, 2026-09-03):** the ownership sweep pathspec in the contract was narrowed to `git ls-files -- 'packages/*/src/**' 'packages/*/*/src/**' ':!:packages/*/*/test/**' ':!:packages/*/test/**'`, so test fixture trees are no longer part of the sweep. Re-run: 70 files, all exit 0; `verify-contract --strict` → `total=23 failed=0 status=Fulfilled`. The module-level `exclude` decision and the exit criterion are consistent.
- **[superseded] Test-fixture `src/` dirs were owned.** The plan asserted "every `test/` dir is a sibling of `src/`", so the new module nodes carry no `exclude`. That assertion is false for three tracked files: `packages/surfaces/cli/test/fixtures/monorepo-basic/packages/{lib,web}/src/*` and `packages/surfaces/cli/test/fixtures/single-repo-basic/src/index.ts`. They previously resolved to no-match (the capability node excludes `packages/**/test/**`); they now resolve to `module.architecture-context.surfaces`, because `exclude` is evaluated per node, not inherited from the parent. I followed the contract literally (includes only, no `exclude` on new nodes) and did not invent an exclude — adding one is a scope decision for the orchestrator. Nothing in the exit criteria or `bun run verify` depends on those three files staying unowned.
- No workstream directories were created: `capability-config add` only writes them under `--create-workstream`, which the plan's step 9 command does not pass. The registry entries reference `tasks/workstreams/architecture-context/<W>[/<S>]` and `capability-resolver validate` passes without the directories existing.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| `exclude: packages/**/test/**` on the 5 module nodes | Not added | Contract Goal specifies `source.include` only; changing test-file ownership is a scope decision, recorded above instead |
| Re-create vs. re-parent `projection-renderer` | Re-parent via one `create_entity` ChangeSet with the real expected hash | Avoids a duplicate node for `projection-engine`; the file diff is the single `parent:` line plus a trailing newline |
| One ChangeSet for all 22 nodes vs. one per node | One per node | The worktree digest changes after every apply, so each apply needs its own fresh `plan`; per-node ChangeSets also give per-node rollback |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
