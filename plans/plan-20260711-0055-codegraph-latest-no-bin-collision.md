# Plan: CodeGraph latest compatibility without global bin collision

> **Status**: Complete
> **Created**: 20260711-0055
> **Slug**: codegraph-latest-no-bin-collision
> **Artifact Level**: work-package
> **Promotion Reason**: merge_boundary
> **Verification Boundary**: focused tests + typecheck + npm dry-run + installed-tarball smoke + 0.2.3 registry/tag/release readback
> **Rollback Surface**: revert bounded diff from `b0e2d76`; no data migration
> **Spec**: `docs/spec.md`
> **Research**: npm registry readback on 2026-07-11
> **Task Contract**: `tasks/contracts/20260711-0055-codegraph-latest-no-bin-collision.contract.md`
> **Task Review**: `tasks/reviews/20260711-0055-codegraph-latest-no-bin-collision.review.md`
> **Implementation Notes**: `tasks/notes/20260711-0055-codegraph-latest-no-bin-collision.notes.md`

## Agentic Routing

- Selected route: implementation
- Routing reason: two independently verifiable surfaces exist: runtime compatibility and release packaging.
- Due diligence:
  - P1 map: CodeGraph authority is split across root/local-runtime manifests, the adapter compatibility constant, the product manifest, and generated npm packaging.
  - P2 trace: `archctx` creates `CodeGraphCliProvider` -> resolves/spawns `codegraph` -> `CodeGraphAdapter.assertCompatible`; the public tarball currently also re-exports a `codegraph` bin.
  - P3 decision rationale: user-facing consumers use `archctx@latest`; source and tarball lock the registry-resolved CodeGraph latest exactly for reproducibility; the package keeps CodeGraph as an internal dependency but no longer owns the global `codegraph` command.

## Scope

- Update the current CodeGraph compatibility authority from `1.0.1` to registry latest `1.4.0`.
- Keep the dependency exact in manifests and `bun.lock`; do not use a floating dependency tag inside the release artifact.
- Remove the generated `archctx` package's own `codegraph` bin mapping/shim.
- Let the runtime resolve the packaged CodeGraph dependency when no PATH command is available.
- Update focused tests/readbacks that define the current release shape.
- Do not publish npm, mutate global PATH, or rewrite historical verification evidence.
- Release follow-through authorized on 2026-07-11: align all current product-version surfaces to `0.2.3`, publish npm, create the Git tag and GitHub Release, and regenerate current release readbacks.
- Governance evidence follow-through authorized on 2026-07-11: regenerate the deterministic no-provider evidence chain whose version-bound model digest changes with `0.2.3`.
- Do not mutate the existing capability registry or ArchContext-generated architecture projections as a release-gate workaround; the pre-existing orphan-module incompatibility is recorded as workflow-tool debt.

## Verification

```bash
bun test packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts scripts/fg6-npm-release-dry-run.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts scripts/release-provenance-readback.test.ts
bun run typecheck
bun scripts/fg6-npm-release-dry-run.ts run --out /tmp/archctx-codegraph-latest-dry-run.json --artifact-dir /tmp/archctx-codegraph-latest-artifacts --json
node scripts/local-product-tarball-smoke.mjs
```

## Evidence Contract

- **State/progress path**: this plan's task breakdown plus the linked contract, notes, and review.
- **Verification evidence**: focused test output, generated npm dry-run manifest, and installed-tarball smoke output.
- **Evaluator rubric**: contract exit criteria pass and review recommends pass.
- **Stop condition**: all task rows complete, generated package exposes only `archctx`, and all listed commands pass.
- **Rollback surface**: revert the bounded diff from base `b0e2d76`; no data migration.

## Promotion Gate

- **Merge/PR unit**: one bounded compatibility and packaging fix.
- **Rollback surface**: revert the bounded diff; no data migration.
- **Verification boundary**: focused tests, typecheck, npm release dry-run, and installed-tarball smoke.
- **Review/acceptance boundary**: linked review recommends pass; npm, Git tag, GitHub Release, and live readbacks are complete.
- **High-risk surface**: packaged CodeGraph lookup under a global-style install and CLI compatibility with `1.4.0`.
- **Why not checklist row**: it changes both runtime dependency authority and the public npm bin contract.

## Task Breakdown

- [x] Update runtime compatibility and dependency authority to CodeGraph `1.4.0`.
- [x] Remove the public-package `codegraph` bin while preserving internal runtime resolution.
- [x] Verify focused tests, release dry-run, and installed-tarball behavior.
- [x] Record review and implementation evidence.
- [x] Align all current product-version and release-prep surfaces to `0.2.3`.
- [x] Re-run full release preflight and pack/install smoke.
- [x] Publish `archctx@0.2.3` after browser authorization, then verify registry metadata and bins.
- [x] Create/push `v0.2.3`, create GitHub Release, and regenerate release readbacks.
- [x] Record final review and release evidence.
