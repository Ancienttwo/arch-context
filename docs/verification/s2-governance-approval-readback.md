# Sprint 2 Governance Approval Readback

Date: 2026-06-20

## Result

Status: blocked.

Sprint 2 has a human approval handoff template for the contract delta and ADR governance boundary. `CD-EG3` remains pending until `docs/approvals/archctx-sprint-2.md` is completed by a human approver and passes the governance approval readback.

## Executable Gate

```bash
node scripts/governance-approval-check.mjs readback \
  --artifact docs/approvals/archctx-sprint-2.md \
  --sprint archctx-s2 \
  --required-adr ADR-0026 \
  --required-adr ADR-0027 \
  --required-adr ADR-0028
```

Expected current behavior:

- The command fails because `docs/approvals/archctx-sprint-2.md` is still `Pending` and uses an approver placeholder.
- `scripts/sprint-status-check.mjs` rejects `CD-EG3` if it is marked green without a valid approval artifact.

## Required Approval Boundary

- `ADR-0026`: Multi-repo Landscape.
- `ADR-0027`: Trusted Runner Attestation.
- `ADR-0028`: Per-seat Billing v1.

## Boundary

This readback hardens the governance gate; it does not create human approval. The handoff artifact must be completed by a human approver and cannot be self-attested by an agent or automation.
