# RPC keep-alive hotfix release candidate (0.5.12)

## Boundary and failure trace

`RuntimeRpcClient` calls a per-worktree loopback daemon over HTTP. The client issues a health probe and a read RPC before computing an architecture projection synchronously. With published `archctx@0.5.10` and `0.5.11`, the next `planUpdate` RPC failed as `AC_RUNTIME_UNAVAILABLE: fetch failed` (`ECONNRESET`) before the daemon's request handler saw it. A 49 KB request body was accepted when replayed in a fresh process, so request size and the `planUpdate` handler were not the cause. Reproducing health → read RPC → eight seconds of synchronous work → `planUpdate` produced the reset; sending `Connection: close` on loopback calls made the same sequence pass.

The source fix was merged as `1eabeb9` / PR #180 after the `v0.5.11` tag and already has a regression test. The published 0.5.11 tarball does not contain it. `repo-harness@0.19.2` pins package-local `archctx@0.5.10`, so upgrading only the user-level `archctx` binary cannot repair its verification gate.

## Candidate and trade-off

This branch starts at the published `v0.5.11` tag, cherry-picks only `1eabeb9`, and raises the package, product, lockfile, fixture, catalog, and runner-template version anchors to 0.5.12. It excludes all other post-tag main changes. The fix opens a fresh local connection for each RPC. That adds a small loopback handshake cost but avoids retrying a mutation whose commit state could be unknown after a reset. No protocol or storage migration changes are included.

## Verification

- The targeted keep-alive regression test passes with pinned Bun 1.4.0.
- `bun run verify` passes, including the full test suite and configured evaluation gates.
- The npm release dry-run is `verified` with no failures; frozen lockfile install passes.
- The source-built tarball smoke passes install, daemon/MCP, reinstall-upgrade and uninstall state-retention checks; the installed CLI reports 0.5.12.
- Candidate `archctx-0.5.12.tgz` SHA-256: `6c9837fac3b5ae2ca04888dde50e236821a5942c1527a191b048e90cbb10682e`. Candidate `archctx-contracts-0.5.12.tgz` SHA-256: `996ec64b9b6f253ec3f2352e33ddf92a8eb435f547f5ec335a567c5183b3fe8c`. Local artifacts and evidence are under `_ops/npm/rpc-keepalive-0512/`.

Nothing has been published. Publication requires the normal registry identity and release gates. After publication, update the exact `archctx` / `archctx-contracts` dependency closure in `repo-harness`, then rerun the downstream projection and sprint gate without a transport shim.
