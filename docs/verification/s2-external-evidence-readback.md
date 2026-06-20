# Sprint 2 External Evidence Readback

Date: 2026-06-20

## Result

Status: blocked.

Sprint 2 now has one executable readback for all remaining external/governance evidence. It aggregates the three strict gates that still block a full Sprint 2 launch/governance claim.
The acquisition handoff is recorded in `docs/verification/s2-external-evidence-handoff.md` and can be regenerated with `bun run handoff:s2:external`. Once the human approval, redacted capture, and external scan artifacts exist, record them with `node scripts/sprint2-external-evidence-record.mjs record`.

## Executable Gate

```bash
bun run handoff:s2:external
node scripts/sprint2-external-evidence-record.mjs record --environment production --capture docs/security/captures/production-redacted.har.json --scan-artifact docs/security/reviews/production-security-scan.md --critical 0 --high 0 --scanner external-security-scan
bun run readback:s2:external
node scripts/sprint2-external-evidence-readback.mjs readback --json
```

Expected current behavior:

- `CD-EG3` fails until `docs/approvals/archctx-sprint-2.md` is completed by a human approver and passes governance approval readback.
- `MR-EG5` / `TR-EG4` / `HL-EG1` fail until a verified staging or production packet capture is recorded.
- `HL-EG5` fails until a verified staging or production security scan is recorded with zero Critical and High findings.

## Acquisition Plan

1. Complete `docs/approvals/archctx-sprint-2.md` with a human approval for `archctx-s2` covering `ADR-0026`, `ADR-0027`, and `ADR-0028`.
2. Record a sanitized production or staging HAR through `scripts/privacy-capture-manifest.mjs`.
3. Record a production or staging security scan artifact through `scripts/security-scan-manifest.mjs`.

## Boundary

This readback bundle does not create evidence. It only proves whether the required external/governance artifacts have been recorded, completed, and are internally consistent.
