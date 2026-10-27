# archctx / archctx-contracts 0.9.4 preparation

Baseline: `origin/main@b38ae08bb925c88297dd392460122309bd4ca9a9`.
This records a release candidate, not publication. Both registry latest versions were read back as 0.9.3 during preparation.

## Changes

- Earlier accepted main changes since 0.9.3 include ADR decision export, ordered architecture layers and stateless constraint queries (#410/#411), invalid ChangeSet base diagnostics (#416), and safe projection failure stage/error-family details (#418).
- #419: preserve canonical producer recovery policy through projection publish, run records and persisted status. Reuses PR #420 at `e9563f8148b8e57d12f48a0b199df6ff46f9537d` and its completed hosted verification.
- #417: `--version` reads product-version authority without initializing a runtime. Resolve argument errors direct callers to correct arguments while retaining model failures at their owning boundary.
- #415: a daemon with a deleted start root reports non-readiness and refuses normal RPC. Authenticated shutdown remains reachable; `daemon list` reports the classified missing-root condition from persisted state.
- #414: `ledger receipt --journal-id` exports committed ChangeSet ids, recorded model-transition digests and per-file hashes. It refuses missing historical evidence and makes no claim of authenticated approval. See `docs/runbooks/changeset-receipt.md`.
- #409: bounded immutable-blob hunks are joined to CodeGraph declaration ranges only after indexed hashes match the requested ref. Real CLI fixtures cover positive impact, ambiguity, rename, missing files and stale evidence.
- #421: `flows check --no-sync` reads a private snapshot using the pinned provider's source enumeration and readiness checks, preserving the original checkout and index. Default help now discloses index writes.

## Compatibility

Version 0.9.4 is the user-selected release target. Upgrade archctx and archctx-contracts together: earlier main changes add required ADR/input-role fields to strict native export v1, and adopted model.layers requires a supporting reader. Remove adopted fields through an approved ChangeSet before downgrading. RPC remains v2. There is no SQLite migration or architecture authority promotion. The receipt is not an input to ledger acceptance. The default flows behavior remains explicit; callers choose the zero-write mode.

## Evidence and remaining gates

- [x] #417 new regressions reproduced both original failures, then passed.
- [x] RPC server tests: 15 passed, one existing skip; includes both missing-root shutdown cases.
- [x] Real CLI deleted-root listing and targeted stop test: 1 passed.
- [x] #414 real apply/export/Git-blob comparison test passed; missing transition and invalid portable evidence tests passed.
- [x] RPC method wire sentinels and CLI usage tests: 95 passed across three files.
- [x] #409 bounded-hunk and existing ref-impact tests: 13 passed.
- [x] Version-bound catalog and FG4/FG6 deterministic records regenerated from their producers.
- [x] #409/#421 integration: 35 of 36 targeted tests passed; the remaining config fixture was corrected to use a provider-supported directory and passed separately, with original-index preconditions retained. No assertions were relaxed.
- [x] Node 24.22.1 bundled adapter smoke passed closed/live WAL preservation and stale-index refusal; real Bun CLI `flows check --no-sync` proof passed.
- [x] Source frozen at `dc93dcf3308cc80e8dede032a7cbc3ea300801cc`; `bun run verify:pre` exited 0, including typecheck, package boundaries, production-mock reachability, Mermaid, practice and Node checks.
- [x] Independent Claude Opus read-only review of `226b6bda..dc93dcf3`, including assertions versus behavior: no code blockers. Its requested runbook claim clarification is applied; see `tasks/reviews/20261028-issues-release.review.md`.
- [x] The first full attempt was stopped (exit 130) after a new schema used a non-URL `$id`. The one-line absolute-URL repair passed 278 contracts/debt/delta tests and a narrow independent review; runtime schemaVersion was unchanged.
- [x] Full inventory at `ff81e1d7`: 3594 passed, 4 platform/existing skips, 2 failures, exit 1. These exposed an outdated flows help assertion and lost resolve line diagnostics. `06d6927f` preserves the old resolve assertion, repairs its local CLI message, updates the mandated flag syntax, and adds write-contract assertions. Targeted rerun: 5 passed / 60 assertions, exit 0; typecheck exit 0. This is not recorded as a green standalone full run.
- [x] `bun run verify:post` exited 0 on production source `06d6927f`, including Explorer, packaged CLI, privacy, acceptance ledgers and configured eval gates.
- [ ] Final-head hosted full/matrix CI before merge; subsequent provider results belong in the release PR and local final-readiness record.
- [x] Both package dry-runs and isolated installed-product lifecycle smoke passed on `ff81e1d7` before the final diagnostic correction. Final artifacts must be rebuilt from accepted main; these initial archives are not publication candidates.
- [ ] Rebuild both final package tarballs and read back their version/content/digests after merge.
- [ ] Open the release candidate PR, accept its exact head after hosted checks, merge and read back main.

## Publication boundary

After the authorized PR merge, rebuild both final tarballs from accepted main. Publication is a separate step from this preparation: when authorized, publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Both npm preflights currently report only `npm identity unavailable: E401`. Restore npm web authentication at publication time. No publish was attempted.

Before publication, reverting the candidate restores prior code and version authorities. Published versions are immutable and require a new corrective version.
