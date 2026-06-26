# Architecture Ledger AL10 Production Rollback Drill

> **Status**: Verified
> **Gate**: AL10-GA-7
> **Scope**: production rollback drill from ledger-authoritative mode to YAML authority

## Drill

- **Environment**: production-equivalent-staging; AL10 temporary Git repository with real SQLite runtime store
- **Operator**: codex-local-operator (release-operations)
- **Start time**: 2026-06-27T03:20:00.000Z
- **End time**: 2026-06-27T03:27:00.000Z
- **Rollback trigger**: production rollback drill for AL10-GA-7 before any ledger-authoritative production enablement

## Initial Mode

- rolloutMode: ledger-authoritative
- readAuthority: ledger
- writeAuthority: ledger-with-projection
- graphDigest: sha256:74af82d3e5fce6136a689f1d50a9dc3871fcd1068d9c6763c6df4e246358f1ef

## Rollback Command

```bash
archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>
```

- Expected worktree digest supplied: sha256:b2d06644948b4b03e5de6e1bae99c8eaf9cdcec76412acfebb30dd96d5a0ae42
- Dry run passed: true
- Write passed: true
- Backup manifest: $DRILL_REPO/.archcontext/backups/ledger-rollback/2026-06-27T03-20-00.000Z/manifest.json
- Written paths: .archcontext/model/nodes/capability.architecture-context.yaml, .archcontext/model/nodes/module.production-rollback.yaml
- Removed paths: .archcontext/model/nodes/module.production-rollback-stale.yaml

## Final YAML Authority

- rolloutMode: yaml
- readAuthority: yaml
- writeAuthority: yaml
- worktreeDigest: sha256:0af12dea68b3a85183dc641dbf62440a862837bea411072345b79edbdf2e7a2f

## Verification

| Check | Result |
| --- | --- |
| .archcontext validation | PASS |
| ChangeSet journal health | PASS |
| Package boundaries | PASS |
| Contract tests | PASS |
| Ledger drift after rollback | PASS |

Package boundary output: Package boundary audit passed (5 workspaces).

Contract test output: (pass) GitHub governance contracts > challenge and check delivery state machines reject illegal backward moves [0.07ms] | (pass) GitHub governance contracts > ReviewChallenge v2 transition returns a new value only for legal moves [0.19ms] | (pass) GitHub governance contracts > reason catalog has retryability and user action for every reason code [0.05ms] | (pass) GitHub governance contracts > cloud egress envelope schema rejects private content keys [0.09ms] | 146 pass | 0 fail | 504 expect() calls | Ran 146 tests across 1 file. [63.00ms]

## Findings

- Data-loss finding: none
- Projection-drift finding: none
- Operational-risk finding: none
- Privacy scan clean: true

## Readback

```bash
bun scripts/architecture-ledger-al10-production-rollback-drill-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-production-rollback-drill-readback.json --json
bun scripts/architecture-ledger-al10-production-rollback-drill-readback.ts run --out docs/verification/architecture-ledger-al10-production-rollback-drill-readback.json --report docs/verification/architecture-ledger-al10-production-rollback-drill.md --json
```

VERIFIED: AL10-GA-7 production rollback drill returned ledger-authoritative mode to YAML authority with validation, ChangeSet journal, package boundary and contract evidence.
