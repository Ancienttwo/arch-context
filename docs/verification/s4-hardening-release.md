# Sprint 4 Hardening and Release Gate

Date: 2026-06-20

## Scope

This closes Sprint 4 as repo-local deterministic work only. It does not close Sprint 1-3 production GA or external readback debt.

## Results

- Explorer runs as a local loopback, read-only, token-gated surface.
- Explorer projection, search, and negative write attempts are covered by `docs/security/captures/sprint4-explorer-retrieval.har.json`.
- Retrieval eval closed with `keep-fts5`; embedding remains default off.
- `privacy-route-audit` scans `packages/explorer-ui` and `packages/retrieval`.
- Capture manifest includes `fixture.sprint4-explorer-retrieval`.
- Strict external readback still fails until a real staging or production capture is recorded.

## Verification

- `bun run verify`: passed; includes `tsc --noEmit`, 173 Bun tests, route audit, metadata capture audit, capture manifest readback, and sprint evidence-claim check.
- `node scripts/privacy-packet-capture-audit.mjs docs/security/captures/sprint4-explorer-retrieval.har.json`: passed; entries=3 checked=45.
- `node scripts/privacy-capture-manifest.mjs readback --require-external`: failed as expected because no verified staging or production capture exists yet.

## Boundary

Sprint 4 completion means local Explorer and eval-gated retrieval are implemented and verified in this repository. Production readiness still requires the external readback sprint listed in `plans/sprints/archctx-sprint-4.md`.
