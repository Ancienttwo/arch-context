# FG2 GitHub Privacy Verification

- Commit SHAs:
  - `0c81204833be188c095a0e3870882ce33dc6e559` — FG2-01 GitHub App permission manifest
  - `6db79fc35f8ac8722aa6abd1bcc6e4e45a38b3a7` — FG2-03 raw-body GitHub webhook HMAC verification
  - Pending first FG2-04 implementation commit — Webhook delivery replay rejection
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used for FG2-01, FG2-03, or FG2-04 local E2 slice
- Started At: 2026-06-20

## Scope

This evidence currently covers FG2-01, FG2-03, and FG2-04.

- `GITHUB_APP_PERMISSION_MANIFEST` is contracts-owned in `packages/contracts/src/github-governance.ts`.
- The default repository permissions are exactly Metadata read, Pull Requests read, Checks write, and Contents none.
- Actions, Administration, Deployments, Issues, Members, Secrets, and Workflows are forbidden by default.
- Commit Statuses remains `none` and is documented as conditional on FG2-02 / FG2-EG6 staging evidence.
- Subscribed events are frozen to installation, installation repositories, pull request opened/reopened/synchronize/closed, and check run rerequested.
- `packages/cloud/github-app/src/index.ts` now derives `GITHUB_APP_PERMISSIONS` from the contracts manifest instead of maintaining a separate local copy.
- `verifyGitHubWebhookSignature` verifies `X-Hub-Signature-256` against `rawBody: string | Uint8Array`.
- Signature comparison now parses HMAC hex into fixed-length buffers and uses `timingSafeEqual`.
- Re-parsed/re-serialized JSON bodies do not verify against the original raw-body signature.
- `WebhookDeliveryLedger` records GitHub delivery IDs before challenge/check side effects.
- Replayed delivery IDs return `replayRejected: true` and `action: "ignore-duplicate"`.
- Duplicate delivery handling creates no extra Review Challenge and no extra Check Run.
- D1 schema owns the persistent idempotency boundary with `webhook_deliveries(provider, delivery_id, received_at)` and `PRIMARY KEY(provider, delivery_id)`.
- D1 privacy schema assertions reject raw webhook body storage in this slice.

## Commands

```bash
bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts
bun run typecheck
```

## Results

- `bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts`: PASS, 87 tests.
- `bun test packages/cloud/github-app/test/github-app.test.ts`: PASS, 3 tests.
- `bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts`: PASS, 5 tests, 40 expects.
- `bun run typecheck`: PASS.

## Negative Tests

- Contract tests reject drift from the exact permission manifest.
- GitHub App tests reject adapter drift away from the contracts-owned repository permission object.
- GitHub App tests reject wrong secret, parsed/re-serialized body bytes, non-`sha256=` prefix, and malformed hex signature.
- GitHub App tests reject duplicate delivery replay by returning `ignore-duplicate` and preserving the existing challenge/check counts.
- Cloud DB tests assert `(provider, delivery_id)` is the delivery primary key and `raw_body` is absent from the migration SQL.

## Known Limitations

FG2 is not complete. This slice does not claim staging GitHub App readback, Commit Statuses expected-source proof, webhook privacy projection, GitHub API allowlist, egress recording, retention pruning, or install/revoke lifecycle handling.

## Decision

PARTIAL PASS for FG2-01, FG2-03, and FG2-04. Remaining FG2 tasks and exit gates stay open.
