# Plan: Sprint task: rf5a-cli-rpc-capabilities-0.5.0

> **Status**: Archived
> **Created**: 20260903-0909
> **Slug**: rf5a-cli-rpc-capabilities-0-5-0
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf5a-cli-rpc-capabilities-0.5.0
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md`; after execution revert branch `codex/rf5a-cli-rpc-capabilities-0-5-0` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md`
> **Task Review**: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf5a-cli-rpc-capabilities-0.5.0
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md`
- Sprint contract: `tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md`
- Sprint review: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md`
- Implementation notes: `tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md`.

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
- Contract file: `tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md`
- Review file: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md`
- Implementation notes file: `tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md`; after execution revert branch `codex/rf5a-cli-rpc-capabilities-0-5-0` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: daemon RPC + CLI verb + capabilities + repo-wide version bump with smoke coverage; one mergeable unit whose verification boundary is bun run verify and the packaged-cli smoke.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md`, `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md`, and `tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md`; after execution revert branch `codex/rf5a-cli-rpc-capabilities-0-5-0` or the explicitly reviewed diff.

## Captured Planning Output

## Goal
Expose `archctx refactor scan|record` through new `refactorScan` / existing `refactorRecord` RPC, add `module-statistics-v1`, `refactor-assessment-v1`, `recommendation-v3` to `ARCHCTX_FEATURES`, and bump the product to `0.5.0` with `bun run verify` green.

## Why
RF1b/RF2 measure and classify, RF3 records, but nothing reaches a caller: no RPC composes snapshot→assessment→registry, and repo-harness fails closed on a missing feature. `0.5.0` is a minor bump solely because RF3 rewrites persisted recommendations (PRD §0.3 item 14).

## Scope
**In** — daemon `refactorScan` (new `refactor-scan.ts`); `readHeadCommitterDate` in git-adapter; CLI `refactor` verb + help; `ARCHCTX_FEATURES` + capabilities schema/fixture; full 0.5.0 pin sweep; `packaged-cli-smoke` coverage; 0.5.0 release checklist skeleton.
**Out** — `refactorVerify` / `refactor-resolution-v1` (RF5b); any MCP tool (PRD Non-goals); `packages/contracts/src/refactor.ts` and `ledger.ts` (frozen RF1a); `packages/core/module-statistics|refactor-assessment` logic; RF0 baseline fixtures; `.archcontext/**`; the npm publish itself (row 7).

## Allowed Paths
```yaml
allowed_paths:
  - packages/contracts/src/projection.ts
  - packages/contracts/src/product-version.ts
  - packages/contracts/package.json
  - packages/contracts/fixtures/valid/archctx-capabilities.json
  - packages/contracts/fixtures/valid/product-version-manifest.json
  - schemas/runtime/archctx-capabilities.schema.json
  - packages/core/practice-catalog/assets/catalog.yaml
  - packages/local-runtime/git-adapter/src/index.ts
  - packages/local-runtime/runtime-daemon/src/refactor-scan.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - scripts/packaged-cli-smoke.mjs
  - package.json
  - packages/{core,local-runtime,surfaces,cloud}/package.json
  - bun.lock
  - actions/review-action/action.yml
  - deploy/release-checklists/archctx-0.5.0.md
  - docs/spec.md
  - docs/runbooks/personal-user-install.md
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/architecture/**   # regeneration only, via `docs apply --approved`
```
Deny: `packages/contracts/src/{refactor,ledger}.ts`, `packages/core/{module-statistics,refactor-assessment}/**`, `**/test/fixtures/refactor-baseline/**`, `.archcontext/**`, `packages/cloud/**` except its manifest version.

## File Changes
| File | Change |
|---|---|
| `git-adapter/src/index.ts` | `export function readHeadCommitterDate(root)` = `new Date(runGit(root,["show","-s","--format=%cI","HEAD"]).trim()).toISOString()`. None exists today. |
| `runtime-daemon/src/refactor-scan.ts` (new; only new file) | `runRefactorScan({root, request, …})`: identity → tracked files → workspace packages → `repositoryImportPairs` → `buildModuleStatisticsSnapshot` → `assessRefactor` → `registerRefactorAssessment` → envelope. |
| `runtime-daemon/src/index.ts` | `refactorScan` on daemon + `RuntimeDaemonClient` + `RuntimeRpcClient` + `dispatch` (`:5656-5749`); add `"refactorScan"` to `RUNTIME_RPC_LONG_METHODS` (`:5160-5163`). |
| `cli/src/main.ts` | `case "refactor":` → `runRefactorCommand`; add `"refactor"` to help `commands` and one example (`:517`). |
| `contracts/src/projection.ts:58-64` | Insert the three features, sorted `as const`. |
| `schemas/runtime/archctx-capabilities.schema.json:42` | Extend the `enum` to the same 8 values. |
| `contracts/fixtures/valid/archctx-capabilities.json:3,13` | Version `0.5.0` + 8 features. |
| `contracts/fixtures/valid/product-version-manifest.json:5,15,20,26,33` | 5× `0.5.0`. |
| `product-version.ts:2`, 6 `package.json`, `catalog.yaml:4` | `0.5.0`; then regenerate `catalog.yaml` — `catalogDigest` hashes `productVersion` (`practice-catalog/src/index.ts:183-193`). |
| `actions/review-action/action.yml:21,23` | `0.5.0` (0.4.7/0.4.6 precedent). |
| `packaged-cli-smoke.mjs` | `git init`/commit the temp repo, then `refactor scan` (see decisions). |

## Design Decisions
**(a) Deterministic identity, not a clock.** `RefactorRequestV1` carries no `requestId` (`refactor.ts:166-173`), and both `snapshot.createdAt` and `assessment.createdAt` are emitted in the envelope though excluded from their digests. So the daemon derives `requestId = refactor_request.${digestJson(request).slice(7,23)}` and sets `createdAt` for both to the HEAD committer date. Epoch-0 (the `projection run` precedent, `main.ts:1266`) is deterministic but false; the committer date is deterministic *and* honest about which commit was measured. This is what makes acceptance script 1 pass.

**(b) One `trackedFiles` array, computed inside the daemon.** `assessRefactor` takes `trackedFiles` unbound to the snapshot (`refactor-assessment/src/index.ts:45-58`); RF3's gatekeeper carry-over requires the same array feed `buildModuleStatisticsSnapshot` and `assessRefactor`. `refactorScan` calls `readTrackedSourceFiles(root)` once and derives `trackedFiles.map(f => f.path)` from it. No external caller can supply a divergent list.

**(c) Fail-closed mapping.** `.archcontext` model unloadable ⇒ `AC_MODEL_ADOPTION_REQUIRED`; `request.expectedHeadSha`/`expectedWorktreeDigest` present and ≠ current ⇒ `AC_REFACTOR_STALE` (both are optional, so absence is not an error); `refactorRequestInvariantIssues` non-empty or `assessRefactor` throwing ⇒ `AC_SCHEMA_INVALID`. All four codes already exist (`contracts/src/schema.ts:32-35,73-76`).

**(d) `--request-json` is optional.** PRD acceptance script 1 is `refactor scan --json` with no flag, so the CLI synthesizes `{schemaVersion, scope:{kind:"repository"}}` when absent. Parsing mirrors `projection run` (`main.ts:1256-1263`): `readFlag` → `JSON.parse` → invariant check → `AC_SCHEMA_INVALID` on failure. `refactor record` is `--assessment-digest`/`--expected-worktree-digest`/`--selection` straight into `refactorRecord`. No `refactor` entry in `LOCAL_MCP_TOOLS`.

**(e) Smoke fixture: git-init the existing temp repo, last.** The smoke repo is `mkdtempSync` with `codegraph init` but **no git** (`packaged-cli-smoke.mjs:17-26`), so `readTrackedSourceFiles` (`git ls-tree HEAD`) would fail. Inserting `git init` + `git -c user.email=… -c user.name=… commit` *after* the last `apply` and before the final `daemon stop` avoids perturbing the earlier `worktreeDigest` equality assertions (`:196`), and `refactor scan` then measures the two applied nodes with `coverage: unknown` (index predates the commit). A second repo would double the smoke's runtime for no extra coverage.

**(f) The row's `rg` acceptance as written can never pass.** `rg '0\.4\.8' --glob '!CHANGELOG*' --glob '!docs/**'` still matches `deploy/release-checklists/archctx-0.4.8.md`, archived `plans/`+`tasks/` records, and (verified) 16 live code pins. Use the scoped form in Exit Criteria; the historical files are the 0.4.8 checklist's own documented exception (`archctx-0.4.8.md:17-20`).

**(g) Budgets: no docs churn.** local-runtime is 20,068 lines / 11 src files against `20k–50k` / `10–20` (`module-architecture-context-local-runtime.md:25`) — RF3 adds one file, RF5a one more → 13. Surfaces is 6,015 / 12 against `5000–10000` / `10–20` (`module-architecture-context-surfaces.md:25`); +~250 lines does not flip it. `privacy-route-audit` scans neither tree (`privacy-route-audit.mjs:6-18`), so no fragment splicing. `refactor-scan.ts` must not import `MockCodeGraphProvider`/`TestLocalStore` (`production-mock-reachability-audit.mjs:9-13`).

## Steps
1. git-adapter: `readHeadCommitterDate`.
2. `refactor-scan.ts`: compose identity → tracked files → workspace packages → import pairs → snapshot → `assessRefactor` → `registerRefactorAssessment`; return `{snapshot, assessment, proposal?, proposedRecommendations}`.
3. Daemon: `refactorScan` on interface/client/dispatch; add to `RUNTIME_RPC_LONG_METHODS`.
4. Write `refactor-scan.test.ts` (happy, stale, model-missing, invariant, same-`trackedFiles` binding, two calls byte-identical).
5. CLI `runRefactorCommand` for `scan` and `record`; help `commands` + one example.
6. CLI test: `refactor scan` envelope shape; `refactor` present in help.
7. `ARCHCTX_FEATURES` + capabilities schema enum + capabilities fixture features.
8. Bump `product-version.ts`, 6 manifests, `bun install` to refresh `bun.lock`, `product-version-manifest.json`, `catalog.yaml` `productVersion`.
9. Regenerate `catalog.yaml` so `catalogDigest` matches; confirm via `bun run record:s6:catalog && bun run readback:s6:catalog`.
10. `actions/review-action/action.yml`, `docs/spec.md`, `docs/runbooks/personal-user-install.md`, both `docs/examples/*.yml`.
11. Add the two `refactor scan` calls + `git init`/commit to `packaged-cli-smoke.mjs`.
12. Draft `deploy/release-checklists/archctx-0.5.0.md` from the 0.4.8 template (unticked).
13. `bun run typecheck`, `node scripts/package-boundary-audit.mjs`, `node scripts/production-mock-reachability-audit.mjs`.
14. `docs plan --json` → `docs apply --approved` to fixed point → `docs drift --json` → `bun run verify`.

## Exit Criteria
- `bun run typecheck` → exit 0; `node scripts/package-boundary-audit.mjs` → passed; `node scripts/production-mock-reachability-audit.mjs` → exit 0.
- `bun test packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts` → 0 fail.
- `bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts` → 0 fail (RF3 intact).
- `bun test packages/surfaces/cli/test/cli.test.ts` → 0 fail.
- `bun test packages/contracts/test/contracts.test.ts` → 0 fail (fixture ⇔ schema ⇔ `ARCHCTX_FEATURES` sorted, `:445-450`).
- `bun test packages/core/practice-catalog/test/practice-catalog.test.ts` → 0 fail (`catalog.manifest` deep-equals `catalog.yaml`).
- `bun test packages/core/module-statistics/test/snapshot.test.ts` and `packages/core/refactor-assessment/test/scale.test.ts` → 0 fail.
- `bun packages/surfaces/cli/src/main.ts capabilities --json | jq -r '.features[]'` → the 8 sorted features; `.package.version` = `0.5.0`.
- `bun packages/surfaces/cli/src/main.ts help | jq -r '.data.commands[]' | grep -c '^refactor$'` → `1`; `… | jq '.data.commands | length'` → `42`.
- `for i in 1 2; do bun packages/surfaces/cli/src/main.ts refactor scan --json > /tmp/scan-$i.json; done; cmp /tmp/scan-1.json /tmp/scan-2.json` → exit 0.
- `bun packages/surfaces/cli/src/main.ts refactor record --assessment-digest <d> --expected-worktree-digest <w>` twice → second envelope contains `duplicate-active-fingerprint`.
- `rg -n --fixed-strings '0.4.8' --glob '!CHANGELOG*' --glob '!docs/**' --glob '!deploy/**' --glob '!plans/**' --glob '!tasks/**' --glob '!.claude/**'` → no output.
- `bun packages/surfaces/cli/src/main.ts docs plan --json` → zero owned drift after `docs apply --approved`.
- `git status --short -- .archcontext packages/contracts/src/refactor.ts packages/contracts/src/ledger.ts` → empty.
- `bun run verify` → exit 0.

## Risks & Stop Conditions
- **RF3 not merged.** `registerRefactorAssessment` and `refactorRecord` are RF3-owned. If row 5 has not landed, stop — do not stub them.
- **Determinism failure.** If two scans differ, diff the JSON and fix the *source* of nondeterminism; never post-process or sort the envelope in the CLI.
- **Smoke timeout.** `PROCESS_TIMEOUT_MS` is 30s off-Windows (`packaged-cli-smoke.mjs:10`); if `refactor scan` exceeds it, reduce the smoke fixture rather than raising the global timeout for everything.
- **`catalog.yaml` parity.** If `practice-catalog.test.ts` fails after the bump, the file was not regenerated — do not edit the digest by hand.
- **`docs plan` reports `human-action-required`** ⇒ stop and report; do not force-apply.
- **Parallel-session race.** `plans/`, `tasks/`, `docs/architecture/index.md` are contested (index.md is already dirty on main); `git status` + `git log` before touching workflow files.

## Rollback Surface
`git checkout -- packages/contracts packages/local-runtime packages/surfaces packages/core/practice-catalog/assets schemas package.json bun.lock actions docs && rm -f packages/local-runtime/runtime-daemon/src/refactor-scan.ts packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts deploy/release-checklists/archctx-0.5.0.md`. Nothing is published and no database is migrated by this row, so revert is total.

---

## Task Breakdown

- [ ] git-adapter readHeadCommitterDate
- [ ] runtime-daemon refactor-scan.ts + refactorScan RPC/client/dispatch (LONG timeout)
- [ ] CLI refactor scan|record + help; NOT in MCP
- [ ] ARCHCTX_FEATURES + capabilities schema/fixture
- [ ] 0.5.0 pin sweep (product-version, manifests, catalog.yaml regen, action.yml, docs, examples), release checklist skeleton
- [ ] packaged-cli-smoke covers refactor scan (git-init the smoke repo last)
- [ ] tests: refactor-scan.test.ts, cli.test.ts, contracts/practice-catalog suites; determinism (two scans byte-identical; record twice ⇒ duplicate-active-fingerprint)
- [ ] typecheck, boundary + mock-reachability audits, docs plan/apply fixed point, bun run verify
- [ ] `repo-harness run verify-contract --contract tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md --strict`
