# Trusted Runner Setup

## Boundary

Trusted Runner is a customer-controlled execution mode for `archctx review`. It signs an Organization Attestation v2 bound to a GitHub Installation, HEAD SHA, worktree digest, review digest, nonce, runner identity, workflow ref, GitHub Actions run ID, run attempt, and runtime build digest.

It does not make ArchContext SaaS a build service, code analysis host, or zero-trust runtime. The runner uploads only attestation metadata, digests and signature.

Default workflows use `pull_request`. They do not use `pull_request_target` for untrusted code paths with signing secrets.

Fork pull requests default to `unsupported`: the Organization Runner Check is completed as neutral and no Challenge or signing secret is issued. Teams may opt into `safe-no-secret` only for deterministic checks that do not produce an Organization Attestation.

No LLM provider is required for the deterministic gate. Provider-backed advisory output, when enabled as an optional step, must remain separate from the Organization Attestation conclusion, Cloud upload payload, and required Check conclusion.

`ArchContext / Organization Runner` is a separate GitHub Check from `ArchContext / Developer Review`. It is updated only from accepted Organization Attestation v2 evidence, and Developer Attestation v2 must publish as `Attestation required` instead of reusing Developer Review provenance.

Runner private keys are loaded only from the customer's Secret Store by reference, for example `keychain://archcontext/runner/<installation-id>/<public-key-id>`. Do not put PEM values, private key file paths, or secret values in workflow inputs, logs, artifacts, or caches.

## Minimal GitHub Actions Shape

Canonical GitHub-hosted template: `docs/examples/github-hosted-runner-workflow.yml`.

Reusable workflow: `.github/workflows/archcontext-organization-runner.yml`; caller template with commit-SHA pinning: `docs/examples/reusable-organization-runner-caller.yml`.

Self-hosted hardening baseline: `docs/security/self-hosted-runner-hardening.md`.

```yaml
name: ArchContext Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  archcontext:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: archcontext/review-action@v1
        with:
          challenge: auto
          trust-level: organization
          fail-on: blocking
          fork-pr-mode: unsupported
          runtime-version: "0.2.3"
          runtime-artifact-url: https://archcontext.repoharness.com/releases/archctx-0.2.3.tgz
          runtime-artifact-digest: sha256:<release-digest>
          expected-repository: <owner/name from Challenge>
          expected-head-sha: <head SHA from Challenge>
          expected-head-tree-oid: <tree OID from Challenge>
```

## Verification

- Runner identity is registered with `schemaVersion: archcontext.runner-identity/v1`.
- The action preflight rejects runtime version drift or invalid `sha256:` artifact digests before review execution.
- The action rejects checkout repository, head SHA, head tree OID, detached-head, or tracked cleanliness mismatches before review execution.
- The workflow trigger policy rejects `pull_request_target` by default; protected `workflow_dispatch` must bind an exact head.
- Fork pull requests default to neutral/Unsupported unless `fork-pr-mode: safe-no-secret` is explicitly selected and no signing secret is configured.
- The deterministic gate can complete with `llmProviderConfigured: false` and a fixed no-provider model digest.
- Optional LLM Advisory output has `influencesConclusion: false`, is bound to the deterministic review digest, and rejects conclusion-shaped fields.
- Runner private key inputs must be Secret Store refs; PEM material, key file paths, and `secretValue` fields are rejected for log, artifact, and cache surfaces.
- The Attestation v2 canonical signature covers `execution.workflowRef`, `execution.runId`, `execution.runAttempt`, and `runtime.buildDigest`; tampering any of those fields after signing must fail verification.
- Server verification requires an active scoped RunnerIdentity, matching workflow ref, runner-owned key status, and `requiredTrust: organization` before accepting an Organization Attestation.
- Runner leases use heartbeat-based renewal; a retry by the same runner extends the active lease, a different runner is blocked while the lease is active, and timeout allows a safe retry without consuming the Challenge nonce.
- Runner Key revoke and unregister are immediate: current-key Organization Attestation submissions return `RUNNER_REVOKED` before nonce consumption. Recovery requires a replacement Runner Key and new Secret Store material, not retrying the revoked key.
- Check Run must be named `ArchContext / Organization Runner` and show `Organization-attested` only for accepted Organization Attestation v2 evidence.
- Developer Attestation v2 must not satisfy the Organization Runner Check or reuse the Developer Review summary context.
- Revoked runner identity must fail future verification.
- Network capture must show no repository bodies or detailed findings to ArchContext SaaS.

## Runner Key Recovery

Use `ControlPlane.revokeRunnerKey` for emergency key compromise and `ControlPlane.unregisterRunnerKey` when removing a runner from service. Both paths transition the RunnerIdentity to `revoked`, remove rotation windows involving that runner, and write metadata-only audit events. The current key is not reactivated.

`ControlPlane.describeRunnerKeyRecovery` is the UX projection for local admin tools and future product surfaces:

- `RUNNER_NOT_FOUND`: register a Runner Key for the intended installation, scope, and workflow ref.
- `RUNNER_REVOKED`: stop using the current private key, register a replacement Runner Key with a new `publicKeyId`, update the customer Secret Store, and rerun the Organization Runner job.
- `RUNNER_SCOPE_MISMATCH`: register a Runner Key whose scope covers the pull request repository.
- `WORKFLOW_REF_MISMATCH`: use the registered workflow ref or register a new key for the approved workflow.

Do not retry an Attestation signed by a revoked or unregistered key. The failed submission leaves the Challenge nonce unconsumed, so a replacement key can submit a fresh Organization Attestation for the same leased Challenge when it is still current and unexpired.
