# Security Scan Evidence

## Purpose

Deterministic repository security reviews prove the local implementation surface has no known Critical or High findings. Production launch claims require a separate staging or production security scan artifact.

## Evidence Manifest

Every committed security review or scan artifact must be registered in `docs/security/scans/manifest.json`.

Read back the current ledger:

```bash
node scripts/security-scan-manifest.mjs readback
```

Require a real staging or production scan before launch claims:

```bash
node scripts/security-scan-manifest.mjs readback --require-external
node scripts/security-scan-manifest.mjs readback --require-environment production
```

Record a completed production scan only after its artifact is committed and Critical/High counts are known:

```bash
node scripts/security-scan-manifest.mjs record \
  --environment production \
  --artifact docs/security/reviews/production-security-scan.md \
  --id production.security-scan \
  --critical 0 \
  --high 0 \
  --scanner external-security-scan
```

The strict readback flags fail until at least one external scan, or the requested production scan, is verified with zero Critical and zero High findings.
