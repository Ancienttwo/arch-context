# archctx 0.5.13 release candidate

## Scope

Since `v0.5.12` (`331c526`), main has accumulated five landed changes plus one still-unmerged stacked branch this candidate sits on top of:

- **RPC runtime decoders** (`92f4bad`/`f1e0d0c`, PR #230): every general `RUNTIME_RPC_METHODS` entry now runs through an explicit runtime decoder (the new `rpc-argument-codec.ts`) instead of a blind `params as Args` cast, and `envelopeMethod` rejects a non-array `params` container before any per-slot decoding runs. `rpc-server.ts`'s dispatch catch maps the resulting `RuntimeRpcInputInvalidError` to `errorEnvelope(method, "AC_SCHEMA_INVALID", ...)`. **Consumer-observable contract change**: a malformed developer-review RPC call (the 4 `dataMethod` entries in the method table) used to surface as a raw HTTP 500 body with an unstructured string error; it now answers HTTP 200 with a structured `{ code: "AC_SCHEMA_INVALID", message, severity, retryable, action }` envelope, the same shape every handler's own input validation already produced. Any client that branches on RPC transport status code for these calls, instead of reading `.error.code`, needs to update.
- **Architecture Book and recommendations/refactor service extractions** (PR #233 `4a50542`, PR #234 `6f0b09c`): two orchestration services pulled out of the daemon facade into their own components, each with a matching model-ownership commit and doc-projection reconcile.
- **Contracts fixtures ownership** (PR #232, `1e8f871`): `packages/contracts/fixtures` reassigned to the contracts module in the architecture model.
- **Docs reconcile** (PR #231, `546edb4`/`7128ae3`): projects the `rpc-argument-codec` ownership change into the rendered architecture docs.
- **local-runtime SCC PR-2** (`4d65e78`/`96f26a7`/`42f68c9`/`ea2a956`, this stacked branch, still under review): relocates the 13 RPC argument/result types the daemon facade used to own, plus the 10 developer-review types, into a new `rpc-types.ts` (owned by the rpc-client component) and next to `developer-review-codec.ts`'s own decoders. This closes `scc.cd1c0fb7a216355a` — 10 members, 22 cross-module cycle edges — down to 0. No decoder body, `RUNTIME_RPC_METHODS` behavior, or public export surface changes; `test/rpc-contract-boundary.test.ts` locks the new import boundary.

The same range also carries two already-merged, independent pieces of groundwork that this note does not restate in detail: local-runtime SCC PR-1 (#229, a separate SCC closing 12 members / 39 cycle edges) and the Linux arm64 native descriptor-flag fix (#228, `EINVAL` on `archctx init` under Linux arm64).

## Candidate and provenance

This branch (`claude/release-0513`) starts at `claude/local-runtime-scc-pr2` HEAD (`ea2a956`) and raises the package, product, lockfile, fixture, catalog, and runner-template version anchors from 0.5.12 to 0.5.13, then regenerates the version-bound FG4/FG6 no-provider evidence. SCC PR-2 itself is still under review and not yet merged to main; this release-prep branch is stacked on top of it and will need rebasing onto main once it merges. This is source-side release prep only: no publish, tag, push, or PR. A published release tarball must be rebuilt from the final merged main — a candidate packed from this stacked branch is not publishable provenance, since it would carry unreviewed SCC PR-2 commits under a shipped version number.

## Verification

- `bun install --frozen-lockfile`: passes, no changes against the updated lockfile.
- `bun run typecheck`: clean, no errors.
- `node scripts/package-boundary-audit.mjs`: passes (5 workspaces).
- `bun run verify:governance` (which runs the full `bun run verify` as its first step, then 23 further FG3-FG6 governance inspections): `status: "verified"`, `ok: true`, 24/24 commands exit 0, 0 skipped. The inner `bun run verify` alone took 413.6s and includes a full `bun test` pass, mermaid/practices/explorer/github-api-contract verification, the packaged CLI smoke, privacy and security scan readbacks, the acceptance ledgers, and `evals/run.ts --check`.
- `bun test --timeout 60000` (standalone run): 2309 pass, 1 skip, 0 fail, 13054 `expect()` calls, 2310 tests across 209 files.
- npm release dry-run (`bun scripts/fg6-npm-release-dry-run.ts run`, artifacts under `_ops/npm/candidate-0513-e840609/`): `ok: true`, `failures: []`. Candidate `archctx-0.5.13.tgz` (515876 bytes) SHA-256 `afefb9b2ca4e9403fc3b5d3ea7ae1a4ba1a38e377290d7e797ca8c6bf0fd52d8`, shasum `8fbc1a865e2a8068688523926120d1d2f66b6647`, integrity `sha512-3i+xr1lNAvf0fa68aZWaSmHP9U+nsvPZkWDBCZioNoGa2ssiv/MTQmE1pHYX5PAVltSYwplNzDKWvE0rrdyZyw==`. Candidate `archctx-contracts-0.5.13.tgz` (94806 bytes) SHA-256 `9ce9170001ea70d61d32e9a2433ce8a3c7407434700e4ab1cff24327e9ba0dd3`, shasum `a2f089d2830e52679ed3985be5b10f7f4ee8397b`, integrity `sha512-W4ry2yRJcWT5K1O/XfR6YkVDe4n7534dLgxJu91mpfV8kgOJlgeQLIFL18W3vINTL3aMUFlv7xhuRnygjUFYlw==`.
- `node scripts/publish-archctx.mjs` without `--confirm-publish`, pointed at the dry-run tarball: `status: "blocked"` on `npm identity unavailable (E401)`, which is correct for this credential-less prep environment; its own registry readback independently confirms `archctx@0.5.13` is not published (`E404`).
- Local product tarball smoke (`scripts/local-product-tarball-smoke.mjs`, artifacts under the same `_ops/npm/candidate-0513-e840609/` directory): install, CLI, daemon (loopback-only), stdio MCP (7 tools), CodeGraph, and strict practices validation all pass; installed CLI and product both report `0.5.13`; the installed `practices.catalogDigest` (`sha256:dfb7e67aa5c9f49571ea54a6e560bed1012a4c73fb8d8f5074912e9064754fae`) matches the value committed in `catalog.yaml`. Reinstall-upgrade and uninstall both retain state as expected.
- `npm view archctx@0.5.13` and `npm view archctx-contracts@0.5.13`: both `E404`, version absent from the registry.

Nothing has been published. `archctx@0.5.13` and `archctx-contracts@0.5.13` are both absent from the npm registry, and this candidate has not been tagged, pushed, or opened as a PR.
