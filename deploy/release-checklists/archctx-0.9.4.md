# archctx / archctx-contracts 0.9.4 preparation

Baseline: `origin/main@b38ae08bb925c88297dd392460122309bd4ca9a9`.
This records a release candidate, not publication. Both registry latest versions were read back as 0.9.3 during preparation.

## Changes

- #419: preserve canonical producer recovery policy through projection publish, run records and persisted status. Reuses PR #420 at `e9563f8148b8e57d12f48a0b199df6ff46f9537d` and its completed hosted verification.
- #417: `--version` reads product-version authority without initializing a runtime. Resolve argument errors direct callers to correct arguments while retaining model failures at their owning boundary.
- #415: a daemon with a deleted start root reports non-readiness and refuses normal RPC. Authenticated shutdown remains reachable; `daemon list` reports the classified missing-root condition from persisted state.
- #414: `ledger receipt --journal-id` exports committed ChangeSet ids, recorded model-transition digests and per-file hashes. It refuses missing historical evidence and makes no claim of authenticated approval. See `docs/runbooks/changeset-receipt.md`.
- #409 and #421: existing-index reads and ref-bound impact remain under integration until their real CodeGraph fixture checks pass.

## Compatibility

Version 0.9.4 is the user-selected release target. Upgrade archctx and archctx-contracts together. RPC remains v2. There is no SQLite migration or architecture authority promotion. The receipt is not an input to ledger acceptance. The default flows behavior remains explicit; callers choose the zero-write mode.

## Evidence and remaining gates

- [x] #417 new regressions reproduced both original failures, then passed.
- [x] RPC server tests: 15 passed, one existing skip; includes both missing-root shutdown cases.
- [x] Real CLI deleted-root listing and targeted stop test: 1 passed.
- [x] #414 real apply/export/Git-blob comparison test passed; missing transition and invalid portable evidence tests passed.
- [x] RPC method wire sentinels and CLI usage tests: 95 passed across three files.
- [x] #409 bounded-hunk and existing ref-impact tests: 13 passed.
- [x] Version-bound catalog and FG4/FG6 deterministic records regenerated from their producers.
- [ ] Finish #409/#421 integration and real Node/Bun no-write verification.
- [ ] Freeze the complete candidate and record typecheck/full verification exit codes.
- [ ] Independent read-only review, including assertions versus behavior.
- [ ] Build both package tarballs and run clean-install/packaged smoke against the frozen candidate.
- [ ] Open the release candidate PR, accept its exact head after hosted checks, merge and read back main.

## Publication boundary

Publication is not authorized by release preparation. After separately authorized merge/publication, rebuild from the accepted main commit, verify both tarballs, publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Before publication, reverting the candidate restores prior code and version authorities. Published versions are immutable and require a new corrective version.
