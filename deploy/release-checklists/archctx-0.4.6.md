# archctx 0.4.6 release checklist

Scope: bind projection apply to the projection authority digest, require the exact client and daemon product version, and reject untrusted worktree digest profiles before any plan or apply state is created.

- [x] repo-harness independently accepted candidate commit `a705f1c9ade0833d34c4dd42a0f1deb294507983` from a clean git-archive tarball and verified `dirtySourceUsed=false` with the package-local binary.
- [x] Real loopback RPC rejects unknown, null, malformed, and plan-ineligible digest profiles with `AC_SCHEMA_INVALID`; rejected plans create no draft, write, journal, or receipt.
- [x] Projection-specific digest ignores concurrent `.ai/harness` runtime churn while genuine authority-input mutation remains pre-write fail-closed with no receipt.
- [x] Exact client/daemon product-version readiness is fail-closed and the valid projection-result/v2 receipt/reconcile path remains exactly once.
- [x] Runtime daemon tests pass `101/101` with `900` assertions; the focused projection RPC suite passes `5/5` with `157` assertions.
- [x] Exact-subject external AcceptanceReceipt verifies against subject `sha256:3e88d2e04d564a9de4b90fae189bc01db6406d0ba03c81bba20c282451612ce1`.
- [x] `archctx` and `archctx-contracts` package versions are exactly `0.4.6`; npm dry-run, AL10 packaging, migration matrix, and both registry preflights pass.
- [x] The staged `archctx-0.4.6.tgz` has SHA-256 `2cfe47fa2204746452ff9ab24695eeae79823d22ba6b027103d92baf64b121e1`.
- [ ] Publish `archctx-contracts@0.4.6` and read back version, integrity, shasum, and clean-room import.
- [ ] Publish `archctx@0.4.6` and read back version, integrity, shasum, Node engine, exact CodeGraph dependency, and capabilities handshake.
- [ ] Record the official npm artifact digest and close `bun run readback:release` with `failures: []`.

## Known non-blocking evidence

- The full CLI suite retains the independently reproduced SQLite `database is locked` baseline; the 0.4.6 candidate introduces no new failure.
- `verify:axr3-semantic-pilot` remains revision-pin blocked on this checkout and main. The pin must not be weakened for release.
- Release and CI environments must provide the `codegraph` 1.5.0 binary because the real-index selector integration test runs `codegraph init` without network access.
