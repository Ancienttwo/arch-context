# Architecture Ledger Rollout And Rollback

> Status: AL10 rollout workflow implemented for local backup/migrate/verify/rollback
> ADR: `docs/adr/ADR-0040-hybrid-architecture-ledger.md`
> Sprint: `plans/sprints/archctx-architecture-ledger-sprint-checklist.md`

This runbook defines the local-first rollout phases, the daemon-owned migration
workflow, and the safe downgrade path. It does not claim representative beta or
GA rollout completion; AL10 replay, chaos, security, privacy, benchmark and
independent review gates still require their own evidence.

## Modes

| Mode | Read authority | Write behavior | Promotion requirement |
|---|---|---|---|
| `yaml` | `.archcontext/` YAML | ChangeSet writes YAML/projections only | Current default |
| `dual` | YAML | One daemon-owned operation writes accepted event records and YAML projections | Event/projection digests match and crash recovery is idempotent |
| `ledger-shadow` | YAML | Ledger records and compares; runtime decisions still come from YAML | Zero drift in representative replay fixtures |
| `ledger-authoritative` | SQLite ledger current state | Accepted events update ledger; projections rebuild from snapshots | Independent architecture/security review plus rollback drill |

The runtime exposes the active phase through `architectureLedger.phaseFlags` in
`archctx status`, `archctx ledger state`, and migration readbacks. The canonical
environment flags are:

```bash
ARCHCONTEXT_LEDGER_MODE=yaml
ARCHCONTEXT_LEDGER_READ_MODE=yaml
ARCHCONTEXT_LEDGER_WRITE_MODE=yaml
```

The safe downgrade target is always `yaml`:

```bash
ARCHCONTEXT_LEDGER_MODE=yaml
ARCHCONTEXT_LEDGER_READ_MODE=yaml
ARCHCONTEXT_LEDGER_WRITE_MODE=yaml
```

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

## Migration Workflow

Use the daemon-owned workflow; do not import YAML directly from a script or edit
SQLite by hand.

Plan without writes:

```bash
archctx ledger migrate --from-yaml --dry-run
```

Apply with a fresh worktree digest:

```bash
archctx status --json
archctx ledger migrate --from-yaml --write --expected-worktree-digest <current>
```

The write command must:

- create a runtime-state SQLite backup outside the Git worktree;
- append the `architecture.yaml.import` event through the daemon writer;
- rebuild current state from replay;
- run SQLite/replay integrity checks;
- compare ledger state back to Git YAML;
- return `recommendedEnvironment.ARCHCONTEXT_LEDGER_MODE=dual` after a verified
  migration;
- return the rollback command
  `archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>`.

Dry-run must report `writes=none`, `backup.status=not-created`, and
`append.status=not-applied`.

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

Rollback to YAML authority:

```bash
archctx status --json
archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>
ARCHCONTEXT_LEDGER_MODE=yaml archctx validate
```

`ledger rollback --to-yaml --write` writes Git-visible YAML projections from the
ledger current state, removes stale managed projection files, and stores a
Git-tree backup manifest under `.archcontext/backups/ledger-rollback/` so the
operator can inspect the overwritten or removed YAML files.

Full release verification remains:

```bash
bun run verify
```

Focused AL10 workflow verification:

```bash
bun run record:al10:rollout-workflow
bun run readback:al10:rollout-workflow
bun test scripts/architecture-ledger-al10-rollout-workflow-readback.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts --timeout 120000
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
