# archctx 0.4.5 release checklist

Scope: publish projection-result/v2 with durable apply receipts and exact selector proof from the structured CodeGraph index. This is an atomic contract cutover: v1 is not accepted, negative or ambiguous selector evidence remains fail-closed, and concurrent non-owned worktree mutation remains visible through `applied-reconcile-required` reconciliation.

- [x] `bun run verify` reaches `1220 pass / 10 fail`; all ten failures are the independently reproduced unchanged-main SQLite lock baseline, with no new failure.
- [x] Exact selector tests prove a unique sink under 500 unrelated calls, incomplete negative search, ambiguous identities, fanout-stable digest, and real CodeGraph source call sites.
- [x] Projection reconciliation tests prove durable receipt commit binding, pre-write fail-closed behavior, no duplicate owned write or Human acceptance, refresh signal exactly once, and subsequent no-op.
- [x] SQLite migration readback covers the installed-store `0018` → `0019` path and AL10 release packaging is verified.
- [x] repo-harness accepted local tarball SHA-256 `16fa6ba0c9b61f3f1dabc6bcfc5961ebccf243a591f737bffc988c94b866556b` through its provider path; the v2 fields are sufficient and no schema revision is requested.
- [x] The exact-subject external AcceptanceReceipt verifies against subject `sha256:8c015580f1e0507be1e44e9b5511fee337e23a0d66994b3317bde890db5be696`.
- [x] `archctx` and `archctx-contracts` package versions are exactly `0.4.5`; npm dry-run, AL10 packaging, migration matrix, and both registry preflights pass.
- [x] Publish `archctx-contracts@0.4.5` and read back version, integrity, shasum, and clean-room import.
- [x] Publish `archctx@0.4.5` and read back version, integrity, shasum, Node engine, exact CodeGraph dependency, and v2 capabilities handshake.
- [x] Record the official npm artifact digest and close `bun run readback:release` with `failures: []`.

## Known non-blocking evidence

- `verify:axr3-semantic-pilot` remains revision-pin blocked on this checkout and main: fixture revision `1eaf6301` does not match the local repo-harness checkout. The pin must not be weakened for release.
- Release and CI environments must provide the `codegraph` 1.5.0 binary because the real-index selector integration test runs `codegraph init` without network access.
- Bun's package resolver had not observed `archctx-contracts@0.4.5` immediately after npm exposed the version. The release smoke now installs with npm from the authoritative registry and executes the imported TypeScript surface with Bun; the resulting clean-room import passed.
