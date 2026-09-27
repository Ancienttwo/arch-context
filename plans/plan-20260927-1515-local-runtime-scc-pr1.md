# Plan: Break local-runtime SCC PR-1: ownership drift and structural host ports

> **Status**: Executing
> **Created**: 20260927-1515
> **Slug**: local-runtime-scc-pr1
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User approved option 1 (PR-1 now, PR-2 and scan precision deferred) on 2026-09-27
> **Verification Boundary**: Pinned Bun typecheck, boundary audit, 14 baseline test files, export-count probe, packaged smoke, post-commit refactor scan, hosted CI
> **Rollback Surface**: git revert plus inverse ChangeSet; no SQLite, wire or subpath-name change
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md`
> **Task Review**: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md`
> **Implementation Notes**: `tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260927-1515-local-runtime-scc-pr1.md`
- Sprint contract: `tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md`
- Sprint review: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md`
- Implementation notes: `tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260927-1515-local-runtime-scc-pr1.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260927-1515-local-runtime-scc-pr1.md`.

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
- Contract file: `tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md`
- Review file: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md`
- Implementation notes file: `tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260927-1515-local-runtime-scc-pr1.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: git revert plus inverse ChangeSet; no SQLite, wire or subpath-name change
- **Verification boundary**: Pinned Bun typecheck, boundary audit, 14 baseline test files, export-count probe, packaged smoke, post-commit refactor scan, hosted CI
- **Review/acceptance boundary**: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User approved option 1 (PR-1 now, PR-2 and scan precision deferred) on 2026-09-27

## Evidence Contract

- **State/progress path**: `plans/plan-20260927-1515-local-runtime-scc-pr1.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md`, `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md`, and `tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: git revert plus inverse ChangeSet; no SQLite, wire or subpath-name change

## Captured Planning Output

# Break local-runtime SCC, PR-1: ownership drift and structural host ports

## Authority and goal
The user approved option 1 on 2026-09-27: land PR-1 now, and record PR-2 (moving RPC argument/result types into the rpc-client component's `rpc-methods.ts` and `developer-review-codec.ts`) plus the scan precision question (type-only vs value edges, re-export and `typeof import()` coverage) as deferred goals in `tasks/todos.md`. Source: daemon recommendation `recommendation.5377a3da596dedcd` (cycle, SCC `scc.50085af2f3acf4b2`, 12 members / 39 cycle edges at 331c526). This work targets 0.5.13+ and does not touch the pending 0.5.12 publication (tarballs were built from 331c526).

## P1 architecture map
The SCC spans `module.architecture-context.local-runtime` plus 11 components under `packages/local-runtime/runtime-daemon/src`. Edges come from `repositoryImportPairs` (`packages/local-runtime/codegraph-adapter/src/index.ts:1045`): every `import` statement including `import type`; re-exports and `typeof import()` are not counted. Ownership picks the deepest node; `runtime-daemon` is a catch-all glob (`runtime-daemon/src/**` minus 18 excludes), so unregistered shared helpers default to it. Hub: runtime-daemon (9 incoming cycle edges) because it owns shared helpers (egress-admission, loopback-auth, audit-consent, github-issue-executor, investigation-transport, refactor-recording's v3 planner) and because `index.ts` hosts types services import back. No file-level runtime cycle exists (Bun.build metafile check).

## P2 concrete trace
`archctx docs plan` → CLI `RuntimeRpcClient` (main.ts:2896) → `RUNTIME_RPC_METHODS` (rpc-methods.ts imports arg types from projection-service/index) → rpc-server dispatch (rpc-server.ts:324) `Reflect.apply` on a target typed `Pick<ArchctxDaemon,…>` → `ArchctxDaemon.docsProjection` → projection-service with `ProjectionServiceHost` (`Pick<RuntimeDaemonClient,…>` plus hidden `typeof import("./index")` at projection-service.ts:34) → `planUpdate` → ChangeSet engine.

## P3 decision
Fix the real ownership drift and facade-typed host ports; defer the pure type relocation (PR-2) until the product decides whether type-only imports count as dependencies. Reuse existing patterns: leaf directory + component (process-liveness, 081b2be), structural context ports (AgentJobContext, ProjectionApplyContext, LedgerAdminContext). No new abstraction. Invariants: all 15 `packages/local-runtime/package.json` subpath names unchanged (only the `./egress-admission` target moves); runtime export counts runtime-daemon 34 / root barrel 133 / runtime-rpc-client 5 / egress-admission 7; every public type name still exported from `./runtime-daemon`; `RUNTIME_RPC_METHODS`, `RUNTIME_RPC_VERSION`, rpc wire baseline unchanged; v3 migration event bytes unchanged; model YAML changes only through ChangeSet (`scripts/apply-model-proposal.ts`), applied by the orchestrator, never by a subagent. 10x pressure point: catch-all ownership silently re-absorbing new helpers.

## Allowed paths
packages/local-runtime/egress-admission/src/index.ts
packages/local-runtime/runtime-daemon/src/egress-admission.ts
packages/local-runtime/package.json
packages/local-runtime/src/index.ts
packages/local-runtime/runtime-daemon/src/agent-jobs.ts
packages/local-runtime/runtime-daemon/src/external-documentation.ts
packages/local-runtime/runtime-daemon/src/developer-review-run.ts
packages/local-runtime/runtime-daemon/src/rpc-server.ts
packages/local-runtime/runtime-daemon/src/index.ts
packages/local-runtime/runtime-daemon/src/ledger-admin.ts
packages/local-runtime/runtime-daemon/src/projection-service.ts
packages/local-runtime/runtime-daemon/src/refactor-recording.ts
packages/local-runtime/runtime-daemon/test/egress-admission.test.ts
packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts
docs/runbooks/local-egress-policy.md
.archcontext/**
docs/architecture/**
bun.lock
tasks/todos.md
plans/plan-*-local-runtime-scc-pr1.md
tasks/contracts/*-local-runtime-scc-pr1.contract.md
tasks/reviews/*-local-runtime-scc-pr1.review.md
tasks/notes/*-local-runtime-scc-pr1.notes.md
tasks/current.md
tasks/workflow-state.yaml

## Verification boundary
Pinned Bun 1.4.0: `bun run typecheck`, `node scripts/package-boundary-audit.mjs`, the 14 baseline test files (runtime-daemon tests for agent-jobs, audit, developer-review-run, external-documentation, ledger-admin, explorer-server, projection-apply, rpc-server, rpc-client, rpc-methods, refactor-recording, egress-admission; context7-adapter egress-admission; local-store-sqlite recommendation-v3-migration; baseline 226 pass), export-count probe (34/133/5/7), `archctx validate`, `node scripts/packaged-cli-smoke.mjs`; after commit with a fresh CodeGraph index, `archctx refactor scan --json` must show complete coverage, no truncation, unresolvedImportCount not above baseline, and a reduced SCC (simulation predicts 10 members, ~22 edges). Scan acceptance is not just coverage/truncation: record the SCC member set and the file-level cross-owner edge diff between the 331c526 baseline scan and the post-commit scan under the same CodeGraph version and resolver; every removed edge must map to a planned change (file move, re-ownership or removed import), and unowned / multiply-owned path counts must not increase. Public API fidelity: sorted runtime export-name sets of runtime-daemon, root barrel, runtime-rpc-client and egress-admission entries unchanged, and every public type name previously exported from `./runtime-daemon` still exported. Probe scripts live outside the repo (/tmp) and their outputs are recorded in the notes. Hosted CI must pass on the PR head.

## Rollback surface
Code: `git revert` of the PR. Model: inverse ChangeSet via `scripts/apply-model-proposal.ts`, never hand-edited YAML. No SQLite, wire protocol or subpath-name changes.

## Task Breakdown
- [x] T1 egress-admission leaf: `git mv` runtime-daemon/src/egress-admission.ts → packages/local-runtime/egress-admission/src/index.ts unchanged; retarget package.json `./egress-admission` and `src/index.ts` re-export; point egress-admission.test.ts at the subpath; update runbook path.
- [x] T2 model ChangeSet (orchestrator only): create component egress-admission (mirroring process-liveness); add loopback-auth.ts to rpc-server include; add audit-consent.ts, github-issue-executor.ts, investigation-transport.ts to audit include; add those four files to runtime-daemon excludes — all in ONE ChangeSet (includes and excludes together, each YAML path at most once, no scannable intermediate state); assert each of the 5 re-owned files has exactly one owner; `archctx validate`; reconcile generated docs through the owner.
- [x] T3 structural host ports: agent-jobs, external-documentation, developer-review-run, rpc-server stop importing `./index` types; move `RuntimeArchitectureLedger*` types into ledger-admin.ts with type re-export from index.ts; replace projection-service.ts:34 `typeof import("./index")` with an explicit function type.
- [x] T4 move the v3 migration planner cluster (event type constant, plan type, planRecommendationV3Migration, latestRecommendationsById, upcastRecommendationToV3) from refactor-recording.ts into ledger-admin.ts unchanged, with a private local `digestSuffix` copy (do not import it back from refactor-recording); before moving, add a fixed-input assertion in recommendation-v3-migration.test.ts comparing the complete migration event JSON (eventId, inputDigest, idempotencyKey, ordering, time fields) against the pre-move output; update imports including the local-store-sqlite test.
- [ ] T5 verification, export-count and sorted export-name-set probes (plus public type-name probe for `./runtime-daemon`) against the 331c526 baseline, re-scan after commit with SCC member diff and file-level edge diff explaining every removed edge; record PR-2 and scan-precision deferred goals in tasks/todos.md; gatekeeper review; PR.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] T1 egress-admission leaf: `git mv` runtime-daemon/src/egress-admission.ts → packages/local-runtime/egress-admission/src/index.ts unchanged; retarget package.json `./egress-admission` and `src/index.ts` re-export; point egress-admission.test.ts at the subpath; update runbook path.
- [x] T2 model ChangeSet (orchestrator only): create component egress-admission (mirroring process-liveness); add loopback-auth.ts to rpc-server include; add audit-consent.ts, github-issue-executor.ts, investigation-transport.ts to audit include; add those four files to runtime-daemon excludes — all in ONE ChangeSet (includes and excludes together, each YAML path at most once, no scannable intermediate state); assert each of the 5 re-owned files has exactly one owner; `archctx validate`; reconcile generated docs through the owner.
- [x] T3 structural host ports: agent-jobs, external-documentation, developer-review-run, rpc-server stop importing `./index` types; move `RuntimeArchitectureLedger*` types into ledger-admin.ts with type re-export from index.ts; replace projection-service.ts:34 `typeof import("./index")` with an explicit function type.
- [x] T4 move the v3 migration planner cluster (event type constant, plan type, planRecommendationV3Migration, latestRecommendationsById, upcastRecommendationToV3) from refactor-recording.ts into ledger-admin.ts unchanged, with a private local `digestSuffix` copy (do not import it back from refactor-recording); before moving, add a fixed-input assertion in recommendation-v3-migration.test.ts comparing the complete migration event JSON (eventId, inputDigest, idempotencyKey, ordering, time fields) against the pre-move output; update imports including the local-store-sqlite test.
- [ ] T5 verification, export-count and sorted export-name-set probes (plus public type-name probe for `./runtime-daemon`) against the 331c526 baseline, re-scan after commit with SCC member diff and file-level edge diff explaining every removed edge; record PR-2 and scan-precision deferred goals in tasks/todos.md; gatekeeper review; PR.
