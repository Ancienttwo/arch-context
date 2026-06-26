# Architecture Ledger AL10 Telemetry Readback

## Scope

- Closes: AL10-13 only.
- Mode: local opt-in beta report assembled from verified AL10 readback packets.
- Keeps open: product interviews, independent reviewer, final Go/No-Go and all GA gates.
- Non-claim: this is not production telemetry and does not promote ledger authority.

## Source Readbacks

| Source | Status | Gates | Verified |
| --- | --- | --- | --- |
| rollout-workflow | verified | AL10-01, AL10-02 | yes |
| representative-benchmark | verified | AL10-03, AL10-04, AL10-BETA-1 | yes |
| hardening | verified | AL10-07, AL10-BETA-2, AL10-BETA-3, AL10-BETA-5, AL10-BETA-6 | yes |
| chaos-security | verified | AL10-05, AL10-06 | yes |
| recommendation-quality | verified | AL10-08, AL10-BETA-4 | yes |
| agent-comparison | verified | AL10-09 | yes |
| release-packaging | verified | AL10-10, AL10-11 | yes |
| runbooks | verified | AL10-12 | yes |

## Runs

- Verified telemetry sources: 8/8
- Representative fixtures: 3; entities/relations/constraints: 172/327/26
- Stress events: 1000; replayed: 1000
- Recommendation scenarios/practices: 190/26
- Agent comparison runs: 4; release migration states: 5

## Drift

- Dual-mode drift count: 0
- Clean fixture drift: 3/3
- Rollback restores YAML authority: yes

## Recommendations

- Top-3 recall: 100.0%
- Precision@3: 100.0%
- No-label structural recall: 100.0%
- Per-practice support: 90/90; violations: 0

## Agent Spawn

- Default hook samples: 9; median spawns: 0; total spawns: 0
- Explicit high-risk audit enqueue: yes
- Plus-agent comparison: 4 runs, 4769 estimated tokens, external cost $0

## Resolution And Failures

- Rollback demonstrated: yes
- Chaos/security cases OK: 6/6 and 6/6
- Privacy leak count: 0
- Eval failures / quality violations: 0/0
- Active beta risks: hook-enqueue-p95-beta-budget actual=154.458ms budget=150ms

## Readback

```bash
bun scripts/architecture-ledger-al10-telemetry-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-telemetry-readback.json --json
bun scripts/architecture-ledger-al10-telemetry-readback.ts run --out docs/verification/architecture-ledger-al10-telemetry-readback.json --report docs/verification/architecture-ledger-al10-telemetry.md --json
```
