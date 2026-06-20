# FG2 GitHub Privacy Verification

- Commit SHAs:
  - `0c81204833be188c095a0e3870882ce33dc6e559` — FG2-01 GitHub App permission manifest
  - `6db79fc35f8ac8722aa6abd1bcc6e4e45a38b3a7` — FG2-03 raw-body GitHub webhook HMAC verification
  - `635cc1c43f14727c13abf9a999c73eaff1a7400d` — FG2-04 Webhook delivery replay rejection
  - `f60ed79d3088588f080228ebeb58c132632d73ea` — FG2-05 GitHub webhook privacy projection
  - `6c0c22eec7e662e9090a4566c9af20a9ac8f3545` — FG2-06 GitHub webhook event family support
  - Pending first FG2-07 implementation commit — GitHub pull head metadata typed port
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used for FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, or FG2-07 local E2 slice
- Started At: 2026-06-20

## Scope

This evidence currently covers FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, and FG2-07.

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
- `projectVerifiedGitHubWebhook` verifies the raw bytes first, then parses JSON into a minimum `PullRequestEvent` projection.
- The returned projection retains no raw body and exposes only delivery ID, action, repository owner/name/visibility, PR number, and head SHA.
- Nonessential pull request payload fields are discarded before the event reaches `handlePullRequest`.
- Pull request webhook projection supports `opened`, `synchronize`, and `reopened`.
- Check run webhook projection supports only `rerequested` for ArchContext governance check names.
- `handleCheckRunRerequest` uses the delivery ledger, creates a fresh Review Challenge for the same head, and resets the addressed check to queued without reusing the earlier nonce.
- `GitHubGovernanceRestPort.getPullHeadMetadata` implements the contracts-owned `GitHubGovernancePort` method through a typed transport.
- Pull head metadata uses `GET /repositories/{repository_id}/pulls/{pull_number}` with GitHub's JSON accept header.
- The returned DTO contains only installation ID, repository ID, pull request number, head SHA, and base SHA.

## Commands

```bash
bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts
bun run typecheck
node scripts/privacy-route-audit.mjs
bun run verify
```

## Results

- `bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts`: PASS, 97 tests, 338 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts`: PASS, 13 tests, 69 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts`: PASS, 14 tests, 79 expects.
- `bun run typecheck`: PASS.
- `node scripts/privacy-route-audit.mjs`: PASS.
- `bun run verify`: PASS, 291 tests, 1235 expects, 53-entry acceptance ledger.

## Negative Tests

- Contract tests reject drift from the exact permission manifest.
- GitHub App tests reject adapter drift away from the contracts-owned repository permission object.
- GitHub App tests reject wrong secret, parsed/re-serialized body bytes, non-`sha256=` prefix, and malformed hex signature.
- GitHub App tests reject duplicate delivery replay by returning `ignore-duplicate` and preserving the existing challenge/check counts.
- Cloud DB tests assert `(provider, delivery_id)` is the delivery primary key and `raw_body` is absent from the migration SQL.
- GitHub App tests reject unsigned malformed JSON before payload projection.
- GitHub App tests prove nonessential pull request fields from the webhook payload do not appear in the returned projection.
- GitHub App tests reject unsupported Check Run actions and non-ArchContext check names.
- GitHub App tests prove `rerequested` creates a fresh challenge and duplicate rerequest deliveries do not create another challenge.
- GitHub App tests reject failed or malformed pull head metadata responses.
- GitHub App tests prove PR title, body, branch names, and change counts are not returned by `getPullHeadMetadata`.

## Known Limitations

FG2 is not complete. This slice does not claim staging GitHub App readback, Commit Statuses expected-source proof, full GitHub API allowlist, check create/update, egress recording, persistent Check Delivery retry queues, retention pruning, or install/revoke lifecycle handling.

## Decision

PARTIAL PASS for FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, and FG2-07. Remaining FG2 tasks and exit gates stay open.
