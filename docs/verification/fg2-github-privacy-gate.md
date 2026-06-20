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
  - `722c0e8de38dfba85a0f0a74356303ad37d36b8c` — FG2-12 generic Octokit client lint boundary
  - `ef0ec3093fdbe57bfdc973902a0ea9d0cc489caa` — FG2-13 GitHub egress recorder
  - `449de452139052dc80f08c42f03b4853d325bcf4` — FG2-14 Cloud privacy surface projection
  - `82b7445def774c72623b3340d186dd8a160b83e1` — FG2-15 Cloud private content bait fixture
  - `39a8bf62b214f49fed8d6f4c471b658924ea8c34` — FG2-16 static Privacy Contract scan
  - `15f3b42c3e7c08fe2fb2f2e789be3e0d636f23d6` — FG2-18 installation lifecycle handling
  - `126b031e5048eac47f54fff323523ff72e20470b` — FG2-19 GitHub App install disclosure
  - `5b59c7b54384563e3cd2d1921146b56627bd785c` — FG2-20 GitHub governance threat model update
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used for FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, FG2-07, FG2-08, FG2-09, FG2-10, FG2-11, FG2-12, FG2-13, FG2-14, FG2-15, FG2-16, FG2-18, FG2-19, or FG2-20 local E1/E2/E3 slice
- Started At: 2026-06-20

## Scope

This evidence currently covers FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, FG2-07, FG2-08, FG2-09, FG2-10, FG2-11, FG2-12, FG2-13, FG2-14, FG2-15, FG2-16, FG2-18, FG2-19, and FG2-20. FG2-17 remains a pending staging readback artifact only.

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
- Installation webhook projection supports `created` and `deleted` with only installation ID and selected repository metadata.
- Installation repository webhook projection supports `added` and `removed` with only added/removed repository IDs, full names, owner/name, and visibility.
- `GitHubAppState` applies installation create/delete and repository selection changes idempotently through the delivery ledger.
- Removing or revoking a repository clears selected repository state and organization attestation requirements; subsequent PR/rerequest handling rejects unselected repositories before challenge/check side effects.
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
- `scripts/github-api-contract-audit.mjs` provides the repo-local `bun run verify:github-api-contract` entrypoint.
- The current audit rejects generic Octokit imports and generic GitHub client injection identifiers in production Cloud/Contracts sources.
- The static Privacy Contract scan rejects forbidden GitHub endpoint literals, non-allowlisted GitHub endpoint literals, methods outside GET/POST/PATCH in GitHub API contract files, and diff/patch GitHub media types.
- `bun run verify:privacy-contract` is an explicit alias for the same static Privacy Contract gate; `bun run verify:github-api-contract` remains the compatibility entrypoint used by FG2-EG3.
- `RecordingGitHubGovernanceApiTransport` wraps a typed GitHub transport and records a `CloudEgressEnvelope` after allowed requests complete.
- Recorded GitHub egress contains only request ID, endpoint category, method, host, path template, status, latency, and timestamp.
- The recorder does not persist concrete GitHub paths, request bodies, response bodies, installation IDs, repository IDs, PR numbers, head/base SHAs, or private PR metadata.
- `projectCloudPrivacySurface` centralizes log, trace, queue, and error-object projection for Cloud privacy surfaces.
- Control-plane queue messages now pass through the queue projection before storage.
- Structured log/trace projection keeps only low-sensitivity identifiers and turns full `headSha` into `headShaPrefix`.
- Error projection keeps low-sensitivity error codes/status/request context and drops message/private content fields.
- `docs/security/fixtures/cloud-private-content-bait.json` carries source code, patch, symbol, and finding bait values.
- `scripts/cloud-private-content-bait.test.ts` proves the bait cannot enter Cloud DTOs: control-plane log/trace/queue/error projections, notification event DTO/schema, and cloud-egress envelope schema.
- `docs/verification/fg2-egress-recording.json` is the pending FG2-17 staging readback artifact for GitHub egress and bait-hit counts.
- `scripts/github-egress-recording-readback.mjs` verifies a future staging recording by requiring allowlisted GitHub egress categories, zero forbidden endpoint/media counts, and zero log/trace/queue bait hits.
- The control-plane GitHub App tab exposes install/reconfigure state, selected-repository installation wording, permission names, permission uses, and retention defaults.
- The install disclosure states that ArchContext does not read code to run Review; the local runtime signs the result and the SaaS verifies metadata.
- The install disclosure lists Commit Statuses as `None now` and explicitly ties any change to the FG2-02 staging decision.
- `docs/security/threat-model-v1.md` now names GitHub App permission expansion, SDK/API drift, webhook replay/forgery, and raw payload/log leakage as explicit FG2 threats.
- The threat model traces webhook raw body/signature/delivery ID through projection, replay handling, selected-repository checks, challenge/check side effects, typed egress, and metadata-only recording.
- The threat model preserves the current open gates: FG2-02 for any future Commit Statuses permission and FG2-17 for live staging egress recording.

## Commands

```bash
bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts
bun test packages/cloud/control-plane/test/control-plane.test.ts
bun test scripts/github-api-contract-audit.test.ts
bun test scripts/cloud-private-content-bait.test.ts
bun test scripts/github-egress-recording-readback.test.ts
bun test packages/cloud/control-plane/test/control-plane-ui.test.ts
bun run typecheck
node scripts/privacy-route-audit.mjs
bun run verify:github-api-contract
bun run verify:privacy-contract
bun run readback:fg2:egress
bun run verify:acceptance-ledger
bun run check:sprint
bun run verify
```

## Results

- `bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts`: PASS, 108 tests, 417 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts`: PASS, 24 tests, 148 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts`: PASS, 25 tests, 158 expects.
- `bun test packages/cloud/control-plane/test/control-plane.test.ts`: PASS, 7 tests, 51 expects.
- `bun test scripts/github-api-contract-audit.test.ts`: PASS, 7 tests, 14 expects.
- `bun test scripts/cloud-private-content-bait.test.ts`: PASS, 1 test, 38 expects.
- `bun test scripts/github-egress-recording-readback.test.ts`: PASS, 4 tests, 5 expects.
- `bun test packages/cloud/control-plane/test/control-plane-ui.test.ts`: PASS, 10 tests, 33 expects.
- `bun run typecheck`: PASS.
- `node scripts/privacy-route-audit.mjs`: PASS.
- `bun run verify:github-api-contract`: PASS, scanned 18 production files.
- `bun run verify:privacy-contract`: PASS, scanned 18 production files.
- `bun run readback:fg2:egress`: PENDING, exits successfully only with `--allow-pending`; strict readback remains blocked until staging export exists.
- `bun run verify:acceptance-ledger`: PASS, 65 entries.
- `bun run check:sprint`: PASS, structure and evidence claims OK.
- `bun run verify`: PASS, 317 tests, 1399 expects, 65-entry acceptance ledger.

## Negative Tests

- Contract tests reject drift from the exact permission manifest.
- GitHub App tests reject adapter drift away from the contracts-owned repository permission object.
- GitHub App tests reject wrong secret, parsed/re-serialized body bytes, non-`sha256=` prefix, and malformed hex signature.
- GitHub App tests reject duplicate delivery replay by returning `ignore-duplicate` and preserving the existing challenge/check counts.
- Cloud DB tests assert `(provider, delivery_id)` is the delivery primary key and `raw_body` is absent from the migration SQL.
- GitHub App tests reject unsigned malformed JSON before payload projection.
- GitHub App tests prove nonessential pull request fields from the webhook payload do not appear in the returned projection.
- GitHub App tests reject unsupported Check Run actions and non-ArchContext check names.
- GitHub App tests reject unsupported installation and installation repository actions.
- GitHub App tests prove installation creation, repository selection changes, and revocation are idempotent and that PR handling fails after revocation.
- GitHub App tests prove `rerequested` creates a fresh challenge and duplicate rerequest deliveries do not create another challenge.
- GitHub App tests reject failed or malformed pull head metadata responses.
- GitHub App tests prove PR title, body, branch names, and change counts are not returned by `getPullHeadMetadata`.
- GitHub App tests reject failed Check create/update responses.
- GitHub App tests prove Check create/update request bodies do not include installation IDs, repository IDs, check IDs, PR numbers, or private payload fields.
- GitHub App tests prove unknown methods, paths, categories, and media types are denied by the API allowlist.
- GitHub App tests prove PR Files, Repository Contents, Git Blob, and Git Tree endpoint variants are explicitly identified and rejected before transport.
- GitHub App tests prove GitHub diff and patch media types are explicitly identified and rejected before transport.
- GitHub API contract audit tests prove typed `GitHubGovernancePort` stays allowed while generic Octokit imports and `githubClient` injection are rejected.
- GitHub API contract audit tests prove the explicit denylist declarations stay allowed while forbidden endpoint literals, non-allowlisted endpoint literals, forbidden methods, and diff/patch media types are rejected in production sources.
- GitHub App tests prove the egress recorder emits only `CloudEgressEnvelope` metadata and excludes concrete paths, request/response bodies, repository identifiers, PR identifiers, and private PR fields.
- Control-plane tests prove log, trace, queue, and error surfaces keep only projected fields and remove private content fields before storage.
- Control-plane UI tests prove the public GitHub App install disclosure lists current permissions, permission uses, retention defaults, the local Review privacy promise, and the FG2-02 Commit Statuses pending decision.
- Threat model review proves FG2 security docs cover permission expansion, SDK/API drift, raw payload/log leakage, and webhook replay without claiming FG2-02 or FG2-17 are complete.
- Cloud private content bait tests prove source, Patch, Symbol, and Finding fixture values are removed from projected Cloud surfaces and rejected by notification/egress DTO schema.
- GitHub egress recording readback tests reject nonzero PR Files/Contents/Blob/Tree/Diff/Patch and log/trace/queue bait counts in a verified staging artifact.

## Known Limitations

FG2 is not complete. FG2-02 remains open for the Commit Statuses expected-source staging decision, and FG2-17 remains open because no deployed staging GitHub App, staging installation, sanitized GitHub egress recorder export, or staging log/trace/queue DLP export is available in this local environment. This slice does not claim dynamic staging egress recording, staging GitHub App readback, Commit Statuses expected-source proof, persistent Check Delivery retry queues, retention pruning, or full staging DLP export coverage.

## Decision

PARTIAL PASS for FG2-01, FG2-03, FG2-04, FG2-05, FG2-06, FG2-07, FG2-08, FG2-09, FG2-10, FG2-11, FG2-12, FG2-13, FG2-14, FG2-15, FG2-16, FG2-18, FG2-19, and FG2-20. Remaining FG2 tasks and exit gates stay open.
