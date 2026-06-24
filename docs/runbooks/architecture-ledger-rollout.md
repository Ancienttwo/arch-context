# Architecture Ledger Rollout And Rollback

> Status: AL0 contract runbook
> ADR: `docs/adr/ADR-0040-hybrid-architecture-ledger.md`
> Sprint: `plans/sprints/archctx-architecture-ledger-sprint-checklist.md`

This runbook defines the feature modes and rollback path before AL2 adds
ledger tables. It is a contract for later implementation, not a claim that the
runtime already exposes these flags.

## Modes

| Mode | Read authority | Write behavior | Promotion requirement |
|---|---|---|---|
| `yaml` | `.archcontext/` YAML | ChangeSet writes YAML/projections only | Current default |
| `dual` | YAML | One daemon-owned operation writes accepted event records and YAML projections | Event/projection digests match and crash recovery is idempotent |
| `ledger-shadow` | YAML | Ledger records and compares; runtime decisions still come from YAML | Zero drift in representative replay fixtures |
| `ledger-authoritative` | SQLite ledger current state | Accepted events update ledger; projections rebuild from snapshots | Independent architecture/security review plus rollback drill |

## Enabling Rules

1. Never skip a mode.
2. Never enable `ledger-authoritative` while YAML-to-ledger-to-YAML drift is
   nonzero.
3. Never promote advisory recommendation output into checkpoint or complete
   gates unless AL1 evidence-binding gates pass.
4. Keep hooks deterministic. Hooks may enqueue work; they must not call LLMs or
   network providers by default.
5. Keep subagents proposal-only. A valid `InvestigationReport/v1` can create a
   proposal; it cannot write facts, projections, docs, policies, or waivers.

## Rollback

Rollback is mode downgrade plus verification:

1. Stop new ledger-authoritative writes.
2. Downgrade to `ledger-shadow` or `dual` if the ledger is still useful for
   comparison.
3. Downgrade to `yaml` if there is any data-corruption, replay, or projection
   drift risk.
4. Rebuild runtime state from Git projections plus observed code facts.
5. Verify `.archcontext/` model validation, ChangeSet journal health, package
   boundaries, and contract tests.

Minimum commands for an operator runbook once the feature flags exist:

```bash
bun test packages/contracts/test/contracts.test.ts
node scripts/package-boundary-audit.mjs
bun packages/surfaces/cli/src/main.ts validate
bun packages/surfaces/cli/src/main.ts status
```

Full release verification remains:

```bash
bun run verify
```

## Failure Modes

| Failure | Required behavior |
|---|---|
| Ledger append fails in `dual` | Abort the whole operation or recover both sides before success is reported |
| Projection write fails after event append | Mark operation interrupted; do not report completion until projection is rebuilt or event is rolled back/superseded |
| Branch/head changes during queued job | Cancel or supersede the job; stale job cannot append events |
| SQLite corruption | Return to `yaml`; rebuild local state from Git projections and CodeGraph facts |
| Subagent output has unknown IDs | Reject with actionable reason; keep output as non-authoritative evidence at most |
| Raw source/diff appears in ledger payload | Treat as privacy bug and block release |

## Review Checklist

- Schema change has valid, invalid, and boundary fixtures.
- New mutation path names its writer and stale-cursor behavior.
- New table or queue states whether it stores source/diff bodies; default must
  be no.
- CLI/MCP output uses stable JSON envelopes and reason codes.
- Rollback can return to `yaml` without data loss.
