# Local Core Quickstart

This quickstart is the first-run path for the local ArchContext product. It covers one ordinary Git repository or one Git repository that contains workspaces. It does not cover GitHub App governance, cloud accounts, subscriptions, organization runners, or managed review.

No GitHub App, Cloud account, subscription, or LLM provider is required for Local Core.

## Prerequisites

- Node.js 24.x or 25.x.
- Bun matching the repository `packageManager`.
- A Git repository on the local machine.

## Install The Local Product

From this checkout, install the single local product package and verify the packaged `archctx` entrypoint:

```bash
bun install
node scripts/packaged-cli-smoke.mjs
```

The smoke test proves the installed `archctx` command owns the CLI, daemon launcher, and MCP stdio entrypoint.

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

The host entrypoint is `archctx mcp`. It talks to the same repository daemon through local RPC and does not create a second Store, CodeGraph handle, or ChangeSet engine.

## Stop The Local Daemon

Stop the daemon for the current repository when the session is done:

```bash
archctx daemon stop
```

Stopping the daemon removes transient connection and lock files from the reported runtime state directory. It does not delete `.archcontext/model`, generated projections, or retained local runtime state.

## Optional Governance

GitHub App governance is optional and separate from this quickstart. It is used later for PR challenge, attestation verification, and Check delivery. Local Core remains usable without installing it.

LLM advisory is also optional and separate. Local Core commands do not require provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or other model credentials.

## Verification

```bash
bun test scripts/local-core-quickstart-doc.test.ts
node scripts/packaged-cli-smoke.mjs
node scripts/platform-ipc-permission-readback.mjs
bun run verify:acceptance-ledger
bun run check:sprint
```
