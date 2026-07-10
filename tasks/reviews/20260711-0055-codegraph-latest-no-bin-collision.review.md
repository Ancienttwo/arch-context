# Task Review: codegraph-latest-no-bin-collision

> **Status**: Ready for release
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
- Reviewer action required: no pre-publish code action; complete live publish and record the final registry/tag/release readbacks
- Rollback: revert bounded diff from `b0e2d76`; no data migration

## Verification Evidence

- `bun test packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts scripts/fg6-npm-release-dry-run.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts scripts/release-provenance-readback.test.ts`: 17 pass, 0 fail, 87 assertions.
- `bun run typecheck`: pass.
- Temporary npm dry-run: verified; generated `bin` contains only `archctx`, dependency is exact CodeGraph `1.4.0`, and `bin/codegraph.mjs` is absent.
- `node scripts/local-product-tarball-smoke.mjs`: pass across install, daemon, sync, MCP, upgrade, and uninstall; runtime PATH excludes both Bun and CodeGraph, proving packaged dependency fallback.
- `bun run verify`: pass across typecheck, boundary/security/governance checks, full tests, packaged CLI smoke, acceptance ledgers, sprint status, and eval checks.
- Current `docs/verification/fg6-npm-release-dry-run.json`: verified for `archctx@0.2.3`; public `bin` is only `archctx`, exact internal CodeGraph dependency is `1.4.0`, and the tarball is `_ops/npm/fg6-release-dry-run/archctx-0.2.3.tgz`.
- `npm view archctx@0.2.3 ...`: returned `E404` before publish, confirming the patch version is available.
- Independent review: no blocker/high/medium finding; scope and rollback surfaces match the contract.
- Sprint gate: `repo-harness run verify-sprint --contract tasks/contracts/20260711-0055-codegraph-latest-no-bin-collision.contract.md` passed; run snapshot `.ai/harness/runs/run-20260711T012736-5955-20260711-0055-codegraph-latest-no-bin-collision.json`.
- The post-expansion strict contract rerun passed every release command through installed-tarball smoke but hit the helper's 120-second wall-time while repeating the contracts/CLI tests; those exact tests passed directly and inside the full `bun run verify`, so this is retained as workflow-helper timing evidence rather than a product blocker.

## External Acceptance Advice

> **External Acceptance**: authorized
> **External Reviewer**: user plus native read-only reviewer
> **External Source**: explicit publish instruction and Codex subagent review
> **External Started**: 2026-07-11T01:09:00+08:00
> **External Completed**: 2026-07-11T01:21:00+08:00

- Live npm publication, tag, and GitHub Release are explicitly authorized; npm Web authentication completed successfully.
- P1 blockers: none
- P2 advisories: registry latest remains `0.2.2` until the authorized publish command succeeds.
- Acceptance checklist: pass
- Manual Override: Native read-only review found no blocker and the unpublished local artifact passed the full contract; an external Claude CLI review is unnecessary for this non-publishing slice.

## Behavior Diff Notes

- CodeGraph runtime/source authority moves from `1.0.1` to registry-resolved latest `1.4.0`, recorded exactly in manifests and lockfile.
- The generated public package no longer exports or ships an ArchContext-owned `codegraph` bin.
- Default runtime resolution uses an executable PATH command when present and otherwise resolves the exact package-local CodeGraph shim; explicit/custom commands keep precedence.

## Residual Risks / Follow-ups

- Registry `archctx@latest` remains `0.2.2` at the pre-publish checkpoint; the verified `0.2.3` artifact is ready for the authorized publish step.
- CodeGraph 1.4.0 changed the human-readable `explore` Markdown shape. JSON `query` remains the symbol authority and real adapter flows pass, but the legacy supplemental `parseExploreSymbols` path contributes less data.
- Windows PATH lookup still does not emulate `PATHEXT`; package fallback remains functional.
- `contract-worktree finish` is blocked by a pre-existing orphan architecture module (`docs/architecture/modules/capability-architecture-context.md` versus an empty `.ai/context/capabilities.json`). The product contract passed; direct Git ship is used under the user's explicit publish authorization without mutating either architecture authority.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| Functionality | 9.4/10 | Version authority, packaged fallback, and bin isolation verified end to end |
| Code quality | 9.1/10 | Small bounded resolution seam with focused negative tests |

## Summary

- PASS TO PUBLISH. The source and `0.2.3` tarball satisfy the contract without mutating global PATH; live release readbacks remain the closeout step.
