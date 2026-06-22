# FG6 Rollback Compatibility Readback

- Task: FG6-19
- Environment: local-release-readback
- Generated At: 2026-06-22T04:06:55.760Z
- Status: verified

## Decision

VERIFIED: rollback and compatibility gates pass.

## Schema Versions

- ReviewChallenge: `archcontext.review-challenge/v2`
- Attestation: `archcontext.attestation/v2`
- Challenge API old schema rejection: `challenge-api-schemaVersion-invalid: archcontext.challenge-create-request/v0`
- Key API old schema rejection: `key-api-schemaVersion-invalid: archcontext.device-key-register-request/v0`

## Rollback Drill

- Legacy migration: `legacy-audit-only`
- Required-check eligible: `false`
- Submit result: accepted=`false`, reason=`ATTESTATION_SCHEMA_UNSUPPORTED`
- Nonce consumed: `false`

## Check Contexts

- Developer Check: `ArchContext / Developer Review`
- Organization Check: `ArchContext / Organization Runner`
- Mismatch rejection: `TRUST_LEVEL_MISMATCH`

## Action Version

- Current runtime accepted: `true`
- Old runtime rejection: `runtime-version-mismatch`
- Action major pinned: `true`
- Reusable caller pinned by SHA: `true`
