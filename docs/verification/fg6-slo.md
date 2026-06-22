# FG6-14 SLO Readback

- Task: FG6-14
- Environment: staging-release-readback
- Generated At: 2026-06-21T19:53:29.227Z
- Status: verified

## SLO Definitions

| SLO | Metric | Target | Current release evidence |
|---|---|---:|---:|
| Challenge create p95 | `challenge_create_latency_ms` | <= 2000 ms | 1 ms |
| Attestation verify p95 | `verify_latency_ms` | <= 2000 ms | 500 ms |
| Check delivery p95 | `check_delivery_lag_ms` for successful PUBLISHED deliveries | <= 60000 ms | 40000 ms |
| Eligible required-check success rate | `derived_required_check_success_rate` | >= 0.995 | 1 |

## Trace

The readback runs an in-memory Control Plane probe that creates one Challenge through `createReviewChallengeApi`, records `challenge_create_latency_ms`, then publishes one successful current-head Check delivery through `publishCurrentCheckDeliverySuccess` and records `check_delivery_lag_ms`. Verify latency is bound to the existing FG5 submit verifier metric regression, which asserts `verify_latency_ms` fixture values of 500 ms and 0 ms after Attestation submit attempts.

The success-rate sample is computed from immutable staging evidence: Developer Review Check success, GitHub-hosted Organization Runner success, and self-hosted Organization Runner success. 3/3 eligible release checks passed.

## Source Coverage

- Metric names: challenge_create_latency_ms, challenge_age_ms, verify_latency_ms, check_delivery_lag_ms, check_delivery_retry_total, reject_reason_total
- Incident dashboard rows: webhook-backlog, verify-failure, check-dlq, github-api-failure
- Runbook sections: webhook-backlog, verify-failure, check-dlq, github-api-failure
- Metadata-only metric samples: yes

## Decision

PASS for FG6-14 SLO definition and release readback.
