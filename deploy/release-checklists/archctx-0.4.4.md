# archctx 0.4.4 release checklist

Scope: stop entity documentation from churning on edits that change no architecture assertion. Two carriers are removed from the rendered body — the exact file/line counts in `### 1.3 規模信號`, now printed as the 1–2–5 magnitude bucket that contains them, and `verifiedAgainst`, which moves out of the intro line and the marker attributes into the projection manifest alone. The architecture docs renderer moves `archcontext.docs-renderer/v3` → `v4` and upgrading re-renders entity docs once. Protocol identifiers, capabilities feature tokens, layout version, and the Node engine range are unchanged.

This is the second cut at the same symptom. 0.4.3 scoped the sticky stamp key per node, which stopped unrelated commits from restamping every document but left both carriers above in place: a capability covering `tests/**` still rewrote its document on every test edit. The two unchecked boxes at the bottom of `archctx-0.4.3.md` are exactly the end-to-end proof that would have caught it. They are not optional here.

- [x] `bun run verify` passes under Node `>=24 <26`.
- [x] `archctx` and `archctx-contracts` package versions are exactly `0.4.4`.
- [x] Focused projection-engine tests prove a footprint that grows inside its bucket leaves the document byte-identical with clean drift, and that `537/172275` and `538/172396` land in the same bucket.
- [x] Focused tests prove a re-stamp alone moves only `docs/architecture/.projection-manifest.json`: no document is stale and none is reported as a hand edit.
- [x] No document body or marker carries provenance; the freshness gate still reads `verifiedAgainst` from the manifest.
- [x] This repository's own projection completes the v1 → v4 re-render, and a two-line edit under `packages/**/src/**` afterwards reports `projection-manifest-stale` as its only diff.
- [x] Publish `archctx-contracts@0.4.4` and read back version, integrity, and shasum.
- [x] Publish `archctx@0.4.4` and read back version, integrity, shasum, Node engine, and exact CodeGraph dependency.
- [x] Clean-room Node 24 smoke returns the `0.4.4` capabilities handshake.
- [x] `bun run readback:release` passes, including `registryLatestMatchesRoot` and `registryMetadataMatchesOfficialRelease`.
- [x] Update repo-harness to exact `archctx@0.4.4` and `archctx-contracts@0.4.4`, run one `docs apply` to complete its v3 → v4 re-render, and commit that migration.
- [x] **End-to-end churn proof in repo-harness**: after the migration, edit one file under `tests/**`, re-project, and confirm `docs/architecture/modules/verification/evals-checks.md` and `docs/architecture/modules/runtime-harness/hook-adapters.md` do not appear in `git status`. Only `.projection-manifest.json` may move. Leaving this unchecked is what let 0.4.3 ship an incomplete fix.

## Release record

Both packages are live. `bun run readback:release` reports `failures: []`.

Two of its checks — `officialNpmReadbackVerified` and `registryMetadataMatchesOfficialRelease` — had been red since **0.4.2**, because `docs/verification/architecture-ledger-al10-npm-release-readback.json` is recorded by hand and 0.4.3 shipped without refreshing it. It now records a real clean-room run rather than an edited assertion: `archctx@0.4.4` installed from the registry into a throwaway prefix under Node v24.18.0, `--help` returning 41 commands, `doctor` reporting product/cli/daemon/mcp all `0.4.4`, and `update --check` reporting `current`. The published tarball was downloaded and hashed locally; its SHA-1 matches the registry's `dist.shasum` exactly (`b28ae62c…`), so the recorded SHA-256 describes the artifact the registry actually serves.

Publishing itself needed the maintainer's terminal. The stored npm token had expired (`npm whoami` → E401), so `npm login --auth-type=web` had to run first; a sandboxed shell also could not complete the upload (`PUT /archctx` → ETIMEDOUT on every attempt) even with the network otherwise reachable.

## repo-harness cutover

`archctx@0.4.4` reaches consumers through more than `package.json`. repo-harness names the pin in `ARCHCTX_REQUIRED_VERSION`, `ARCHITECTURE_DOCS_RENDERER_VERSION`, the policy defaults its task-workflow and project-init helpers emit, and six consumer e2e fixtures. Bumping only the manifest leaves the suite red, which is the intended fail-closed behavior.
