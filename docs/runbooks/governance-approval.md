# Governance Approval Evidence

## Purpose

Human Gate approval is a governance artifact, not a test result. Agent-authored implementation evidence can prove repository behavior, but it cannot approve ADR governance decisions by itself.

## Approval Contract

Sprint approval artifacts live under `docs/approvals/`.

Required fields:

- `Status: Approved`
- `Date: YYYY-MM-DD`
- `Approved By: <human approver>`
- `Scope: <sprint slug and approved ADRs>`
- `Approved Boundary` section

For Sprint 2, the artifact must reference `archctx-s2`, `ADR-0026`, `ADR-0027`, and `ADR-0028`.

## Readback

```bash
node scripts/governance-approval-check.mjs readback \
  --artifact docs/approvals/archctx-sprint-2.md \
  --sprint archctx-s2 \
  --required-adr ADR-0026 \
  --required-adr ADR-0027 \
  --required-adr ADR-0028
```

The readback fails if the artifact is missing, not approved, missing required ADRs, missing an approved boundary, or self-attested by automation.
