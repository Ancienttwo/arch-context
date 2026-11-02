# archctx / archctx-contracts 0.11.1 preparation

Baseline: `origin/main@f2eac2f3`, the merge of #457.
This records a release candidate, not publication. Both registry latest versions were read back as 0.11.0 during preparation.

## Changes

- #445 / #448: **fix.** A workspace package whose `exports` uses condition objects no longer crashes `archctx deps` or `projection check` with `AC_UNCLASSIFIED_FAILURE` (`TypeError: target.replace is not a function`).
  - One normalizer in `@archcontext/local-runtime/git-adapter` reads `exports` for `readWorkspacePackages` and `refactor-scan`. A string becomes `{".": value}`. A subpath map resolves each value. A condition object takes the first of `types`, `import`, `default`, `require` that resolves to a string, recursively. An array takes its first resolving entry. `null`, or nothing resolvable, leaves the subpath out, so the specifier stays unresolved.
  - Any other shape, and an object that mixes subpath and condition keys, fails closed with the new reason code `workspace-exports-unsupported` (`AC_SCHEMA_INVALID`), whose facts name the repo-relative `package.json` path and the subpath. `archctx deps` passes this failure through instead of relabelling it `deps-workspace-invalid`.
  - Wildcard subpaths (`./*`) keep exact-key lookup. Targets in directories that Git does not track (`./dist/*`) stay unresolved.
- #450 / #454: **fix.** The no-sync private CodeGraph snapshot (`flows check --no-sync` and other no-sync reads) no longer copies Git objects, so its size no longer grows with repository history.
  - The snapshot's Git directory reads the original object store through a snapshot-local `objects/info/alternates`. The original objects are fingerprinted by `lstat` before and after the read, so a write to them fails as `code-facts-snapshot-changed`.
  - The 512 MiB / 100000-entry caps keep their values and apply to what is still copied (source, Git metadata, index database and WAL). `code-facts-snapshot-limit-exceeded` now carries the measured breakdown: `limit`, `maxBytes`, `maxEntries`, `sourceBytes`, `sourceEntries`, `gitBytes`, `gitEntries`, `gitObjectEntries`, `indexBytes`, `indexEntries`.
  - A source that already uses alternates, or has a symlink or special file under `objects/`, fails as `code-facts-snapshot-layout-unsupported`.
- #452 / #455: **fix.** No repository-controlled Git hook runs during a snapshot read. The snapshot copies no `hooks/` directory and pins `core.hooksPath` to an empty in-snapshot directory, overriding repository, global and system values. If a higher-precedence value such as `config.worktree` still wins, the read fails as `code-facts-snapshot-layout-unsupported`.
- #442 / #443, #444 / #449, #447 / #451: repository only. `docs/approvals/` keeps only `archctx-sprint-2.md` (CD-EG3 pending). The AL10-GA-6 and FG6 approvals are transcribed onto PR #83 and PR #2, and the AL10 external-acceptance readback reads those comments in `run`. No product behavior change.
- #446: repository only. repo-harness 0.25.0 refresh. No product behavior change.
- #457: CI only. The Linux full verify worker cap is 30 minutes; #456 splits that worker and restores 20.

## Compatibility

Version 0.11.1 is a patch release. Upgrade `archctx` and `archctx-contracts` together.

- Repositories whose workspace manifests use `{types, default}` or `{types, import}` condition exports can run `archctx deps` and `projection check` again, and their cross-package edges are measured.
- Repositories with a long Git history can run no-sync reads again: on the reporting monorepo the snapshot copy drops from 625 MiB to about 281 MiB.
- Repository hooks, including a user's global `core.hooksPath` hook manager, no longer run during no-sync reads.
- `archctx-contracts` adds one failure reason code, `workspace-exports-unsupported`, two fact rules (`repoPath`, `exportsSubpath`) and one local enum (`snapshotLimit`). `code-facts-snapshot-limit-exceeded` gains its breakdown facts. Existing reason codes, the projection manifest schema, both projection profiles, RPC v2 and the SQLite migrations are unchanged.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (`catalogDigest` regenerated from `loadPracticeCatalog`), the review action default, and the example workflows.
- [x] Deterministic readbacks derived from the product version regenerated from their producers.
- [x] Hosted Verify passed on the merged changes' PR heads: `9f7b612c` (#448), `73c39c44` (#454), `16bcb2cc` (#455), `060b5575` (#451), `9533f0da` (#449), `9624a572` (#446), `571cba7c` (#443), `fde4ea11` (#457).
- [ ] Release-candidate PR head: hosted full/matrix Verify before merge.
- [ ] Rebuild both package tarballs from accepted main and read back version, contents and digests.
- [ ] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior code and version authorities. Published versions are immutable and require a new corrective version.
