# Practice Assets S1 Catalog Gate

Date: 2026-06-23

## Scope

S1 delivers the governed static Practice Catalog. It adds contracts, schemas,
source records, seed assets, repo overlay validation, daemon-resolved CLI/MCP
read paths, policy allowlist support, and packaged CLI smoke coverage.

This slice does not change `prepare` posture, matching, checkpoint behavior, or
`complete` results.

## Evidence

- ADR: `docs/adr/ADR-0038-versioned-architecture-practice-assets.md`
- Contracts: `packages/contracts/src/practices.ts`
- Schemas: `schemas/repo/practices/*.schema.json`, `schemas/runtime/practice-catalog-manifest.schema.json`
- Catalog loader: `packages/core/practice-catalog/src/index.ts`
- Built-in assets: `packages/core/practice-catalog/assets/`
- Policy allowlist: `packages/core/policy-engine/src/index.ts`
- Runtime RPC: `packages/local-runtime/runtime-daemon/src/index.ts`
- CLI: `packages/surfaces/cli/src/main.ts`
- MCP: `packages/surfaces/mcp-local/src/index.ts`
- Tests: `packages/core/practice-catalog/test/practice-catalog.test.ts`

## Verified Path

```text
archctx practices validate --strict
  -> CLI thin adapter
  -> RuntimeDaemonClient.practices
  -> ArchctxDaemon.practices
  -> core practice-catalog loader
  -> built-in assets + .archcontext/practices overlay
  -> manifest/catalog/overlay digests

archcontext_practices MCP tool
  -> RuntimeDaemonClient.practices
  -> same daemon-resolved catalog result
```

## Verification Commands

```bash
bun run typecheck
bun test packages/contracts/test
bun test packages/core/practice-catalog
bun test packages/core/policy-engine
bun test packages/surfaces/cli/test/cli.test.ts
bun test packages/surfaces/cli/test/local-product-e2e.test.ts
bun test packages/surfaces/mcp-local
bun run verify:practices
node scripts/packaged-cli-smoke.mjs
node scripts/package-boundary-audit.mjs
node scripts/production-mock-reachability-audit.mjs
bun run verify
```

## Readback

Focused practice catalog readback:

```text
bun test packages/core/practice-catalog
7 pass
0 fail

bun run verify:practices
ok: true
valid: true
catalogDigest: sha256:235dc7f02375c408a1b1497d0d5bca444abde26519875e2d396f770ae5d3b892
overlayDigest: sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
sourceCount: 11
practiceCount: 12
```

Surface and distribution readback:

```text
bun run typecheck: pass
bun test packages/contracts/test: 102 pass, 0 fail
bun test packages/core/policy-engine: 2 pass, 0 fail
bun test packages/surfaces/cli/test/cli.test.ts: 15 pass, 0 fail
bun test packages/surfaces/cli/test/local-product-e2e.test.ts: 3 pass, 0 fail
bun test packages/surfaces/mcp-local: 26 pass, 0 fail
node scripts/packaged-cli-smoke.mjs: [packaged-cli-smoke] OK
node scripts/package-boundary-audit.mjs: Package boundary audit passed (5 workspaces).
node scripts/production-mock-reachability-audit.mjs: productionSafe true
```

Full repository verification:

```text
bun run verify
567 pass
0 fail
3385 expect() calls
packaged-cli-smoke OK
privacy, security, acceptance-ledger, sprint-status, and representative eval gates passed
```

## Boundary Notes

- Built-in assets are strict JSON-compatible YAML to avoid adding a YAML parser
  dependency in S1.
- The committed `catalog.yaml` manifest must remain byte-for-byte aligned with
  the generated catalog readback.
- Repo overlays are read only from `.archcontext/practices/`.
- Symlinked overlay files are rejected.
- Silent duplicate IDs are rejected unless `overlay.mode` is explicit.
- Built-in practices remain advisory. Completion blocking is deferred to the
  deterministic enforcement sprint.
- Context7 and other external documentation providers are not part of this S1
  runtime path.
