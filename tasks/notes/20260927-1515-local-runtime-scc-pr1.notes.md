# Implementation Notes: local-runtime-scc-pr1

> **Status**: Active
> **Plan**: plans/plan-20260927-1515-local-runtime-scc-pr1.md
> **Contract**: tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md
> **Review**: tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md
> **Last Updated**: 2026-09-27 15:20
> **Lifecycle**: notes

## Design Decisions

- Dual-track planning (Opus deep-reasoner + Codex, blind) agreed on the measured graph (12 members / 39 cycle edges, minimum cut 11, hub runtime-daemon) and on egress-admission as the first lever; they diverged on doing the full refactor. User chose PR-1 now; PR-2 and scan edge precision are deferred in `tasks/todos.md`.
- Peer Codex (herdr pane) plan review returned GO-WITH-CHANGES; all five points were folded into the plan/contract (single ChangeSet, per-file owner assertion, local `digestSuffix` + full event JSON guard, export name-set probe, deferred-goal wording).
- T2 ChangeSet `changeset.local-runtime-scc-pr1` applied by the parent via `scripts/apply-model-proposal.ts`: proposal `sha256:e5607abb2c864763c65f9b0c8235173b316847d3b438ba6a9392d5ee665bed03`, preview worktree `sha256:430ec013500a40aa0c544fd0fc493f174132415361fd4bcec655e4eb812e070f`, 4 operations, `archctx validate` valid (model `sha256:7c87eed73cb5528ef5e4d2678ee09b61c85dc21837eb8b14f776027ae5c3052d`).

## Deviations From Plan Or Spec

- Export fidelity probe: TypeScript 7.0.2 exposes no classic checker API, so the type-name probe used a syntactic top-level export extractor on the 331c526 baseline and the candidate, plus `git diff` proof that the 10 untouched re-exported sub-modules of the root barrel are byte-identical. Runtime `Object.keys` counts 34/133/5/7 and name sets are identical.
- `egress-admission.test.ts` imports the leaf by relative path, matching that test file's existing sibling-package convention.
- `tsconfig.json` added to allowed paths (precedent 081b2be) for the new subpath mapping.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| ... | ... | ... |

## Open Questions

- None.

## Evidence Links

- Worker verification (pinned Bun 1.4.0): typecheck clean; package boundary audit passed (5 workspaces); 14 affected test files 227 pass / 0 fail (baseline 226 + new full v3 migration event guard); `node scripts/packaged-cli-smoke.mjs` OK.
- Official scan at 42363e4 (`bun packages/surfaces/cli/src/main.ts refactor scan --json`): coverage complete, truncated false, SCC `scc.cd1c0fb7a216355a` with 10 members (audit, developer-review-run, explorer-server, external-documentation, ledger-admin, projection-apply, projection-service, rpc-client, rpc-server, runtime-daemon), crossModuleCycleCount 39 → 22, unresolvedImportCount 1073 → 1073.
- Offline reconstruction with the repo's own `resolveOwnership`/`buildModuleGraph` (baseline data from a detached 331c526 worktree, same CodeGraph 1.5.0): 17 owner pairs removed, 0 added. Removed pairs map to T1 (`MODULE → runtime-daemon`; the 10 `X → MODULE` pairs and `runtime-daemon → agent-jobs` still exist but are no longer cyclic), T2 (loopback-auth re-owned: explorer-server/rpc-server → runtime-daemon) and T3 (`./index` type imports removed from agent-jobs, developer-review-run, external-documentation, rpc-server). CodeGraph import nodes 2209 → 2204.
- Ownership: egress-admission/src/index.ts → egress-admission; loopback-auth.ts → rpc-server; audit-consent.ts, github-issue-executor.ts, investigation-transport.ts → audit; multiply-owned 0 → 0; the only new unowned path is the new model node YAML (all 50 existing model YAMLs are unowned by design).
- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
