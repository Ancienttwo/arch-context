# CLI and daemon projection consistency — issue #200

## Root Cause Evidence

- **Trigger:** run CLI `docs apply`, then daemon `completeTask` (CLI `review` or `complete`).
- **Fault:** CLI hashed `{model, profile, decisions}` while the shared digest helper omitted `profile`; daemon also always loaded the default layout. The daemon-only test fixture used the same incorrect helper, hiding the mismatch.
- **Before:** both the default-profile apply regression and the existing repo-harness adoption scenario reported a `projection-drift` finding after successful CLI projection.
- **Guard:** run the CLI writer and daemon reviewer against the same repository for both profiles; retain the existing tests for real source drift, unrelated commits, and committing projection outputs.

## Decision and boundaries

The projection engine owns one source digest function. CLI rendering, daemon completion and recovery use it. Completion reads the supported profile from the applied manifest before loading and rendering the corresponding layout. Missing or unsupported profiles fail closed with an explicit regeneration error; there is no guessed legacy profile.

Refresh signal IDs describe a runtime invocation and include its current HEAD/worktree identity. They are returned through the existing refresh signal protocol and recovery proof. They have no manifest reader in the repository. Keeping them in the persistent documentation manifest caused unrelated commits to appear as document drift once the CLI and daemon paths were aligned. Remove that unused manifest field; retain the runtime signals and their authority unchanged. Existing manifests reconcile through the normal docs ChangeSet apply path.

No source/model mutation or ledger write bypass is introduced. Source measurement and rendering complexity are unchanged; at larger repository size, source collection remains the first scaling constraint.

## Validation

Six focused CLI/runtime tests pass, including both profiles, malformed profile rejection, real source drift, unchanged source after unrelated commits, and projection commits. Typecheck and the final full verification result are recorded in the PR.

The repository itself was tested in a separate worktree at `476d2ec` with the source patch. Its existing CodeGraph database was copied using SQLite's read-only backup API and reindexed in the verification copy; the user's checkout and index were untouched. Using a separate temporary runtime state directory and a freshly restarted validation daemon, `docs apply --profile default --approved` succeeded and `review` returned `pass` with no projection-drift finding. No generated verification-copy outputs are included in this PR.

Final `bun run verify`: 1909 tests passed, zero failures; typecheck, boundary audits and all configured verification gates passed. The refresh-signal protocol integration scenarios remain green.
