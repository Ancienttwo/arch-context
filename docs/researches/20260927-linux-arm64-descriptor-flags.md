# Linux arm64 descriptor flags in the npm release

## P1 — ownership boundary

`packages/core/changeset-engine/src/descriptor-relative-write.ts` owns no-follow file writes under a trusted repository root. `writeFileWithoutFollowingSymlinks` calls it during `archctx init`; the CLI reaches it through the daemon and model-store ChangeSet path. The public `archctx` tarball bundles this source. The existing `verify` matrix used Linux x86_64, macOS and Windows, so it did not exercise Linux arm64's numeric open flags.

## P2 — observed path and root cause

A clean `node:24-bookworm-slim` container on Linux arm64 installed the merged-main 0.5.12 tarball, initialized CodeGraph, started the daemon, then failed `archctx init` with `open trusted root failed with errno 22`. A disposable diagnostic bundle showed `root=/tmp/coldrepo`, `flags=589824` (`0x90000`). Direct `node:fs.openSync` and Koffi `open/openat` returned `EINVAL` for those flags even on `/`.

The source had hard-coded Linux x86_64 values `O_DIRECTORY=0x10000` and `O_NOFOLLOW=0x20000`. The same Linux arm64 runtime reports `fs.constants.O_DIRECTORY=0x4000` and `O_NOFOLLOW=0x8000`. `O_CLOEXEC=0x80000` remained valid. The source passed `0x90000` when opening the root directory, before any source-specific write could occur. Public 0.5.11 and a narrow tag-based 0.5.12 candidate passed the same cold flow because their `init` paths did not reach this newly exercised write path; the merged-main 0.5.12 did.

The existing behavior guard `writeFileWithoutFollowingSymlinks > creates a private file and keeps the requested mode` reproduced the failure on Linux arm64 before the fix (`_ops/linux-arm64-open/pre-fix-guard.log`, `PRE_FIX_EXIT=1`). With the runtime-derived directory/no-follow flags, that same guard passed, and the complete changeset test file passed 25/25 on Linux arm64. The source-built fixed tarball then passed cold `capabilities`, daemon start, `init`, `sync`, `validate`, `status`, and daemon stop (7/7), without the host build path mounted.

## P3 — decision and limit

Use Node's platform-owned `fs.constants` for the two Linux flags whose values vary by CPU architecture, and fail closed if either is unavailable. Keep the existing `O_CLOEXEC` value and all no-follow, expected-hash and atomic-write behavior. Add a focused `ubuntu-24.04-arm` CI job running the existing changeset behavior suite, so the same boundary is exercised before npm packaging. No public npm package is published by this fix. A future architecture or libc ABI change would first surface in this focused native job and the cold package smoke.
