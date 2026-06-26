# Architecture Ledger AL8 Waiver Review Readback

Generated: 2026-06-26T08:42:43.122Z
Status: verified

## Gates

- AL8-09
- AL8-10
- AL8-EG2
- AL8-EG3
- AL8-EG4

## Evidence

- Waiver review date: 2026-07-10T00:00:00.000Z; invalid window: practice-waiver-review-window-invalid.
- Waiver application: waived; expired/tampered/overscoped violations: 1/1/1.
- Recommendation gate: advisory=pass; advisory-hard-gate=fail_action_required; complete-without-eligibility=fail_action_required; complete-with-eligibility=pass.
- Agent threshold: default=high/high; medium-risk=false; medium-uncertainty=false; high/high=true.
- DLP: raw-source-sentinel=false; raw-diff=false.

## P1 Map

The module boundary spans practice waiver contracts, runtime/CLI waiver creation, review-engine complete gating, and runtime agent dispatch thresholds.

## P2 Trace

A waiver is validated with owner, exact scope, evidence digest, expiry, and review date before practice enforcement can suppress a complete violation. A recommendation reaches complete_task only as context; advisory recommendations remain non-gating, and complete recommendations require explicit policy eligibility. Runtime agent enqueue passes risk and uncertainty through the same context/job boundary before policy evaluation.

## P3 Decision

The change keeps durable exceptions and hard gates explicit. Waivers remain ChangeSet-governed files, recommendations do not silently upgrade advisory findings, and automatic L3 agent dispatch defaults to high-risk/high-uncertainty only.
