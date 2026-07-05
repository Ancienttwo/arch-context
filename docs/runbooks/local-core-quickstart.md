# Local Core Quickstart

This quickstart is the first-run path for the local ArchContext product. It covers one ordinary Git repository or one Git repository that contains workspaces. It does not cover GitHub App governance, cloud accounts, subscriptions, organization runners, or managed review.

No GitHub App, Cloud account, subscription, or LLM provider is required for Local Core.

## Prerequisites

- Node.js 24.x or 25.x.
- Bun matching the repository `packageManager`.
- A Git repository on the local machine.

## Install The Local Product

Public npm path for an individual local user:

```bash
npm install -g archctx@latest
archctx help
archctx doctor
```

Checkout development path for this repository:

```bash
bun install
node scripts/packaged-cli-smoke.mjs
```

Both paths install or verify one local product command named `archctx`. The public npm artifact is the generated `archctx` package; this checkout's root and workspace `package.json` files are private source manifests. The smoke test proves the installed `archctx` command owns the CLI, daemon launcher, and MCP stdio entrypoint.

## Start In A Repository

Run the local product from the repository root:

```bash
cd /path/to/my-repo
archctx doctor
archctx paths
archctx init --name "My App"
archctx sync
archctx prepare --task "Describe the change you are about to make"
archctx status
```

Expected local behavior:

- `archctx doctor` reports Git, SQLite, CodeGraph, filesystem permission, product version, daemon, runtime paths, and egress state.
- `archctx paths` reports repository truth, CodeGraph index, storage repository/worktree identity, and OS user-data runtime paths.
- `archctx init` writes the repository-local `.archcontext/` model files.
- `archctx sync` updates local derived runtime state.
- `archctx prepare` compiles local task context through the daemon.
- The daemon starts lazily when a runtime command needs it.

## Connect A Local Agent Host

Configure the local MCP entrypoint for an Agent Host when needed:

```bash
archctx mcp install --host codex
archctx mcp status --host codex
```

The host entrypoint is `archctx mcp`. It talks to the same repository daemon through local RPC and does not create a second Store, CodeGraph handle, or ChangeSet engine. When the host first calls a runtime-dependent MCP tool such as `archcontext_prepare_task`, `archctx mcp` starts the same local daemon if it is not already running, then reconnects through the daemon connection file. Listing MCP tools does not start the daemon. `archctx mcp status` reports host configuration readiness, not daemon health.

## Stop The Local Daemon

Stop the daemon for the current repository when the session is done:

```bash
archctx daemon stop
```

Stopping the daemon removes transient connection and lock files from the reported runtime state directory. It does not delete `.archcontext/model`, generated projections, or retained local runtime state.

The daemon also exits on its own after 30 minutes without a completed request, so an unattended repository does not accumulate a background process indefinitely. Override the idle window with `archctx daemon start --idle-timeout-ms <ms>` or the `ARCHCONTEXT_DAEMON_IDLE_TIMEOUT_MS` environment variable; `0` disables idle exit and keeps the daemon running until an explicit `archctx daemon stop`.

## Optional Governance

GitHub App governance is optional and separate from this quickstart. It is used later for PR challenge, attestation verification, and Check delivery. Local Core remains usable without installing it.

LLM advisory is also optional and separate. Local Core commands do not require provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or other model credentials.

## Optional Audit

`archctx audit` is a local, read-only architecture audit driven by the repository daemon. The daemon spawns `claude` as a subagent restricted at the process level to read-only tools (`Read`, `Grep`, `Glob`; `Bash`, `Edit`, and `Write` are not wired into that session and are also explicitly disallowed), has it review the repository, and turns the result into advisory GitHub issue drafts. Nothing is published automatically: drafts sit in local state until a human runs a separate approve step. See `docs/adr/ADR-0041-native-local-audit.md` and `docs/adr/ADR-0042-local-github-issue-publishing.md` for the full design.

Audit is opt-in and off by default. Enable it per repository in `.archcontext/manifest.yaml`:

```yaml
audit:
  githubIssues:
    enabled: true
```

Run an audit and inspect its drafts:

```bash
archctx audit run
archctx audit list
archctx audit show <run-id>
```

- `archctx audit run` starts the audit job, then polls `archctx audit list` every 5 seconds until the run reaches a terminal status (`pending` once drafts are ready, or `failed`). Pass `--no-wait` to return immediately after the job starts instead of waiting, or `--timeout-ms <ms>` to cap how long the CLI polls before giving up (default 600000, 10 minutes) — a poll timeout is not a run failure, the daemon keeps driving the run in the background regardless.
- `archctx audit list` and `archctx audit show <run-id>` read pending runs and their advisory GitHub issue drafts without publishing anything.

Publish approved drafts as real GitHub issues:

```bash
export ARCHCONTEXT_GH_ISSUES_TOKEN=<fine-grained PAT, Issues: write only>
archctx audit approve <run-id>
```

- `ARCHCONTEXT_GH_ISSUES_TOKEN` must be a GitHub fine-grained personal access token scoped to **Issues: write only** — no Contents, no Pull requests, no other permission. That scope bounds a leaked or misused token to filing/editing issues; it cannot push code, read source, or touch anything else in the repository. `archctx audit approve` never falls back to an ambient `gh auth login` session; without this token it fails closed.
- Publishing to a repository whose probed visibility is not `private` requires a second, explicit confirmation: the command fails with the exact `--confirm-public-repo <token>` value to rerun with, printed in both the error and a CLI warning.
- If a run stops partway through publishing (a `gh` failure, a crash), rerun with `archctx audit approve <run-id> --resume`. Every filed issue carries a digest footer that the resume path checks before creating anything, so already-filed drafts are never re-published. If this is the first audit run after upgrading `archctx` and a command instead reports a stale or incompatible daemon, run `archctx daemon upgrade` first (see `docs/runbooks/local-product-lifecycle.md`).

## Verification

```bash
bun test scripts/local-core-quickstart-doc.test.ts
node scripts/packaged-cli-smoke.mjs
bun run readback:release
node scripts/platform-ipc-permission-readback.mjs
bun run verify:acceptance-ledger
bun run check:sprint
```
