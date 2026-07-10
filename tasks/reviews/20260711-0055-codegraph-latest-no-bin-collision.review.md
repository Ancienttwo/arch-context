# Task Review: codegraph-latest-no-bin-collision

> **Status**: Complete
> **Plan**: plans/plan-20260711-0055-codegraph-latest-no-bin-collision.md
> **Contract**: tasks/contracts/20260711-0055-codegraph-latest-no-bin-collision.contract.md
> **Recommendation**: pass

## Human Review Card

- Verdict: pass
- Change type: code-change
- Intended files changed: runtime CodeGraph authority/adapter, generated npm packaging/readbacks, focused tests, and contract artifacts
- Actual files changed: matches contract `allowed_paths`; historical evidence remains unchanged, while the current `0.2.3` npm dry-run evidence is regenerated
- Commands passed: focused tests, typecheck, current npm dry-run, installed-tarball smoke, full `bun run verify`, and the pre-expansion strict contract/sprint gate
- External acceptance: user explicitly authorized npm publication, Git tag, and GitHub Release; npm Web authorization completed as account `ancienttwo`
- Residual risks: supplemental explore Markdown parser and Windows PATHEXT limitations are recorded below
- Reviewer action required: none; live publish and release readbacks are complete
- Rollback: revert bounded diff from `b0e2d76`; no data migration

## Verification Evidence

- `bun test packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts scripts/fg6-npm-release-dry-run.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts scripts/release-provenance-readback.test.ts`: 17 pass, 0 fail, 87 assertions.
- `bun run typecheck`: pass.
- Temporary npm dry-run: verified; generated `bin` contains only `archctx`, dependency is exact CodeGraph `1.4.0`, and `bin/codegraph.mjs` is absent.
- `node scripts/local-product-tarball-smoke.mjs`: pass across install, daemon, sync, MCP, upgrade, and uninstall; runtime PATH excludes both Bun and CodeGraph, proving packaged dependency fallback.
- `bun run verify`: pass across typecheck, boundary/security/governance checks, full tests, packaged CLI smoke, acceptance ledgers, sprint status, and eval checks.
- `bun run verify:governance`: pass after regenerating the `0.2.3` version-bound deterministic evidence chain; 24/24 governance commands succeeded.
- Current `docs/verification/fg6-npm-release-dry-run.json`: verified for `archctx@0.2.3`; public `bin` is only `archctx`, exact internal CodeGraph dependency is `1.4.0`, and the tarball is `_ops/npm/fg6-release-dry-run/archctx-0.2.3.tgz`.
- `npm view archctx@0.2.3 ...`: returned `E404` before publish, confirming the patch version is available.
- Independent review: no blocker/high/medium finding; scope and rollback surfaces match the contract.
- Sprint gate: `repo-harness run verify-sprint --contract tasks/contracts/20260711-0055-codegraph-latest-no-bin-collision.contract.md` passed; run snapshot `.ai/harness/runs/run-20260711T012736-5955-20260711-0055-codegraph-latest-no-bin-collision.json`.
- The post-expansion strict contract rerun passed every release command through installed-tarball smoke but hit the helper's 120-second wall-time while repeating the contracts/CLI tests; those exact tests passed directly and inside the full `bun run verify`, so this is retained as workflow-helper timing evidence rather than a product blocker.
- PR #93's initial Governance Verify failure was traced to the old `0.2.2` no-provider model digest. Regenerating `fg4-deterministic-conclusion` and then `fg6-no-provider-deterministic` produced `sha256:d973b7c7f01ad8864d56d1fac0e2ed533b7b9e22ef24c9de420765f86f693701`; the local Governance gate then passed.
- PR #93 merged to `main` as `b299fc801f099c40d7b26b8b9005b6429f3152b9`.
- npm registry readback verifies `archctx@latest = 0.2.3`, public `bin = { archctx: "bin/archctx.mjs" }`, and exact `@colbymchenry/codegraph = 1.4.0`.
- Registry SHA-1 `0ad264beca1c0d2ee0f993b2604295bcaf3ba37c` and integrity exactly match the verified release-candidate tarball.
- Published Node 24 smoke passes help (38 commands), doctor (`0.2.3` on CLI/daemon/MCP), CodeGraph `1.4.0`, and update-check (`current`).
- Annotated tag `v0.2.3` resolves to the `main` merge commit and GitHub Release `archctx 0.2.3` is published at `https://github.com/Ancienttwo/arch-context/releases/tag/v0.2.3`.
- `fg6-release-distribution` and `release-provenance` live readbacks both verify with no failures.

## External Acceptance Advice

> **External Acceptance**: authorized
> **External Reviewer**: user plus native read-only reviewer
> **External Source**: explicit publish instruction and Codex subagent review
> **External Started**: 2026-07-11T01:09:00+08:00
> **External Completed**: 2026-07-11T02:26:00+08:00

- Live npm publication, tag, and GitHub Release are explicitly authorized; npm Web authentication completed successfully.
- P1 blockers: none
- P2 advisories: none for the published artifact; registry, tarball, tag, and release metadata agree.
- Acceptance checklist: pass
- Manual Override: Native read-only review found no blocker and the unpublished local artifact passed the full contract; an external Claude CLI review is unnecessary for this non-publishing slice.

## Behavior Diff Notes

- CodeGraph runtime/source authority moves from `1.0.1` to registry-resolved latest `1.4.0`, recorded exactly in manifests and lockfile.
- The generated public package no longer exports or ships an ArchContext-owned `codegraph` bin.
- Default runtime resolution uses an executable PATH command when present and otherwise resolves the exact package-local CodeGraph shim; explicit/custom commands keep precedence.

## Residual Risks / Follow-ups

- The superseded PR workflow's Windows jobs remained stuck in GitHub Actions and blocked the replacement run through concurrency; they were not used as release evidence. Local full Governance passed, while the superseded commit's Linux/macOS Node 24/25 matrix passed.
- CodeGraph 1.4.0 changed the human-readable `explore` Markdown shape. JSON `query` remains the symbol authority and real adapter flows pass, but the legacy supplemental `parseExploreSymbols` path contributes less data.
- Windows PATH lookup still does not emulate `PATHEXT`; package fallback remains functional.
- `contract-worktree finish` is blocked by a pre-existing orphan architecture module (`docs/architecture/modules/capability-architecture-context.md` versus an empty `.ai/context/capabilities.json`). The product contract passed; direct Git ship is used under the user's explicit publish authorization without mutating either architecture authority.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| Functionality | 9.4/10 | Version authority, packaged fallback, and bin isolation verified end to end |
| Code quality | 9.1/10 | Small bounded resolution seam with focused negative tests |

## Summary

- PASS — RELEASED. `archctx@latest`, `v0.2.3`, the GitHub Release, the one-bin package contract, and CodeGraph `1.4.0` metadata agree.
