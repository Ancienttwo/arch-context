# FG6-16 Ops Runbook Readback

- Task: FG6-16
- Environment: staging-release-readback
- Generated At: 2026-06-21T20:11:23.057Z
- Status: verified

## Runbook Sections

| Scenario | Section | Evidence |
|---|---|---|
| Device Key compromise | `device-key-compromise` | revoked Device reason DEVICE_REVOKED; nonceConsumed=false |
| Runner Key compromise | `runner-key-compromise` | revoked Runner reason RUNNER_REVOKED; recovery=register-replacement-runner-key |
| GitHub outage | `github-outage` | injected failures 2; DLQ=DEAD_LETTER; replay=PENDING |
| Queue backlog | `queue-backlog` | webhookBacklog=true; checkDlq=true; retryMessages=2 |

## Decision

PASS for FG6-16 ops/security runbook coverage.
