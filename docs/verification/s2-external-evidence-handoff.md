# Sprint 2 External Evidence Handoff Packet

Date: 2026-06-20

## Result

Status: blocked.

This packet is the handoff for the remaining non-deterministic Sprint 2 evidence. It does not create packet captures or security scan results. It fixes the artifact paths, commands, and readback surface that must be used by the external evidence owner. CD-EG3 is closed without approval on [issue #487](https://github.com/Ancienttwo/arch-context/issues/487).

## Current Gate State

| Gate | Status | Evidence | Failure |
|---|---|---|---|
| `MR-EG5` / `TR-EG4` / `HL-EG1` | blocked | `docs/security/captures/manifest.json` | missing verified staging or production capture |
| `HL-EG5` | blocked | `docs/security/scans/manifest.json` | missing verified staging or production security scan |

## Required Actions

1. Capture staging or production SaaS traffic, redact secrets/customer identifiers, save it as `docs/security/captures/production-redacted.har.json` or `docs/security/captures/staging-redacted.har.json`.
2. Commit a staging or production security scan artifact with zero Critical and High findings.
3. Run the combined recorder. It records capture and scan evidence, then immediately runs strict Sprint 2 readback.

## Commands

```bash
node scripts/sprint2-external-evidence-record.mjs record \
  --environment production \
  --capture docs/security/captures/production-redacted.har.json \
  --scan-artifact docs/security/reviews/production-security-scan.md \
  --critical 0 \
  --high 0 \
  --scanner external-security-scan
```

Underlying commands remain available for auditability:

```bash
node scripts/privacy-packet-capture-audit.mjs docs/security/captures/production-redacted.har.json
node scripts/privacy-capture-manifest.mjs record \
  --environment production \
  --capture docs/security/captures/production-redacted.har.json \
  --id production.real-capture
```

```bash
node scripts/security-scan-manifest.mjs record \
  --environment production \
  --artifact docs/security/reviews/production-security-scan.md \
  --id production.security-scan \
  --critical 0 \
  --high 0 \
  --scanner external-security-scan
```

```bash
bun run readback:s2:external
node scripts/sprint2-external-evidence-readback.mjs readback --json
```

## Boundary

This handoff is sufficient to coordinate the remaining evidence because every command writes to or reads back the same artifact paths used by the Sprint 2 strict gates. It is not sufficient to mark Sprint 2 fully launch-ready until the recorder and readback command both return `ready`.
