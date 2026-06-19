# Privacy Packet Capture Evidence

## Purpose

Static route scans prove the SaaS code does not define upload routes. Packet capture evidence proves the runtime traffic also stays metadata-only.

This runbook validates sanitized HAR/JSON captures. It is safe to commit a sanitized capture only when bearer tokens and customer identifiers are redacted.

## Command

```bash
node scripts/privacy-packet-capture-audit.mjs docs/security/captures/metadata-only.har.json
```

Production captures should use the same command with the captured HAR path. The audit fails on source bodies, diff bodies, symbol payloads, CodeGraph payloads, architecture model bodies, detailed findings, local file paths, file URLs, unredacted bearer tokens, or token-like secrets.

## Evidence Standard

- Request and response bodies contain only IDs, digests, trust level, entitlement status, billing interval, numeric repository IDs, installation IDs, nonce/challenge IDs, and check IDs.
- Authorization headers must be `Bearer [REDACTED]` before committing.
- The fixture under `docs/security/captures/` is deterministic test evidence, not production evidence.
