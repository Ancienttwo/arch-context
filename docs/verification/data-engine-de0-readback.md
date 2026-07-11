# Data Engine DE0 Readback

> Generated: 2026-07-11
> Artifact: `docs/verification/data-engine-de0-readback.json`
> Verdict: PASS

## Accepted contracts

- `archcontext.authority-cursor/v1`
- `archcontext.explorer-delta-query/v2`
- `archcontext.explorer-projection-delta/v2`
- `archcontext.projection-input-manifest/v1`
- `archcontext.evidence-state-at-cursor/v1`
- `archcontext.architecture-evidence-lifecycle/v2`

## Proved invariants

- Projection compilation cannot emit architecture-fact or evidence changes.
- Top-N budget displacement is a projection change, not a fact deletion.
- Projection comparison requires matching compatibility manifests.
- Fact delta compares replayed graph states at explicit base/head events.
- Evidence delta compares lifecycle state including removal tombstones.
- Evidence create/update/remove is validated before transactional persistence.
- Delta V1 has no package, schema, daemon, HTTP/RPC, or CLI consumer.

## Verification

- TypeScript typecheck: PASS.
- Package-boundary audit: PASS.
- Contracts, architecture-delta, architecture-ledger, SQLite, daemon, CLI and
  Explorer tests: PASS.
- Explorer 10k/100k bounded benchmark/privacy readback: PASS.
- DE0 contract preflight: PASS.

The JSON artifact stores command exit codes, durations, and stdout/stderr digests;
it intentionally does not persist raw command output or source content.

Reproduce the evidence with `bun run record:de0:data-engine`; inspect the stored
packet without rerunning commands with `bun run readback:de0:data-engine`.
