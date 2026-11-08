# Control Plane API Compatibility Policy

This policy applies to the control-plane API that `packages/cloud/control-plane` serves, documented in `docs/api/control-plane-openapi.yaml`.

## Versioning

- Every request body uses an explicit `schemaVersion`.
- New optional response fields are additive when they preserve the privacy contract and do not change existing behavior.
- New request fields require a new schema version unless the field is ignored by existing servers and cannot affect behavior.

## Breaking Changes

A change is breaking when it does any of the following:

- Removes or renames a route in `CONTROL_PLANE_ROUTES` in `packages/cloud/control-plane/src/routes.ts`.
- Reuses an existing request `schemaVersion` with different required fields or different behavior.
- Changes idempotency-key scope or replay behavior for writes.
- Adds a required request field to an existing request schema.
- Starts accepting repository content, diffs, patches, detailed findings, prompts, completions, raw webhook bodies, bearer tokens, private keys, or Secret Store values.
- Replaces metadata-only IDs, digests, statuses, reason codes, or timestamps with raw payload fields.

Breaking changes require a new route or a new `schemaVersion` and migration notes.

## Privacy Contract

The Control Plane may store and return:

- account, subscription, and notification provider identifiers;
- plan, billing interval, subscription status, notification secret references, statuses, reason codes, timestamps, and digests.

The Control Plane must not store or return:

- repository content, diffs, patches, symbols, detailed findings, prompts, completions, or model outputs;
- raw webhook bodies after signature projection;
- bearer tokens, private key material, Secret Store values, or unredacted credentials.

## Schema Inventory

- `schemas/cloud/cloud-egress-envelope.schema.json`

## Deprecation

- Deprecated routes stay available until a replacement route or schema version is documented.
- Deprecation must state the removal date, replacement route or schema version, migration command or procedure, and rollback behavior.
- A deprecated route must keep the same privacy guarantees until removal.

## Verification

Compatibility evidence must include:

- OpenAPI route coverage for the affected route;
- request `schemaVersion` coverage when a body is accepted;
- privacy-route audit and package-boundary verification.
