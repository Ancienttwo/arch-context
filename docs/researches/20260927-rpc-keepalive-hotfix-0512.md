# RPC keep-alive fix and 0.5.12 release integration

## Boundary and failure trace

`RuntimeRpcClient` calls a per-worktree loopback daemon over HTTP. The client issues a health probe and a read RPC before computing an architecture projection synchronously. With published `archctx@0.5.10` and `0.5.11`, the next `planUpdate` RPC failed as `AC_RUNTIME_UNAVAILABLE: fetch failed` (`ECONNRESET`) before the daemon's request handler saw it. A 49 KB request body was accepted when replayed in a fresh process, so request size and the `planUpdate` handler were not the cause. Reproducing health → read RPC → eight seconds of synchronous work → `planUpdate` produced the reset; sending `Connection: close` on loopback calls made the same sequence pass.

The source fix was merged as `1eabeb9` / PR #180 after the `v0.5.11` tag and already has a regression test. The published 0.5.11 tarball does not contain it. `repo-harness@0.19.2` pins package-local `archctx@0.5.10`, so upgrading only the user-level `archctx` binary cannot repair its verification gate.

## Candidate and trade-off

The source fix is already on main. This integration branch starts at current main and raises the package, product, lockfile, fixture, catalog, and runner-template version anchors to 0.5.12; it preserves main's private source manifest for `@archcontext/contracts`. The fix opens a fresh local connection for each RPC. That adds a small loopback handshake cost but avoids retrying a mutation whose commit state could be unknown after a reset. No protocol or storage migration changes are introduced by this integration.

A separate, narrower candidate branch (`codex/rpc-keepalive-hotfix-0512`) was built from `v0.5.11` plus only `1eabeb9`. Its tarballs have **different bytes** from the current-main build below. Publication must choose one source revision and run its release gates; these hashes are not interchangeable.

## Verification

- The current-main RPC client tests pass (3/3) with pinned Bun 1.4.0; typecheck passes.
- The narrow tag-based candidate passed `bun run verify` (1,779 tests). The current-main integration also passed the complete pinned-Bun `verify` (2,022 tests, 0 failures, configured evaluation gates).
- The npm release dry-run is `verified` with no failures; frozen lockfile install passes.
- The source-built tarball smoke passes install, daemon/MCP, reinstall-upgrade and uninstall state-retention checks; the installed CLI reports 0.5.12.
- The version bump changes the deterministic no-provider model digest. `Governance Verify` on the first PR head found the stale recorded digest; the FG4 and FG6 verification JSON were regenerated with their official scripts. Local `bun run verify:governance` then passed. These verification files are evidence projections, not changes to the runtime trust boundary.
- The next hosted matrix ran 9 of 10 required checks successfully; Windows/Node 25 reached the workflow's 20-minute job limit and GitHub canceled it shortly after its evaluation reported PASS. Windows/Node 22 and 24 completed in about 18 minutes. The matrix timeout is raised to 30 minutes so the same test suite can finish; no test is skipped or relaxed.
- Current-main candidate `archctx-0.5.12.tgz` SHA-256: `7b2fba89cf16469c2151e7f14d7bb6350f30c3364ec74a14942e7d0e13627f4b`. Current-main `archctx-contracts-0.5.12.tgz` SHA-256: `b0201f28409868232ec8c9b28b170ff063b38dbe28da29b46754b69b088ed98b`. Local artifacts and evidence are under `_ops/npm/main-0512/`.

Nothing has been published. Another agent owns publication. It must rebuild and verify both tarballs from the exact merged release source, read back registry identity and package bytes, publish contracts before `archctx`, then update the exact `archctx` / `archctx-contracts` dependency closure in `repo-harness` and rerun the downstream projection and sprint gate without a transport shim. Do not publish the tag-based tarballs while claiming current-main provenance.
