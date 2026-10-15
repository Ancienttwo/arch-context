# archctx 0.8.0 release checklist

Status: preparation only. The target pair is `archctx@0.8.0` and `archctx-contracts@0.8.0`.
No 0.8.0 version sweep, release tarball, registry preflight or publication is claimed here.
The source manifests and product constant remain 0.7.2. The latest published GitHub release read
for this preparation is [archctx 0.7.2](https://github.com/Ancienttwo/arch-context/releases/tag/v0.7.2),
published 2026-10-12. Registry status for 0.8.0 has not been queried by this task.

## Version authorities

| Surface | Existing authority |
| --- | --- |
| Public `archctx` package | Root `package.json` version; `scripts/fg6-npm-release-dry-run.ts` builds its separate release manifest |
| Public `archctx-contracts` package | `packages/contracts/package.json`; `scripts/contracts-release-stage.mjs` stages the unscoped public package and requires exact source-version equality |
| Workspace/version handshake | Root and five workspace manifests, plus `ARCHCONTEXT_PRODUCT_VERSION` in `packages/contracts/src/product-version.ts`; all currently 0.7.2 |
| Version-bound generated data | `bun.lock` workspace entries, valid product-version/capabilities fixtures, `actions/review-action/action.yml`, the two docs/examples workflows, and practice-catalog productVersion/catalogDigest |
| Practice-catalog digest | `loadPracticeCatalog` in `packages/core/practice-catalog/src/index.ts` derives `.manifest` and digest from the product version; regenerate `assets/catalog.yaml`, never hand-edit its digest |
| Published state | Registry readback and release assets/provenance after publish; changing a source version or a GitHub page alone is not artifact proof |

The source contracts workspace stays private `@archcontext/contracts`; publishing uses the
existing isolated staging helper for `archctx-contracts`. Do not publish the workspace directly.

## Changes

- Architecture debt measures ownership and human anchors. The adopted stateless read routes are
  resolve, docs anchors, flows check, deps, checkpoint and freshness. Flows can sync CodeGraph;
  read-only SQLite access can create WAL/cache files. Checkpoint covers ownership+anchors, with
  deps/flows/practices deferred to complete. Prepare and practices checkpoint retain explicit
  writer behavior; status/context/management can still use the runtime.
- Public operation failures have registered code/action/reason and bounded details, including
  held writer/recovery/lifecycle exits. Known metadata stays intact; unknown failures use safe
  unclassified metadata. Consumers must inspect structured fields instead of matching messages.
- Committed projection metadata and unresolved journal authority use dedicated 256 KiB details
  budgets. Oversized historical authority stays stored whole and returns explicit manual-only
  or complete-readback guidance. Ordinary summary budgets remain 8 KiB; no ID/token is truncated.
- Manifest v3 has optional renderer/protocol floors. Unsupported/future declarations refuse
  rendering and writes. A rollback refuses to overwrite observed external manifest bytes,
  retaining backup/pending journal for manual recovery, including newly-created manifests.

## Compatibility

This is a coordinated pre-1.0 compatibility release. Upgrade `archctx` and `archctx-contracts`
together. Follow the existing [projection upgrade procedure](../../docs/runbooks/architecture-documentation-projections.md#upgrading-from-archctx-07x)
for the v3 manifest change from 0.7.x; old formats are explicitly re-baselined, not silently converted.
Absent floor fields preserve existing v3 serialization. Current renderer/request protocol versions
are not bumped by these optional floors.

The runtime RPC stays v2: no new method, argument, wire field or success shape is added by the final
failure adapters. HTTP 500 operation failures now carry the existing typed envelope/v1 error slot.
Actual frozen 386d v2 endpoints pass both old-client/new-server and new-client/old-server directions.
Ordinary methods keep returned failures and four review value methods keep thrown failures. The
existing 426 discriminator and full upgrade authority stay compatible. Direct value APIs now throw
`FailureError`; success object identity and lifecycle/cleanup precedence remain unchanged.

Callers that parsed diagnostic strings, assumed every projection exception was a precondition,
or used retired checkpoint task/session flags must update to the structured contract. A manual-only
committed failure does not authorize replay or reconstruction. Existing journal metadata cannot
distinguish a prepublication crash from a later external deletion; missing destinations retain the
original backup-restoration semantics, as the [recovery runbook](../../docs/runbooks/crash-recovery.md) describes.

CodeGraph remains pinned 1.6.1, Koffi 3.1.6, Bun 1.4.3 and Node `>=22.22 <26`. No new runtime dependency
or credential/config migration was added by the final closure.

## Verification and release gates

- [x] Final D6/D7 local acceptance: 609 passing tests across 32 complete files, assembled from 31
  passing whole files and a complete 85/85 local-runtime rerun after one obsolete string assertion
  was corrected. No product/config/product-doc bytes changed across those runs.
- [x] Typecheck, five-workspace boundary audit, production reachability and packaged CLI/native smoke.
- [x] Two independent review lanes, one semantic cycle, two repair loops; no remaining P1/P2 reported.
- [x] C1 accepted main `be19d8ec` matches the tested C1 `1fd88cf6` tree; normal merge alignment keeps
  the verified final implementation tree unchanged. C1 hosted attempt 2 passed 43 jobs, as reported
  by the coordinator; it is not the final release candidate's CI result.
- [ ] Merge the final #328 PR only after its exact-head required checks and acceptance pass. The
  separate #358 diagnostics owner and #327/#328 issue closure remain coordinator release gates.
- [ ] Synchronize every live version authority/pin to 0.8.0, regenerate the version-bound catalog
  and fixtures, and prove no stale live 0.7.2 pin remains. Historical/synthetic fixtures are distinct.
- [ ] Run the existing full verification/governance/release-provenance gates at the release HEAD;
  scoped 609 tests are not a replacement for that release gate or hosted matrix.
- [ ] Run `bun run readback:fg6:npm-release-dry-run` to stage both 0.8.0 tarballs and inspect package
  names, version/engine, runtime dependency declarations, schema/helper inclusion and recorded hashes.
- [ ] Run `bun run readback:fg6:local-product-tarball` and install the staged tarballs in a clean
  room outside the repository. Verify CLI/daemon/MCP and contracts import at the Node engine floor
  and supported release targets; no workspace node_modules may mask missing native dependencies.
- [ ] Run existing `preflight:contracts:npm` and `preflight:archctx:npm` only when the coordinator
  advances release preparation. They inspect registry uniqueness, staged artifacts and npm identity;
  they were not run here. No credential files were inspected or changed, and no npm authentication was attempted.
- [ ] With separate publish authorization, publish contracts then CLI through existing scripts and
  interactive npm web authentication. Follow the root contract: do not request an OTP from EOTP
  alone; once an upload is accepted/processing, wait for visibility instead of publishing it twice.
- [ ] Read back registry version, shasum/integrity and clean-room import/install; verify both release
  tarballs and SHA256SUMS beyond page text/size, update provenance/install docs and only then mark
  the packages live. This task does not publish, tag, upload assets or change npm dist-tags.
