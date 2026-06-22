# FG6-18 Rollout Evidence Intake

- Task: FG6-18
- Environment: production-rollout
- Home URL: https://archcontext.repoharness.com
- Generated At: 2026-06-21T20:44:11.502Z
- Status: blocked

## Required Source Packet

Place the no-secret production rollout packet at `_ops/env/fg6-rollout-evidence.json`, then run:

```bash
bun run readback:fg6:rollout
```

The packet must prove the ordered rollout path `internal -> design-partners -> opt-in-beta`, at least one design partner installation, at least one opt-in beta installation, zero P0/P1 incidents, zero privacy incidents, zero source-content leaks, zero wrong-trust passes, and SLO observations within PRD budgets.

## Current Decision

BLOCKED for FG6-18 rollout readback.

- rollout phases must be internal -> design-partners -> opt-in-beta
- rollout phase timestamps must be ordered
- all rollout phases must be completed
- all rollout cohorts must have at least one installation
- design partner rollout evidence is missing
- opt-in beta rollout evidence is missing
- required check success rate below target
- Check delivery p95 exceeds PRD budget
- webhook p95 exceeds PRD budget
- rollout control missing: featureFlagsDoNotBypassPrivacy
- rollout control missing: featureFlagsDoNotBypassSignature
- rollout control missing: privacyContractGreen
- rollout control missing: signatureVerificationGreen
- rollout control missing: rollbackPlanReady
- rollout control missing: supportRunbookReady
- assertion productionEvidence must be true
- assertion phaseSequenceComplete must be true
- assertion phaseTimelineOrdered must be true
- assertion cohortsNonEmpty must be true
- assertion designPartnerEvidencePresent must be true
- assertion optInBetaEvidencePresent must be true
- assertion sloWithinBudget must be true
- assertion controlsPreserveSecurity must be true
