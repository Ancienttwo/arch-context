# Self-Hosted Organization Runner Hardening

This guide is the minimum host, network, and filesystem baseline for running `ArchContext / Organization Runner` on a customer-managed GitHub Actions self-hosted runner.

It covers only the ArchContext runner job. It does not make self-hosted runners safe for arbitrary untrusted workflows, public repositories, deployment jobs, package publishing, or broad organization automation.

## Placement

- Prefer ephemeral self-hosted runners registered with `config.sh --ephemeral`; destroy the VM, container, or working volume after one job.
- Put ArchContext runners in a dedicated GitHub runner group, for example `archcontext-organization-runners`, and allow only the intended private repositories.
- Use a dedicated label such as `archcontext-org-runner`; do not rely on the broad `self-hosted` label alone.
- Do not attach public repositories or fork-heavy repositories to persistent self-hosted ArchContext runners.
- Keep the workflow on `pull_request`; do not use `pull_request_target` for any job that can access runner signing material.

Example job selector:

```yaml
runs-on:
  group: archcontext-organization-runners
  labels: [self-hosted, linux, x64, archcontext-org-runner]
```

## Network

Default posture is no inbound listener and outbound TCP 443 only.

Required outbound destinations for the ArchContext runner job:

| Destination | Purpose |
|---|---|
| `github.com` | GitHub Actions runner control and repository checkout |
| `api.github.com` | GitHub Actions runner and metadata API calls |
| `*.actions.githubusercontent.com` | GitHub Actions service communication and OIDC endpoints |
| `codeload.github.com` | Downloading actions and checkout archives |
| `results-receiver.actions.githubusercontent.com` | Job summaries and logs |
| `*.blob.core.windows.net` | GitHub Actions logs, artifacts, and cache transport |
| `objects.githubusercontent.com` | Runner update downloads when automatic runner updates are enabled |
| `objects-origin.githubusercontent.com` | Runner update downloads when automatic runner updates are enabled |
| `github-releases.githubusercontent.com` | Runner update downloads and release assets |
| `github-registry-files.githubusercontent.com` | Runner update downloads |
| `release-assets.githubusercontent.com` | GitHub-hosted release asset downloads |
| `archcontext.repoharness.com` | ArchContext control-plane endpoint and pinned runtime artifact |

Deny by default:

- Inbound connections from the internet or from ArchContext Cloud.
- Cloud instance metadata endpoints, internal admin networks, package registries, container registries, and deployment targets unless the customer explicitly needs them for a separate job.
- Direct outbound access to model providers. The required Organization Runner conclusion is deterministic and does not require provider credentials.

## Filesystem

Run the runner under a dedicated low-privilege OS account such as `archctx-runner`.

Minimum layout:

| Path | Owner | Mode | Purpose |
|---|---|---|---|
| `/opt/actions-runner/archcontext` | `archctx-runner` | `0750` | GitHub runner application |
| `/var/lib/archcontext-runner/_work` | `archctx-runner` | `0700` | Job work directory; wipe after each job or destroy with ephemeral host |
| `/var/lib/archcontext-runner/tmp` | `archctx-runner` | `0700` | Private temp directory |
| Customer Secret Store | platform owner | store-specific | Holds `keychain://archcontext/runner/<installation-id>/<public-key-id>` material |

Do not place Runner private keys in the repository, the checkout, GitHub workflow inputs, cache directories, artifacts, logs, ordinary `.env` files, or `/tmp` shared by other users.

Host restrictions:

- Disable passwordless `sudo` for the runner user.
- Do not mount `/var/run/docker.sock` into the runner unless the customer accepts container escape risk for this dedicated runner pool.
- Do not preload SSH agents, cloud deploy tokens, package publish tokens, or model provider credentials into the runner environment.
- Set `HOME` and temp directories to runner-owned paths, not a shared administrator home.
- Clean or destroy `_work`, temp, and action cache state after every job.

## Workflow Contract

Self-hosted workflows should mirror the GitHub-hosted template in `docs/examples/github-hosted-runner-workflow.yml`, with only the `runs-on` selector changed to the dedicated runner group and labels.

The job must keep:

- `permissions.contents: read`
- `permissions.checks: read`
- `permissions.pull-requests: read`
- `actions/checkout@v4` with `ref: ${{ github.event.pull_request.head.sha }}`
- `persist-credentials: false`
- `archcontext/review-action@v1`
- `trust-level: organization`
- `fork-pr-mode: unsupported`
- Pinned `runtime-artifact-url` and `runtime-artifact-digest`
- Challenge-derived `expected-repository`, `expected-head-sha`, and `expected-head-tree-oid`

The job must not add:

- `contents: write`, `write-all`, or repository administration permissions
- `pull_request_target`
- `GITHUB_TOKEN` as an action input
- Provider keys such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
- PEM values, private key file paths, or Secret Store values

## Operations

- Register, rotate, and revoke Runner Keys only through the control-plane Runner Key lifecycle.
- Keep runner app updates enabled, or maintain a documented image-update process that updates within GitHub's required window.
- Forward runner application logs to a customer-controlled log store before deploying ephemeral autoscaling; redact Secret Store refs and private material.
- Revoke the Runner Identity immediately after host compromise, image drift, missing cleanup, or any unexpected outbound destination.
- Treat a persistent runner that processed untrusted code as contaminated until rebuilt.

## Sources

- GitHub Docs, Self-hosted runners reference: https://docs.github.com/en/actions/reference/runners/self-hosted-runners
- GitHub Docs, Secure use reference: https://docs.github.com/en/actions/reference/security/secure-use
