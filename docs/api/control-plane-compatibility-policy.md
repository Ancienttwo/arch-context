# Control Plane API Compatibility Policy

This policy applies to the FG5 GitHub governance control-plane API documented in `docs/api/control-plane-openapi.yaml`.

## Versioning

- Every request body uses an explicit `schemaVersion`.
- Current Challenge request versions are `archcontext.challenge-create-request/v1`, `archcontext.challenge-get-request/v1`, `archcontext.challenge-list-request/v1`, `archcontext.challenge-lease-request/v1`, `archcontext.challenge-submit-request/v1`, and `archcontext.challenge-cancel-request/v1`.
- Current Key request versions are `archcontext.device-key-register-request/v1`, `archcontext.device-key-revoke-request/v1`, `archcontext.runner-key-register-request/v1`, `archcontext.runner-key-rotate-request/v1`, and `archcontext.runner-key-revoke-request/v1`.
- New optional response fields are additive when they preserve the privacy contract and do not change existing state-machine meaning.
- New request fields require a new schema version unless the field is ignored by existing servers and cannot affect behavior.

## Breaking Changes

A change is breaking when it does any of the following:

- Removes or renames a route in `CONTROL_PLANE_ROUTES`.
- Reuses an existing request `schemaVersion` with different required fields or different behavior.
- Changes Challenge, Check Delivery, Device Key, Runner Key, or Attestation state-machine meaning.
- Changes idempotency-key scope or replay behavior for writes.
- Adds a required request field to an existing request schema.
- Starts accepting repository content, diffs, patches, detailed findings, prompts, completions, raw webhook bodies, bearer tokens, installation tokens, private keys, or Secret Store values.
- Replaces metadata-only IDs, digests, statuses, reason codes, or timestamps with raw payload fields.

Breaking changes require a new route or a new `schemaVersion`, migration notes, and acceptance-ledger evidence.

## Privacy Contract

The Control Plane may store and return:

- installation, repository, pull request, Challenge, Attestation, Check delivery, Device, and Runner identifiers;
- head/base SHAs, tree OIDs, workflow refs, public key IDs, public key fingerprints, statuses, reason codes, timestamps, and digests;
- retry, DLQ, audit, alert, and metric metadata.

The Control Plane must not store or return:

- repository content, diffs, patches, symbols, detailed findings, prompts, completions, or model outputs;
- raw webhook bodies after signature projection;
- bearer tokens, installation tokens, private key material, Secret Store values, or unredacted credentials.

## Schema Inventory

- `schemas/cloud/review-challenge-v2.schema.json`
- `schemas/cloud/attestation-v2.schema.json`
- `schemas/cloud/check-delivery.schema.json`
- `schemas/cloud/runner-identity.schema.json`
- `schemas/cloud/device-identity.schema.json`
- `schemas/cloud/governance-key-status.schema.json`
- `schemas/cloud/cloud-egress-envelope.schema.json`

## Deprecation

- Deprecated routes stay available until a replacement route or schema version is documented.
- Deprecation must state the removal date, replacement route or schema version, migration command or procedure, and rollback behavior.
- A deprecated route must keep the same privacy guarantees until removal.

## Verification

Compatibility evidence must include:

- OpenAPI route coverage for the affected route;
- request `schemaVersion` coverage when a body is accepted;
- state-machine regression tests for Challenge, Check Delivery, Device Key, Runner Key, or Attestation changes;
- privacy-route audit and package-boundary verification;
- acceptance-ledger entry for the completed sprint task.
