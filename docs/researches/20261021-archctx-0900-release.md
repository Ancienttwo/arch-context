# archctx and archctx-contracts 0.9.0 preparation

Date: 2026-10-21, Asia/Taipei.
Status: release candidate prepared. Publication requires the final PR checks.
No package is published.

## Changes

PR 380 adds a rolling projection writer.

- `projection publish` applies through an owned worktree's daemon. It commits only
  reported projection outputs. It updates one `archctx/*` branch and its PR.
- `projection publish --follow` repeats that operation in a foreground loop.
- `projection publish-status` reports the latest run and writer identity.
- `projection verify-pr` checks generated-path ownership, human regions, and render
  equivalence. Consumers must read its verdict, not only the envelope exit code.
- Three runtime schemas and two feature flags describe the new surfaces.
- `projection-publishing` is an explicit egress channel. Local-only mode refuses it.

## Acceptance fixes

The first acceptance reviewed `d2a2a072` and found three release blockers.
Commit `2c3db107` corrects them.

### P1: boundary map

The CLI calls the writer. The writer calls the owned worktree's daemon for apply.
The daemon retains ChangeSet authority. The writer checks paths, commits, pushes,
and invokes the publisher. A separate coordination sidecar now uses the existing
local-store SQLite ownership primitive. It is not a ledger database.

### P2: verified paths

- A missing JSON owner record no longer permits a second writer. A real child
  process holds the OS lock while two contenders attempt entry. Neither applies.
  Killing the owner permits a later run to recover. Loss of the record also stops
  the current run before publication. Push uses the validated commit SHA.
- Every gh call binds `--repo` to the selected push repository. The child does not
  inherit `GH_REPO`. Lease, retry, and push use one captured push URL. Multiple push
  URLs fail before push. A real two-remote fixture covers publisher recovery.
- Success state binds the successful branch and publisher. A failed branch switch
  cannot reuse the prior branch's success. Tests cover failure before push and
  publisher failure after push. Pending publication runs before cache reuse.
  Enabling a publisher after a push-only run reuses the existing remote commit.

### P3: design decision

Keep the client-of-daemon design. Reuse the existing Node/Bun SQLite adapters and
OS lock implementation. Add no runtime dependency. Keep the JSON record for status.
Never delete the coordination lock file while a writer runs.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together to 0.9.0.
Runtime RPC remains v2. The ledger authority and committed projection formats stay
the same. CodeGraph remains 1.6.2. Bun remains 1.4.3. Node remains `>=22.22 <26`.

The default gh publisher creates a PR inside the selected push repository, including
a fork. Use a command publisher for a cross-repository PR. Writer state from the
draft implementation lacks the new success identity and is evaluated again safely.
The writer still requires human approval for observed major changes by default.

## Test assertion changes

1. The lock-loss test formerly required publication after replacing the owner
   record. It now requires failure and no remote branch. It still requires the
   foreign record to remain intact.
2. The gh argv test now uses real local Git remote configuration. Each expected
   command includes the explicit repository. It also sets a conflicting `GH_REPO`.
3. The new branch-switch test contains two full Git fixtures. Its timeout is 30
   seconds. No assertion was removed to handle its first 5-second timeout.
4. Capability and product-version fixture changes update only the release identity.

## Verification evidence

- Before fixes: 13 writer tests passed and 5 failed. Failures covered lock loss,
  missing gh repository binding, branch success reuse, publisher enablement, and
  competing processes after owner-record removal.
- After fixes: writer and CLI tests passed 20/20 with 368 assertions. The split
  push-URL regression failed before its correction and passed with 23 assertions.
- Typecheck passed after the complete implementation change.
- Independent read-only gatekeeper: PASS. It reviewed implementation and assertion
  changes, including the push-URL correction. No blocker remained.
- Frozen-lockfile install passed after the paired version sweep.
- The built-in catalog was regenerated with `loadPracticeCatalog`. The fg4
  deterministic-conclusion and fg6 no-provider records were regenerated.
- npm release dry run: `verified`, no failures, for both 0.9.0 archives.
- Archive inspection found all three new schemas and the writer contract in
  `archctx-contracts`. The CLI bundle contains the corrected lock and success paths.
- Both tarballs were installed into a fresh directory. Node 24.21.0 ran the installed
  CLI and real background daemons against a local bare Git remote. Publication
  produced exactly one commit on the current base. A second run was a no-op.
  `verify-pr` returned `generated-only-render-equivalent`. Code facts were explicitly
  optional in this fixture. No runtime or publisher port was injected.

The complete `bun run verify` result and final-head hosted CI are recorded in
[PR 380](https://github.com/Ancienttwo/arch-context/pull/380). The extra 23 governance
checks passed separately. An accidental duplicate full run from the governance
wrapper was interrupted; it is not counted as verification evidence.

After acceptance, a final argument separator was added before the push URL.
The real two-remote regression and installed-writer smoke both passed again on
that final source. Both tarballs were rebuilt from that source.

## Local artifacts

Artifacts are local preparation outputs. They are not release assets on GitHub.

- Directory: `/private/tmp/archctx-090-artifacts`.
- Files: `archctx-0.9.0.tgz`, `archctx-contracts-0.9.0.tgz`, `SHA256SUMS`.
- Dry-run record: `/private/tmp/archctx-090-dry-run.json`.
- Installed-writer record: `/private/tmp/archctx-090-writer-installed.json`.
- Full verification log: `/private/tmp/pr380-release-verify.log`.

## Release and rollback

Merge only after the final PR head passes its required checks. Build release
archives again from merged main. Publish contracts first, then archctx, through
interactive npm web authentication. Read back both exact versions and dist-tags.
Then create `v0.9.0` and its Release. Verify uploaded assets against SHA256SUMS.

The current public packages remain 0.8.1. Revert the preparation and fix commits to
roll back before publication. No runtime data migration is required for this release.
