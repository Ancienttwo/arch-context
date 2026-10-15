# archctx / archctx-contracts 0.8.0

## Changes

Architecture debt and projection reads (#327, #328, #337):

- Architecture debt measures ownership and human anchors. It is reported at checkpoint and at completion (#337). The stateless read routes are resolve, docs anchors, flows check, deps, checkpoint and freshness. Flows can sync CodeGraph, and read-only SQLite access can create WAL and cache files. Checkpoint covers ownership and anchors; deps, flows and practices are deferred to complete. Prepare and practices checkpoint keep explicit writer behavior (#328 D4, #348).
- `archctx` reports undeclared cross-capability dependencies (#326). `doctor` reports repository code facts without a projection run (#327 S2). A read-only projection freshness command shares one evaluator with the projection check (#327 S3). `check` and `plan` classify changes per target (#327 S4).
- Projection manifest v3 carries per-target rows and per-capability proof evidence (#327 S6). Markers no longer hold source digests, whole-file outputs no longer hold markers, and the renderer is v6 (#327 S5). Capability isolation returns partial results (#327 S7). Docs anchors check selector ids against the model (#327 finding 6, #335).
- Manifest v3 has optional renderer and protocol floors. A manifest with an unsupported or future declaration refuses rendering and writes. A rollback refuses to overwrite external manifest bytes it did not write, and keeps the backup and the pending journal for manual recovery, including for newly created manifests.
- Committed projection metadata and unresolved journal authority use dedicated 256 KiB details budgets. An oversized historical record stays stored whole and returns explicit manual-only or complete-readback guidance. Ordinary summary budgets stay at 8 KiB. No id or token is truncated.
- Worktree digests hash only Git-visible files (#323). Each glob is compiled once and a build is measured once (#324). Projection proves committed outputs before a replay and restores reverted ones (#325). Projection-owned files stay stable on CRLF checkouts (#336).
- Refactor decisions are kept in Git with portable ids (#321, #334).

Runtime and failures (#322, #328, #346, #351):

- Public operation failures carry a registered code, action and reason, with bounded details. This includes held writer, recovery and lifecycle exits. Known metadata stays intact, and unknown failures use safe unclassified metadata. Consumers must read the structured fields, not match messages (#328).
- A daemon exits on idle after its worktree is deleted (#322, #333).
- Daemon upgrade shutdown is bound to the authenticated instance that owns the daemon (#351, #354).
- The native surface exports commit-bound model and lossless human context (#346, #352).
- The practice writer contract is versioned as runtime-rpc v2 (#350).

## Compatibility

This is a coordinated pre-1.0 release. Upgrade `archctx` and `archctx-contracts` together, at the same version.

Follow the [projection upgrade procedure](../runbooks/architecture-documentation-projections.md#upgrading-from-archctx-07x) for the manifest v3 change from 0.7.x. Old formats are re-baselined explicitly, not converted silently. Absent floor fields keep the existing v3 serialization. The current renderer and request protocol versions are not bumped by the optional floors.

The runtime RPC stays v2. The final failure adapters add no method, argument, wire field or success shape. HTTP 500 operation failures now carry the existing typed envelope/v1 error slot. The frozen v2 endpoints pass in both directions, old client with new server and new client with old server. Ordinary methods keep returned failures, and the four review value methods keep thrown failures. The 426 discriminator and the full upgrade authority stay compatible. Direct value APIs now throw `FailureError`. Success object identity and lifecycle and cleanup precedence do not change.

A caller that parsed diagnostic strings, assumed every projection exception was a precondition, or used the retired checkpoint task and session flags must move to the structured contract. A manual-only committed failure does not authorize replay or reconstruction. Existing journal metadata cannot tell a prepublication crash from a later external deletion, so a missing destination keeps the original backup-restoration behavior, as the [recovery runbook](../runbooks/crash-recovery.md) describes.

CodeGraph remains pinned to `@colbymchenry/codegraph` 1.6.1, Koffi to 3.1.6, Bun to 1.4.3, and Node to `>=22.22 <26`. No runtime dependency, credential or config migration is added.

## Known limitations

- #358: the CodeGraph sync child process crashes intermittently on Windows with `UV_HANDLE_CLOSING`. The cause is not found. It is tracked as a diagnostics issue and is not a release blocker.

## Verification

Run in the release-prep worktree on `8272951e` (PR #360 head) plus this release commit, with Bun 1.4.3. This is not the final release candidate: the branch will be rebased onto main after #360 merges, and the checks below will be repeated there.

- `bun install --frozen-lockfile` passes after the version sweep. `bun install` changed only the five workspace version lines in `bun.lock`.
- `bun run typecheck` (`tsc --noEmit`) exits 0 with no output.
- `bun test packages/contracts packages/core/practice-catalog scripts/fg4-deterministic-conclusion-readback.test.ts scripts/fg6-no-provider-deterministic-readback.test.ts scripts/fg6-npm-release-dry-run.test.ts`: 469 pass, 0 fail, 14 files.
- The practice catalog digest was regenerated with `loadPracticeCatalog`. A second generation is byte-identical to the committed `catalog.yaml`.
- The version-bound deterministic records (fg4, fg6) were regenerated with `readback:fg4:deterministic-conclusion` and `readback:fg6:no-provider-deterministic`. `modelDigest` and `generatedAt` changed, and both report no failures.

Not run in this commit: `bun run verify`, the hosted CI matrix, `readback:fg6:npm-release-dry-run`, `readback:fg6:local-product-tarball`, the npm preflights and the clean-room install. The npm publish, the tarballs, tag `v0.8.0` and the GitHub Release are not done yet.

Publish both npm packages after the release-prep CI passes on the rebased branch. Rebuild the tarballs from the merged main commit. Create tag `v0.8.0` and the GitHub Release only after both npm publishes succeed.
