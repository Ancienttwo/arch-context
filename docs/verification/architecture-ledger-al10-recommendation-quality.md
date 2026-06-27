# Architecture Ledger AL10 Recommendation Quality Readback

## Scope

- Closes: AL10-08 and AL10-BETA-4.
- Keeps open: AL10-09 deterministic-plus-agent comparison, release, runbook, telemetry, governance and GA gates.
- Authority: `evals/run.ts` representative recommendation suite plus frozen JSONL dataset digests.

## Metrics

| Metric | Observed | Threshold |
| --- | ---: | ---: |
| Practice Top-3 recall | 100.0% | >= 92.0% |
| Recommendation precision@3 | 100.0% | >= 80.0% |
| No-keyword structural recall | 100.0% | >= 90.0% |
| Direct-reference recall | 100.0% | >= 100.0% |
| Evidence-shuffle contamination | 0.0% | 0.0% |
| Heuristic-only hard-gate rate | 0.0% | 0.0% |
| Dynamic-doc hard-gate rate | 0.0% | 0.0% |

## Frozen Datasets

| Dataset | Cases | SHA-256 |
| --- | ---: | --- |
| `evals/practices/structural-positive.jsonl` | 30 | `sha256:8b83c7e7bd63f03fddae7163f45ba4ee7765fd5ff1ae5c63d6c1c06a1076a214` |
| `evals/practices/no-keyword-structural-positive.jsonl` | 30 | `sha256:d391c93e55a296279407646d0075f210f33eb35d4791d3079de8c801814641a9` |
| `evals/practices/direct-practice-reference.jsonl` | 30 | `sha256:f9e6f7d39093ce34c707361999f66c1bd7e67f1b7e9ec318e3a70d6f04dfb2f5` |
| `evals/practices/benign-negative.jsonl` | 30 | `sha256:27346166a65a941e6ad5ba3a06ceb7457a488a0740bd26b9628e690554de01c3` |
| `evals/practices/keyword-heavy-benign-negative.jsonl` | 30 | `sha256:1491d43ad71018de5f88adcb9c01efd7d17639afff5c80f0dd88e672b70b8a1d` |
| `evals/practices/budget-irrelevant-resource.jsonl` | 20 | `sha256:429c6a611778e1634d846ba70b8c3b1a2c6a2ddbe329743111f27d7176c2a114` |
| `evals/practices/enforcement-waiver-adversarial.jsonl` | 20 | `sha256:f7331631179b2480d24043f5116afe7d5df9f657ff3142f7ee285e6ad1d5eb2c` |

## Blind No-Label Set

- Cases: 30
- Evidence arrays empty: true
- Practice bindings absent: true
- Task label leakage cases: 0
- Dataset metadata violations: 0

## Per-Practice Support

| Practice | Expected | Matched | Recall | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `api.backward-compatible-error-shape` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `api.contract-before-implementation` | 5 | 5 | 100.0% | 5 | 0 | 0 |
| `api.schema-version-contract` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `compatibility.expiry-contract` | 8 | 8 | 100.0% | 8 | 0 | 0 |
| `compatibility.single-owner` | 8 | 8 | 100.0% | 8 | 0 | 0 |
| `data.event-version-lineage` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `data.migration-backfill-evidence` | 2 | 2 | 100.0% | 2 | 0 | 0 |
| `data.single-authoritative-model` | 7 | 7 | 100.0% | 7 | 0 | 0 |
| `decision.decision-review-date` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `decision.record-significant-change` | 6 | 6 | 100.0% | 6 | 0 | 0 |
| `decision.supersession-link` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `decision.tradeoff-options-recorded` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `migration.parallel-run-observability` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `migration.target-and-removal-state` | 7 | 7 | 100.0% | 7 | 0 | 0 |
| `modularity.layer-contract-declared` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `modularity.no-new-cycle` | 6 | 6 | 100.0% | 6 | 0 | 0 |
| `modularity.no-shared-internal-imports` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `modularity.respect-dependency-direction` | 6 | 6 | 100.0% | 6 | 0 | 0 |
| `observability.boundary-telemetry` | 7 | 7 | 100.0% | 7 | 0 | 0 |
| `observability.error-budget-signal` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `observability.queue-boundary-metrics` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `observability.release-health-probe` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `ownership.escalation-contact` | 1 | 1 | 100.0% | 1 | 0 | 0 |
| `ownership.explicit-lifecycle-owner` | 7 | 7 | 100.0% | 7 | 0 | 0 |
| `security.least-privilege` | 6 | 6 | 100.0% | 6 | 0 | 0 |
| `supply-chain.pinned-dependencies` | 2 | 2 | 100.0% | 2 | 0 | 0 |

## Readback

```bash
bun scripts/architecture-ledger-al10-recommendation-quality-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-recommendation-quality-readback.json --json
bun evals/run.ts --check
```
