# Sprint 2 Production Capture Readback

Date: 2026-06-20

## Result

Status: blocked.

Sprint 2 still has no verified staging or production packet capture. The repository has fixture captures that pass metadata-only audit, but `MR-EG5`, `TR-EG4`, and `HL-EG1` require external capture evidence before they can be marked green.

## Executable Gate

```bash
node scripts/privacy-capture-manifest.mjs readback
node scripts/privacy-capture-manifest.mjs readback --require-external
node scripts/privacy-capture-manifest.mjs readback --require-environment production
```

Expected current behavior:

- Default readback passes fixture integrity and reports pending external rows.
- `--require-external` fails until at least one verified staging or production capture is recorded.
- `--require-environment production` fails until `production.real-capture` is verified.

## Observed Manifest State

- `fixture.metadata-only`: verified.
- `fixture.sprint3-integrations`: verified.
- `staging.real-capture`: pending.
- `production.real-capture`: pending.

## Boundary

This readback hardens the gate; it does not provide production evidence. A future production or staging HAR must be sanitized, pass `scripts/privacy-packet-capture-audit.mjs`, and be recorded into `docs/security/captures/manifest.json`.
