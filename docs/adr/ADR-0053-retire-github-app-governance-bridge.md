---
schemaVersion: archcontext.adr/v1
id: adr.0053.retire-github-app-governance-bridge
title: Retire the GitHub App Governance Bridge
status: proposed
decidedAt: 2026-11-03
appliesTo:
  - module.architecture-context.cloud
  - component.architecture-context.cloud.control-plane
  - component.architecture-context.surfaces.cli
  - component.architecture-context.surfaces.github-review-state
  - module.architecture-context.tooling
supersedes:
  - adr.0015.github-app-without-contents-permission
  - adr.0016.signed-local-attestation
  - adr.0024.developer-vs-organization-attestation
  - adr.0027.trusted-runner-attestation
---

# ADR-0053: Retire the GitHub App Governance Bridge

> **Status**: Proposed. On acceptance, ADR-0015, ADR-0016, ADR-0024 and ADR-0027 move to `superseded` with `supersededBy: adr.0053.retire-github-app-governance-bridge`, and ADR-0017 and ADR-0035 receive the amendments below.

## Context

The spec lists the GitHub App as an optional governance bridge for two product modes, Developer Review and Organization Runner. The App never reads code. It receives `pull_request` and `check_run` webhooks, issues a Review Challenge, verifies a locally signed attestation and writes a Check Run. ADR-0015 limits it to Metadata read, Pull Requests read, Checks write and Commit Statuses write, so it can neither read a diff nor post a pull request comment.

Observed state on 2026-11-03:

- The deployed Worker `archcontext-fg2-staging` (custom domain `archcontext.repoharness.com`, D1 `archcontext-control-plane-staging`) serves `/health`, `/v1/github/webhooks` and the FG5 check-delivery failure-injection readback. It exposes no challenge, attestation or runner route.
- Of the last 30 merged pull requests, 7 carry an `ArchContext / Developer Review` check from the `archcontext-staging` App. All 7 concluded `neutral` with the title "ArchContext staging webhook verified". No pull request received a review result.
- `main` has no active ruleset rule and no branch protection, so no merge depends on the App's check.
- `archctx github connect` returns `AC_CAPABILITY_UNSUPPORTED` (ADR-0016, implementation status). Developer Review has no production connection path.
- The cloud release gate in ADR-0017 required #224. The owner closed #224 as not planned on 2026-09-28.
- `actions/review-action` and `.github/workflows/archcontext-organization-runner.yml` point at the same control-plane endpoint, which has no route for them.
- FG2 evidence (`docs/verification/fg2-ruleset-expected-source.md`) records App ID `4102781` installed on `Ancienttwo/arch-context` only, as of 2026-06-21. The current installation scope was not re-read for this ADR.

The bridge therefore costs a live Worker, a D1 database, three secrets, an installed App and the code, tests and CI time of the cloud governance path, and returns a check that carries no architecture signal.

## Decision

Retire the GitHub App and the two product modes that require it: Developer Review and Organization Runner.

Retired:

- the `archcontext-staging` GitHub App and its installation;
- the staging Worker, its D1 database, secrets and custom domain;
- the hosted Review Challenge, attestation verification and Check delivery path in the control plane;
- Developer and Organization attestation (ADR-0016, ADR-0024, ADR-0027) and the GitHub API allowlist (ADR-0015);
- the CLI `github status`, `connect`, `disconnect`, `review` and `verify-head` commands and the GitHub Developer Review state;
- `actions/review-action` and the Organization Runner reusable workflow.

Kept:

- Local Core: local review, MCP and CLI workflow.
- Local `gh`-based publishing that runs as the user: advisory issue drafts (ADR-0041, ADR-0042) and the projection writer rolling pull request (ADR-0048). Neither uses the App.

Out of scope, for a separate decision:

- entitlement and billing (ADR-0023, ADR-0028) and the Pro pricing line in the spec's Delivery section;
- notification providers (ADR-0029);
- `mcp-cloud-metadata` and the ChatGPT surfaces (ADR-0019, ADR-0031);
- `packages/cloud/hardening`, which the CLI imports for diagnostics. It currently reads `attestationLabel` and `deviceIntegritySignals` from `@archcontext/cloud/attestation` and entitlement helpers from `@archcontext/cloud/control-plane-client`. The removal work must cut the attestation dependency without changing the remaining diagnostics.

Amendments on acceptance:

- ADR-0017: the control plane no longer covers GitHub metadata, challenges or attestation verification. Identity, entitlement and Stripe state stay as written and stay deferred.
- ADR-0035: the GitHub API allowlist and webhook projection rules lapse with the App. The privacy rules for any remaining ArchContext Cloud surface stay in force.

Personal Publish stays in the spec's mode table but has no implementation. This ADR does not decide it.

## Consequences

- No ArchContext check appears on pull requests. Architecture review stays local.
- The spec's Product Modes table, the Primary workflow sentence about publishing Developer Review or Organization Runner checks, and the Compliance sentence about GitHub App permissions change in the removal work.
- Architecture model changes go through a ChangeSet under `repo-harness-architecture`: the cloud module summary, the control-plane component summary, and the `github-review-state` component.
- `scripts/package-boundary-audit.mjs`, `scripts/privacy-route-audit.mjs` and `.github/verify-sharding.json` drop the retired paths in the same change as the code.
- The FG3 and FG4 readback scripts that exercise attestation, runner and check delivery are deleted under the ADR-0051 deletion gate. Records under `docs/verification/` stay as history.
- `scripts/verify-governance.mjs` stops running the `fg6-organization-runner-no-llm-readback` inspection, and the matching root `readback:` command goes, in the same change as the runner removal.
- `docs/examples/github-hosted-runner-workflow.yml`, `docs/examples/reusable-organization-runner-caller.yml` and `docs/runbooks/trusted-runner.md` are removed with the Organization Runner. Release checklists under `deploy/release-checklists/` stay as history.
- `schemas/cloud/attestation*.schema.json` and `schemas/cloud/runner-identity.schema.json` are removed with their last consumer.

## Rollout

Irreversible steps come last.

1. Re-confirm that no ruleset or branch protection requires `ArchContext / Developer Review` or `ArchContext / Organization Runner`.
2. The owner suspends or uninstalls the App installation, so webhooks stop.
3. Land the code, schema, workflow and spec removal in one change.
4. Tear down the Worker, D1 database, secrets and custom domain.
5. The owner deletes the App registration (App ID `4102781`).

Rollback:

- Before step 4: revert the removal change and reinstall the App.
- After step 4: also re-provision D1 and the secrets and redeploy the Worker.
- After step 5: a new App registration gets a new App ID, and any ruleset expected-source binding must be recreated.

## Follow-up not decided here

Pull request feedback can come back as a GitHub Action that runs in the user's repository: review runs on the user's runner, and the result is posted with `GITHUB_TOKEN`. That needs no App, no hosted service and no ArchContext-held key. It would be a new action, not a revision of `actions/review-action`, whose challenge and attestation logic this ADR retires.

Inputs for that decision, not decided here:

- The deterministic part already exists as read-only commands on Git refs. `archctx impact --base <sha> --head <sha> --json` and `archctx constraints check --json` ran on this repository without daemon or runtime-state writes. Whether they run on a fresh runner without a prebuilt CodeGraph index is unverified.
- ADR-0036 fixes the split: the deterministic gate decides the conclusion, and any LLM step is advisory, uses the user's own key, and cannot change the conclusion. Pull request code and text are untrusted input to that step.
- Pull requests from forks get no secrets and a read-only `GITHUB_TOKEN` under `pull_request`, so that run can neither call an LLM nor comment. Commenting on fork pull requests needs a separate privileged step, for example a `workflow_run` workflow that posts a result artifact without checking out fork code. `pull_request_target` with a fork checkout is excluded.
- Workflow permissions, egress disclosure, comment shape (one summary comment, inline comments, or a Check) and Marketplace distribution belong to that decision.
