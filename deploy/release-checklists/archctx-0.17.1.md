# archctx / archctx-contracts 0.17.1 preparation

The release covers the commits after `v0.17.0` (`c1e6d512`) on `main`.
The release ships the PR #610 base-index seed and adapter follow-up fixes (#608), detached base worktree cold-indexing for `archctx debt --base` (#632), and the pinned `@colbymchenry/codegraph` upgrade from `1.6.2` to `1.6.4`. [#608](https://github.com/Ancienttwo/arch-context/issues/608) [PR #630](https://github.com/Ancienttwo/arch-context/pull/630) [#632](https://github.com/Ancienttwo/arch-context/issues/632) [PR #633](https://github.com/Ancienttwo/arch-context/pull/633) [PR #634](https://github.com/Ancienttwo/arch-context/pull/634)

## Release notes

archctx 0.17.1 upgrades the pinned CodeGraph dependency to `1.6.4`, fixes detached base worktree cold-indexing in `archctx debt --base`, and fixes five follow-up defects in the CodeGraph base-index seeding and adapter readiness paths introduced in #608 / PR #610.

- **Pinned CodeGraph bumped to `1.6.4`:** `@colbymchenry/codegraph` and all six platform bundles move from `1.6.2` to `1.6.4`, with matching exact-version runtime schemas, contracts, and fixtures. [PR #634](https://github.com/Ancienttwo/arch-context/pull/634)
- **Cold-index detached base worktree for `archctx debt --base`:** when shared CodeGraph base seeding cannot materialize an index in the temporary detached base worktree (for example in a linked worktree without a primary-checkout shared base pointer, or on native Windows where seeding is disabled), `archctx debt --base` initializes a local CodeGraph index inside the detached worktree (bounded by timeout and `AbortSignal`, without installing Git hooks or exposing `.codegraph/.gitignore`) before measuring and caching complete base debt, and cleans up the detached worktree and its `.codegraph` state on success or failure. [#632](https://github.com/Ancienttwo/arch-context/issues/632) [PR #633](https://github.com/Ancienttwo/arch-context/pull/633)
- **Workspace-bound `resolveEvidence` after read-only `ensureReady`:** `CodeGraphAdapter.ensureReady` now records the verified workspace and updates the latest verified root without starting a writable sync, so cold `ensureReady(B) -> resolveEvidence(...)` succeeds and `sync(A) -> ensureReady(B) -> resolveEvidence(...)` binds to `B` instead of reusing `A`'s digest. Failed or unverifiable `ensureReady` / `sync` calls clear the latest verified root. `CodeFactsPort.resolveEvidence(selectors, workspace?)` adds an optional `workspace` parameter for explicit lookup. [#608](https://github.com/Ancienttwo/arch-context/issues/608) [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)
- **Strict identity guard in `StagingRun.remove`:** requires defined folder and recorded entry creation identities before comparing with live entries, preventing unrecorded entries from being removed when `creationIdentity` returns `undefined`. [#608](https://github.com/Ancienttwo/arch-context/issues/608) [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)
- **Crash-safe pointer provenance recording:** `publishBasePointer` creates `records/current.json@<identity>` from the staged temporary file's creation identity before `renameSync`, eliminating the crash window that could leave future base refreshes stranded at `skipped-unproven`. [#608](https://github.com/Ancienttwo/arch-context/issues/608) [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)
- **Kept-path reporting on the `current` base fast path:** `refreshCodeGraphBase` reports stale `refresh.lock` files and unreferenced `base-*.db` snapshots older than ten minutes even when `current.json` already matches `HEAD`. [#608](https://github.com/Ancienttwo/arch-context/issues/608) [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)
- **Retained lock and pointer-temp reporting:** lock release and pointer-temp cleanup report retained paths to `codeGraphKept` as `refresh-lock-not-removed` and `pointer-temp-not-removed` with manual cleanup hints whenever cleanup fails. [#608](https://github.com/Ancienttwo/arch-context/issues/608) [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)

### Compatibility notes

Upgrade `archctx` and `archctx-contracts` together. Failure reason codes are unchanged from 0.17.0.

- The pinned CodeGraph version moves from `1.6.2` to `1.6.4` in `productVersionManifest().runtime.codeGraph.requiredVersion`, `ProjectionSnapshotV1.generatedFrom.codeGraphVersion`, and the projection result/readback/recovery JSON schemas. Existing repository indexes built with `1.6.2` report `version-mismatch` until rebuilt once with `codegraph index` (and primary checkouts republish their shared base snapshot under `1.6.4/` on the next `archctx sync`). [PR #634](https://github.com/Ancienttwo/arch-context/pull/634)
- `CodeGraphKeptPathV1["kind"]` adds two additive values: `refresh-lock-not-removed` and `pointer-temp-not-removed`. [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)
- `CodeFactsPort.resolveEvidence(selectors, workspace?)` adds an optional `workspace` argument and remains backward-compatible with existing callers. [PR #630](https://github.com/Ancienttwo/arch-context/pull/630)

## Evidence and remaining gates

- [x] PR #630 (`274acfef`, closing #608), PR #633 (`808756cc`, closing #632), and PR #634 (CodeGraph `1.6.4`) included. Release notes checked against the merged changes.
- [x] Version authorities synchronized. The practice catalog digest is `sha256:8309a7f78aed793a0f87d21c2776b85e8af9c8fa369fb0ac13ca57c83d8993fd`, generated by `loadPracticeCatalog` and cross-checked with `digestJson`.
- [ ] Obtain the required review and a hosted Verify pass on the release-candidate PR head before merging.
- [ ] With the owner's approval, dispatch release validation for the merged SHA and wait for its Verify gate.
- [ ] Build in a detached worktree at the merged SHA. Complete the tarball dry run and both npm preflights.
- [ ] Publish `archctx`, then `archctx-contracts`, interactively with npm web authentication. Wait for registry visibility, then check both versions, dist-tags, tarball SHA-256 digests, and the clean install's `--version` output.
- [ ] Create the tag and GitHub Release for the published commit. Use the Release notes section above and attach the registry tarballs and `SHA256SUMS`.

Follow [the npm release runbook](../../docs/runbooks/npm-release.md) for the publication steps.

## Rollback

Before publication, run `git revert <squash-commit>` to restore the 0.17.0 version authorities. Once an upload is accepted, wait for registry visibility. Published versions are immutable, so a fix after publication needs a new version.
