---
schemaVersion: archcontext.adr/v1
id: adr.0053.retire-github-app-governance-bridge
title: Retire the GitHub App Governance Bridge
status: accepted
decidedAt: 2026-11-03
appliesTo:
  - module.architecture-context.cloud
  - component.architecture-context.cloud.control-plane
  - component.architecture-context.surfaces.cli
  - module.architecture-context.tooling
supersedes:
  - adr.0015.github-app-without-contents-permission
  - adr.0016.signed-local-attestation
  - adr.0024.developer-vs-organization-attestation
  - adr.0027.trusted-runner-attestation
---

# ADR-0053: Retire the GitHub App Governance Bridge

> **Status**: Accepted by the owner on #478 on 2026-11-05 (decision https://github.com/Ancienttwo/arch-context/pull/478#issuecomment-6640095044). Follow-up issues implement the removal. The acceptance commit moved ADR-0015, ADR-0016, ADR-0024 and ADR-0027 to `superseded` with `supersededBy: adr.0053.retire-github-app-governance-bridge`, and applied the ADR-0003, ADR-0017 and ADR-0035 amendments below.
>
> **Origin**: PR #478 (owner decision https://github.com/Ancienttwo/arch-context/pull/478#issuecomment-6636922610)

## Context

The spec lists the GitHub App as an optional governance bridge for two product modes, Developer Review and Organization Runner. The App never reads code. It receives `pull_request` and `check_run` webhooks, issues a Review Challenge, verifies a locally signed attestation and writes a Check Run. ADR-0015 limits it to Metadata read, Pull Requests read, Checks write and Commit Statuses write, so it can neither read a diff nor post a pull request comment.

Observed state, re-measured on 2026-11-05:

- The deployed Worker `archcontext-fg2-staging` (custom domain `archcontext.repoharness.com`, D1 `archcontext-control-plane-staging`) serves `/health` (200), `/v1/github/webhooks` and the FG5 check-delivery failure-injection readback. `/v1/challenges` returns 404, and no attestation or runner route exists.
- Every one of the last 40 merged pull requests (#406 to #485) carries exactly one `ArchContext / Developer Review` check run from the `archcontext-staging` App. All 40 concluded `neutral` with the title "ArchContext staging webhook verified", and none carried a review result. Method: `gh pr list --state merged --limit 40 --json number,headRefOid`, then `gh api "repos/Ancienttwo/arch-context/commits/<headRefOid>/check-runs?check_name=ArchContext%20/%20Developer%20Review"` for each head, tallying conclusion, `app.slug` and `output.title`.
- `main` has no ruleset (`/rulesets` and `/rules/branches/main` both return `[]`) and no branch protection (404). No merge depends on the App's check.
- `archctx github connect --json` returns `AC_CAPABILITY_UNSUPPORTED`. Developer Review has no production connection path.
- The cloud release gate in ADR-0017 required #224. The owner closed #224 as not planned on 2026-09-28.
- `actions/review-action` and `.github/workflows/archcontext-organization-runner.yml` reference `archcontext/review-action@v1`. It was never published: `github.com/archcontext/review-action` returns 404, the `archcontext` account does not exist, and GitHub code search finds the reference only in this repository. No external consumer exists.
- FG2 evidence (`docs/verification/fg2-ruleset-expected-source.md`) records App ID `4102781` installed on `Ancienttwo/arch-context` only, as of 2026-06-21. Installations on other accounts could not be read without the App JWT, so rollout step 1 lists them.
- #477 and #482 already deleted the FG3 and FG4 readbacks that exercised attestation, runner and check delivery, and the `fg6-organization-runner-no-llm-readback` inspection in `scripts/verify-governance.mjs`. Two live scripts remain tied to the retired path: `scripts/fg5-check-failure-readback.ts` (alias `readback:fg5:check-failure`) and `scripts/fg6-rollback-compat-readback.ts` (alias `readback:fg6:rollback-compat`).

The bridge therefore costs a live Worker, a D1 database, four secrets, an installed App and the code, tests and CI time of the cloud governance path, and returns a check that carries no architecture signal.

## Decision

Retire the GitHub App and the two product modes that require it: Developer Review and Organization Runner.

Retired:

- the `archcontext-staging` GitHub App, every installation of it, and its private key;
- the staging Worker, its D1 database, its four secrets (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PEM`, `GITHUB_WEBHOOK_SECRET`, `ARCHCONTEXT_READBACK_SECRET`) and its custom domain;
- the hosted Review Challenge, attestation verification and Check delivery path in the control plane;
- Developer and Organization attestation (ADR-0016, ADR-0024, ADR-0027) and the GitHub API allowlist (ADR-0015);
- the CLI `github status`, `connect`, `disconnect`, `review` and `verify-head` commands and the GitHub Developer Review state;
- `actions/review-action` and the Organization Runner reusable workflow.

Published surfaces: `archctx` and `archctx-contracts` 0.12.0 delete the governance exports (`packages/contracts/src/github-governance.ts`, `CONTROL_PLANE_ROUTES` and `controlPlaneRouteDigest` from `control-plane-routes.ts`), the RPC v2 `developerReview.*` methods (`packages/local-runtime/runtime-daemon/src/rpc-methods.ts:329-349`) and the CLI `github` commands. The 0.12.0 release notes list the break. Neither package is deprecated on npm: `github connect` already fails closed, so no working integration breaks, and no external consumer of these exports was found.

Kept routes: the routes of `CONTROL_PLANE_ROUTES` that serve deferred surfaces (OAuth, device authorization, entitlements, the Stripe webhook, `/mcp/metadata`, `/chatgpt/*` and `/notifications/*`) move to a route table owned by `packages/cloud/control-plane`, which already imports, digests (`routeDigest()`) and re-exports the list. `docs/api/control-plane-compatibility-policy.md:17` points at that table. The CLI's only imports of the control-plane package (`packages/surfaces/cli/src/main.ts:2683` and `:2872`) sit in the retired `github` commands and go with them.

Kept pieces that depend on retired ones, and where each goes:

- `control-plane-client` imports `publicKeyFingerprint` from `@archcontext/cloud/attestation` only for `DevicePrivateKeyStore`, which serves only Developer attestation signing (the CLI `github` commands and the runtime daemon's `devicePrivateKeySigner`). Both are deleted with Developer attestation. The OAuth, credential store and entitlement helpers stay for the deferred decision.
- `assertNoCallerProvidedAttestationFields` (with `findCallerProvidedAttestationFields` and its field list) is kept. The runtime daemon's `completeTask` and the mcp-local `complete-task` tool (`packages/surfaces/mcp-local/src/index.ts:279`) use it to stop callers from forging a review conclusion, which still matters for local review. It moves from `github-governance.ts` to a kept contracts module before that file is deleted, together with `CloudEgressEnvelope` (`github-governance.ts:438`), because `schemas/cloud/cloud-egress-envelope.schema.json` and the ADR-0035 privacy rule for remaining Cloud surfaces stay.
- The `archctx` npm `homepage` and the packaged README "Product home" line point at https://github.com/Ancienttwo/arch-context from the next release. Both come from `HOME_URL` in `scripts/fg6-npm-release-dry-run.ts:31` and `releaseHomeUrl` in `scripts/local-product-tarball-smoke.mjs:24`. Published versions keep the old homepage, which stops resolving at rollout step 4.
- `packages/cloud/hardening` stays. It drops its `attestationLabel` and `deviceIntegritySignals` import from `@archcontext/cloud/attestation`. Its `diagnostics().privacyRouteDigest` is dropped rather than computed from the control-plane route table, because the CLI imports hardening (`packages/surfaces/cli/src/main.ts:22`) and must not import the control-plane package. `archctx doctor` loses `hardening.privacyRouteDigest` in 0.12.0. The trust-level eval material follows the spec: `spec.attestation-trust` and `guardrail.attestation-replay` in `evals/context-budget/documents.jsonl` and case `q-cb-009` in `evals/context-budget/cases.jsonl`.

Also kept:

- Local Core: local review, MCP and CLI workflow.
- Local `gh`-based publishing that runs as the user: advisory issue drafts (ADR-0041, ADR-0042, accepted) and the projection writer rolling pull request (ADR-0048, itself still `proposed`; this ADR neither depends on nor decides its acceptance). Neither uses the App.
- `packages/cloud/cloud-db` and `deploy/sql` remain as code for the deferred billing decision, keeping only `accounts`, `subscriptions` and their code (see Consequences).

Out of scope, for a separate decision:

- entitlement and billing (ADR-0023, ADR-0028) and the Pro pricing line in the spec's Delivery section;
- notification providers (ADR-0029);
- `mcp-cloud-metadata`, the ChatGPT surfaces (ADR-0019, ADR-0031) and `deploy/scripts/production-ga-readback.mjs`, which reads those surfaces;
- whether the owner keeps the `repoharness.com` DNS zone.

Amendments on acceptance:

- ADR-0003:19 becomes "SaaS handles identity and billing only." GitHub metadata, challenge issuance and attestation verification leave its scope.
- ADR-0017: the control plane no longer covers GitHub metadata, challenges or attestation verification. Identity, entitlement and Stripe state stay as written and stay deferred. The "Cloud release gate" section is removed: #224 is closed, and the challenge, lease and check delivery it gated are retired. The section also gated identity, authorization exchange, device registration and credential storage; the deferred identity and billing decision sets its own release gate for those.
- ADR-0035: the GitHub API allowlist and webhook projection rules lapse with the App. The privacy rules for any remaining ArchContext Cloud surface stay in force.

Personal Publish stays in the spec's mode table but has no implementation. This ADR does not decide it.

## Consequences

No ArchContext check appears on pull requests, and architecture review stays local. The removal work changes the following in one change (rollout step 3) unless noted. Each path exists on `main` at `7c25d63b`.

- Product docs: `docs/spec.md` lines 20-27 (mode table rows and the bridge paragraph), 31 (Primary workflow check publishing), 32 (Quality bar "Attestation Replay"), 38 (Compliance sentence on App permissions), 350-351 (organization-runner rollout in the release notes) and 356 (the `synchronize` scenario); `README.md` and `README.zh-CN.md` lines 9 ("cloud governance scaffold") and 14-15; `docs/runbooks/local-core-quickstart.md:92` (the GitHub App governance note).
- API, runbook and security docs: `docs/api/control-plane-openapi.yaml` and `docs/api/control-plane-compatibility-policy.md` drop the retired routes; `docs/runbooks/trusted-runner.md`, `docs/runbooks/github-review-state.md` and `docs/runbooks/staging-readback-auth.md` are removed; `docs/runbooks/control-plane-incidents.md` and `docs/security/threat-model-v1.md` drop the governance sections; `docs/security/self-hosted-runner-hardening.md` is removed.
- Schemas: `schemas/cloud/{attestation,attestation-v2,review-challenge-v2,check-delivery,device-identity,governance-key-status,runner-identity,org-runner-identity}.schema.json` and their `packages/contracts/fixtures` are removed; `schemas/runtime/product-version-manifest.schema.json` and `packages/contracts/src/product-version.ts` drop the `reviewChallenge`, `attestation`, `deviceIdentity` and `runnerIdentity` schema pins.
- Code: `packages/cloud/{github-app,runner,attestation}` are deleted; `packages/cloud/control-plane` loses its challenge, attestation, runner-key and check-delivery routes; `packages/surfaces/cli/src/github-review-state.ts`, the runtime daemon's `developer-review-run.ts` and the `developerReview.*` RPC methods go; `actions/review-action/` and `.github/workflows/archcontext-organization-runner.yml` go.
- Deploy: `deploy/cloudflare/fg2-staging-worker{,.test}.ts`, `deploy/scripts/fg2-staging-secrets{.mjs,.test.ts}`, `deploy/env/fg2-staging.env.example` and `wrangler.jsonc` are deleted. `deploy/release-checklists/` and the production readback stay.
- Persistence: `packages/cloud/cloud-db` drops its attestation and check-delivery persistence (`persistAcceptedAttestationSubmission`, `persistPendingCheckDelivery` and their dependents), and `deploy/sql/0001_archcontext_control_plane.sql` drops the governance tables (`github_installations`, `device_identities`, `review_challenges`, `attestations` with its triggers and `retention_purge_authorizations`, `legacy_attestation_migrations`, the three `runner_*` tables, `check_deliveries` and `webhook_deliveries`). `accounts`, `subscriptions` and their code stay for the deferred billing decision.
- Scripts and CI: root `package.json` drops `deploy:fg2:staging:secrets`, `deploy:fg2:staging`, `readback:fg5:check-failure` and `readback:fg6:rollback-compat`, and `verify:node-compat` drops `deploy/scripts/fg2-staging-secrets.test.ts`. `scripts/fg5-check-failure-readback{,.test}.ts` and `scripts/fg6-rollback-compat-readback{,.test}.ts` are deleted under the ADR-0051 deletion gate. `scripts/privacy-route-audit.mjs`, `scripts/package-boundary-audit.mjs` and `.github/verify-sharding.json` drop the retired paths. `scripts/github-api-contract-audit.mjs`, which runs in `verify`, drops the retired files it hard-codes (`isGitHubApiContractFile`, line 186) and the GitHub API allowlist (`allowedGitHubApiMethods`, `allowedGitHubApiPathPatterns`), and `scripts/github-api-contract-audit.test.ts` follows.
- Examples and release: `docs/examples/github-hosted-runner-workflow.yml` and `docs/examples/reusable-organization-runner-caller.yml` are removed, which ends the per-release version bump of the review action default and the example workflows that the release checklist requires.
- Architecture model: a ChangeSet under `repo-harness-architecture` updates the cloud module summary and the control-plane component summary, retires the `github-review-state` component and `component.architecture-context.local-runtime.developer-review-run` with its three relations (`developer-review-run.review-engine`, `developer-review-run.rpc-server`, `runtime-daemon.developer-review-run`), and removes `developer-review-run.ts` from the runtime-daemon component's source list.
- Records under `docs/verification/` and `deploy/release-checklists/` stay as history.

## Rollout

Irreversible steps come last.

1. Re-confirm that no ruleset or branch protection requires `ArchContext / Developer Review` or `ArchContext / Organization Runner`. The owner lists every installation of App `4102781` from the App settings page.
2. The owner suspends or uninstalls every installation, so webhooks stop.
3. Land the code, schema, workflow and doc removal in one change, released as `archctx` and `archctx-contracts` 0.12.0. It also trims the `cloud-db` attestation and check-delivery persistence and the governance tables in `deploy/sql/0001_archcontext_control_plane.sql`; `accounts`, `subscriptions` and their code stay.
4. Tear down the Worker, its four secrets and the custom domain.
5. The owner revokes the App private key and deletes the App registration (App ID `4102781`), and deletes the local key copies `_ops/env/fg2-staging.env` and `_ops/env/fg2-staging.github-app.private-key.pem`.
6. Delete the D1 database `archcontext-control-plane-staging` without an export. **Data-irreversible**: its `accounts` and `subscriptions` rows are lost; the owner treats them as test data.

Rollback:

- Before step 4: revert the removal change and reinstall the App. 0.12.0 stays published; a revert ships as a later version.
- After step 4: also re-provision the secrets and redeploy the Worker against the existing D1.
- After step 5: a new App registration gets a new App ID and a new private key, and any ruleset expected-source binding must be recreated.
- After step 6: D1 is re-created empty from `deploy/sql`; the old rows cannot be recovered.

## Follow-up not decided here

Pull request feedback can come back as a GitHub Action that runs in the user's repository: review runs on the user's runner, and the result is posted with `GITHUB_TOKEN`. That needs no App, no hosted service and no ArchContext-held key. It would be a new action, not a revision of `actions/review-action`, whose challenge and attestation logic this ADR retires.

Inputs for that decision, not decided here:

- The deterministic part already exists as read-only commands on Git refs. `archctx impact --base <sha> --head <sha> --json` and `archctx constraints check --json` ran on this repository without daemon or runtime-state writes. Whether they run on a fresh runner without a prebuilt CodeGraph index is unverified.
- ADR-0036 fixes the split: the deterministic gate decides the conclusion, and any LLM step is advisory, uses the user's own key, and cannot change the conclusion. Pull request code and text are untrusted input to that step.
- Pull requests from forks get no secrets and a read-only `GITHUB_TOKEN` under `pull_request`, so that run can neither call an LLM nor comment. Commenting on fork pull requests needs a separate privileged step, for example a `workflow_run` workflow that posts a result artifact without checking out fork code. `pull_request_target` with a fork checkout is excluded.
- Workflow permissions, egress disclosure, comment shape (one summary comment, inline comments, or a Check) and Marketplace distribution belong to that decision.
