# Architecture Ledger AL10 Agent Comparison Readback

## Scope

- Closes: AL10-09 only.
- Keeps open: release packaging, runbooks, telemetry, governance, Go/No-Go and GA gates.
- Authority: deterministic representative eval remains the gate; agent output is advisory-only.

## Outcome Comparison

- Deterministic status: passed
- Plus-agent status: passed
- Metric deltas: 0
- Quality violation deltas: 0
- Added advisory findings: 3

## Cost Comparison

| Mode | Agent runs | Attempts | Estimated tokens | Duration ms | External provider cost USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Deterministic only | 0 | 0 | 0 | 0 | 0 |
| Deterministic plus agent | 4 | 4 | 4769 | 90 | 0 |

## Agent Cases

| Case | Deterministic outcome | Findings | Tokens | Duration ms |
| --- | --- | ---: | ---: | ---: |
| blind-no-label-positive | expected-practice-matched | 1 | 1273 | 24 |
| direct-reference-positive | typed-evidence-matched | 1 | 1286 | 21 |
| benign-negative | no-non-advisory-match | 0 | 963 | 18 |
| waiver-adversarial | invalid-waiver-rejected | 1 | 1247 | 27 |

## Readback

```bash
bun scripts/architecture-ledger-al10-agent-comparison-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-agent-comparison-readback.json --json
bun evals/run.ts --check
```
