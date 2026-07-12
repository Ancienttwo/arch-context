# Runtime State Recovery Readback

> **Verdict**: PASS  
> **Recorded**: 2026-07-12T05:28:15Z

## Authority result

- Git-visible `.archcontext/` remained the reconstruction authority.
- SQLite remained rebuildable operational state; no old row was interpreted or salvaged.
- Post-rebuild ledger state reports `readAuthority: yaml`, `semanticDrift: false`, and graph digest `sha256:8e35dcd03abaed4359a9dc0ef6c139d29489646412b6c23012eb69bc0734bf48`.

## Current-host recovery

- Dry-run classified the canonical target as `target-startup-failed`, with exact target fingerprint `sha256:0c1cba88d5fd95736aed474e805894bf0a8c9f8d14f75e3c029c432000aedc31`.
- Write used the dry-run worktree digest `sha256:108fe7167aa6a2c91efb161cc5fef767b677b695e6a6b2dc503913a703d91605` and the exact target fingerprint.
- The receipt is `recovered`; the final dry-run is `not-required / target-current`.
- The private quarantine directory is mode `0700`; the receipt and every preserved file are mode `0600`.
- Preserved family: 905,216-byte database, empty WAL, 32,768-byte SHM, and 462-byte migration marker. Exact per-file digests are in the JSON readback and recovery receipt.
- Rebuild result digest: `sha256:8283920ede0d91c8d099870c1b331c20d2354d1ce33a90dca286c8928cd0117c`.

## Verification

- Focused local-store + CLI matrix: `127 pass / 0 fail`.
- Implementation worktree `bun run verify`: `1092 pass / 0 fail`.
- Recovered host-default partition `bun run verify`: `1101 pass / 0 fail`.
- `bun run typecheck`: PASS.
- `node scripts/packaged-cli-smoke.mjs`: PASS.
- Ledger state after daemon upgrade: PASS, no semantic drift.
- User-owned untracked artifact remained byte-identical at SHA-256 `10fc961f78b6a26a16b9fa9d1fea368d4b4493e7d825add46495df0b760e14ea`.

The quarantine is intentionally retained. Code rollback must not delete it or restore the unusable database over the rebuilt current target.
