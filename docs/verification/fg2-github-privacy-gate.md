# FG2 GitHub Privacy Verification

- Commit SHAs:
  - `0c81204833be188c095a0e3870882ce33dc6e559` — FG2-01 GitHub App permission manifest
  - `6db79fc35f8ac8722aa6abd1bcc6e4e45a38b3a7` — FG2-03 raw-body GitHub webhook HMAC verification
  - `635cc1c43f14727c13abf9a999c73eaff1a7400d` — FG2-04 Webhook delivery replay rejection
  - `f60ed79d3088588f080228ebeb58c132632d73ea` — FG2-05 GitHub webhook privacy projection
  - `6c0c22eec7e662e9090a4566c9af20a9ac8f3545` — FG2-06 GitHub webhook event family support
  - `c3db4ba63e4cd5532130846c23606b9fb7fd4506` — FG2-07 GitHub pull head metadata typed port
  - `4faf17c721b9b1f7692a7c3f04ef46196d8909c3` — FG2-08 GitHub Check create/update typed port
  - `669d8a8165d723b8ea77c30c8d9d3e35ed22f923` — FG2-09 GitHub API method/path allowlist
  - `340a75120f7e6df41575a654aca9df9e6f08c873` — FG2-10 forbidden GitHub code endpoint rejection
  - `a2e16fe01b932a698fe242411cbcc56566c99642` — FG2-11 forbidden GitHub diff/patch media type rejection
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used for FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, FG2-07, FG2-08, FG2-09, FG2-10, or FG2-11 local E2 slice
- Started At: 2026-06-20

## Scope

This evidence currently covers FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, FG2-07, FG2-08, FG2-09, FG2-10, and FG2-11.

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
- `createCheckRun` uses `POST /repositories/{repository_id}/check-runs` and sends only check name, head SHA, and status.
- `updateCheckRun` uses `PATCH /repositories/{repository_id}/check-runs/{check_run_id}` and sends only check name, status, optional conclusion, and output title/summary.
- Check create/update return or consume only the contracts-owned Check DTOs; no generic REST client is exposed to the application layer.
- `assertGitHubGovernanceApiRequestAllowed` enforces the runtime method/path allowlist before transport execution.
- The current allowlist accepts only pull-head metadata GET, Check create POST, and Check update PATCH.
- Unknown categories, methods, paths, path templates, or non-JSON accept headers fail closed with `github-api-request-denied`.
- `identifyForbiddenGitHubGovernanceApiEndpoint` names PR Files, Repository Contents, Git Blob, and Git Tree endpoints before the generic allowlist fallback.
- Forbidden endpoint variants using owner/repo paths and repository-id paths fail closed with `github-api-forbidden-endpoint` before transport execution.
- `identifyForbiddenGitHubGovernanceAcceptHeader` names GitHub diff and patch media types before the generic non-JSON fallback.
- Diff and patch `Accept` values, including comma-separated and parameterized variants, fail closed with `github-api-forbidden-accept` before transport execution.

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

- `bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts`: PASS, 103 tests, 383 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts`: PASS, 19 tests, 114 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts`: PASS, 20 tests, 124 expects.
- `bun run typecheck`: PASS.
- `node scripts/privacy-route-audit.mjs`: PASS.
- `bun run verify`: PASS, 297 tests, 1280 expects, 57-entry acceptance ledger.

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
- GitHub App tests reject failed Check create/update responses.
- GitHub App tests prove Check create/update request bodies do not include installation IDs, repository IDs, check IDs, PR numbers, or private payload fields.
- GitHub App tests prove unknown methods, paths, categories, and media types are denied by the API allowlist.
- GitHub App tests prove PR Files, Repository Contents, Git Blob, and Git Tree endpoint variants are explicitly identified and rejected before transport.
- GitHub App tests prove GitHub diff and patch media types are explicitly identified and rejected before transport.

## Known Limitations

FG2 is not complete. This slice does not claim staging GitHub App readback, Commit Statuses expected-source proof, egress recording, persistent Check Delivery retry queues, retention pruning, or install/revoke lifecycle handling.

## Decision

PARTIAL PASS for FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, FG2-07, FG2-08, FG2-09, FG2-10, and FG2-11. Remaining FG2 tasks and exit gates stay open.
