# Local Product Lifecycle

This runbook is the Local Core lifecycle policy for FG1. It covers the local `archctx` package, `archctxd`, MCP host configuration, and repository-local runtime state. It does not cover GitHub App installation, Cloud accounts, subscriptions, or organization runners.

## Install

1. Install the single local product package through the active package manager.

   ```bash
   bun install
   ```

2. Verify the packaged CLI entrypoint exists and can own CLI, daemon, and MCP surfaces.

   ```bash
   node scripts/packaged-cli-smoke.mjs
   ```

3. Configure the local Agent Host MCP entrypoint without copying runtime state into the host.

   ```bash
   archctx mcp install --host codex
   archctx mcp status --host codex
   ```

4. Confirm local readiness before first use.

   ```bash
   archctx doctor
   ```

Expected install state:

- One `archctx` command owns CLI, daemon launcher, and MCP stdio entrypoint.
- MCP host config points to `archctx mcp`; it does not create a second store or CodeGraph handle.
- The daemon is started lazily by runtime commands or explicitly by `archctx daemon start`.
- No GitHub App, Cloud account, subscription, or LLM provider is required for Local Core.

## Upgrade

1. Install the new package version.
2. Check the local daemon state.

   ```bash
   archctx daemon status
   ```

3. If `rpcVersionCompatible=false` or the command returns `AC_RUNTIME_VERSION_UNSUPPORTED`, replace only the daemon referenced by the current repository control file.

   ```bash
   archctx daemon upgrade
   ```

4. Re-run local diagnostics and the packaged smoke.

   ```bash
   archctx doctor
   node scripts/packaged-cli-smoke.mjs
   ```

Upgrade invariants:

- Version negotiation is local RPC only.
- `archctx daemon upgrade` may terminate only the PID recorded in the private `.archcontext/.local/archctxd.json` file for the current repository.
- Upgrade must preserve `.archcontext/model`, generated projections, and local SQLite state.
- Schema upgrades must follow `docs/runbooks/schema-upgrade-guide.md`.

## Uninstall

1. Remove MCP host configuration or host marker output.

   ```bash
   archctx mcp remove --host codex
   archctx uninstall --host codex --content "<host file content>"
   ```

2. Stop the current repository daemon if it is running.

   ```bash
   archctx daemon stop
   ```

3. Remove the installed package with the package manager that installed it.

Uninstall invariants:

- Host configuration removal does not delete repository architecture files or runtime state.
- Package removal does not imply data deletion.
- A future package install can reuse retained `.archcontext/` state.

## Data Retention

Data retained by default:

- Git-tracked architecture truth under `.archcontext/model`.
- Generated local projections under `.archcontext/generated`.
- Repository-local daemon control files and SQLite-derived state under `.archcontext/.local` while the product is in use.

Data not retained by Local Core:

- GitHub App tokens.
- Cloud account credentials.
- LLM prompts, completions, source bodies, diffs, or detailed findings.

Manual cleanup policy:

- Deleting `.archcontext/.local` removes derived daemon/session state and can be rebuilt from Git-tracked model files plus CodeGraph.
- Deleting `.archcontext/model` removes the repository architecture source of truth and is not part of uninstall.
- Destructive data deletion must be an explicit user action, not a side effect of `archctx uninstall`, `archctx mcp remove`, or package removal.

## Verification

```bash
bun test scripts/local-product-lifecycle-doc.test.ts
node scripts/packaged-cli-smoke.mjs
bun run verify:acceptance-ledger
bun run check:sprint
```
