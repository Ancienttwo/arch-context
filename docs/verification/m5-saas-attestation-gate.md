# M5 SaaS / GitHub Attestation Gate

Date: 2026-06-19

## Scope

M5 implements the metadata-only control plane: GitHub OAuth/device auth contracts, user-level entitlement, Stripe subscription state mapping, GitHub App challenge/check lifecycle, signed local attestation verification, Cloudflare Worker route limits, D1 metadata schema, queue message shape, redaction, retention, and cost alerting.

## Evidence

- Control plane: `packages/cloud/control-plane/src/index.ts`.
- Control-plane client/token storage: `packages/cloud/control-plane-client/src/index.ts`.
- GitHub App: `packages/cloud/github-app/src/index.ts`.
- Attestation: `packages/cloud/attestation/src/index.ts`.
- D1 schema: `packages/cloud/cloud-db/src/index.ts`, `deploy/sql/0001_archcontext_control_plane.sql`.

## Verified Path

```text
GitHub PR event
  -> webhook signature + delivery idempotency
  -> review challenge
  -> queued check run
  -> local signed attestation
  -> SaaS verifies minimal proof
  -> check run update
  -> new head invalidates old challenge/check
```

## Verification

Command:

```bash
bun run verify
```

Observed result:

```text
83 pass
0 fail
privacy-route-audit OK
sprint-status-check structure OK
```

## Boundary Notes

- GitHub App permission contract has `contents: none`.
- D1 schema contains metadata only and is indexed for high-frequency queries.
- Attestation rejects replay, wrong SHA, wrong repository, expired challenge, and bad signature.
- Public repositories are free; Pro is user-level for private repositories.
- SaaS routes contain no upload/proxy/detail/embedding paths.
