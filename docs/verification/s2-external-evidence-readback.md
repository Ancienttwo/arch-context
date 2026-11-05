# Sprint 2 External Evidence Readback

Date: 2026-06-20

## Result

Status: blocked.

Sprint 2 now has one executable readback for all remaining external evidence. It aggregates the two strict gates that still block a full Sprint 2 launch claim. CD-EG3 is closed without approval on [issue #487](https://github.com/Ancienttwo/arch-context/issues/487).
The acquisition handoff is recorded in `docs/verification/s2-external-evidence-handoff.md` and can be regenerated with `bun run handoff:s2:external`. Once the redacted capture and external scan artifacts exist, record them with `node scripts/sprint2-external-evidence-record.mjs record`.

## Executable Gate

```bash
bun run handoff:s2:external
node scripts/sprint2-external-evidence-record.mjs record --environment production --capture docs/security/captures/production-redacted.har.json --scan-artifact docs/security/reviews/production-security-scan.md --critical 0 --high 0 --scanner external-security-scan
bun run readback:s2:external
node scripts/sprint2-external-evidence-readback.mjs readback --json
```

Expected current behavior:

- `MR-EG5` / `TR-EG4` / `HL-EG1` fail until a verified staging or production packet capture is recorded.
- `HL-EG5` fails until a verified staging or production security scan is recorded with zero Critical and High findings.

## Acquisition Plan

1. Record a sanitized production or staging HAR through `scripts/privacy-capture-manifest.mjs`.
2. Record a production or staging security scan artifact through `scripts/security-scan-manifest.mjs`.

## Boundary

This readback bundle does not create evidence. It only proves whether the required external artifacts have been recorded and are internally consistent.
