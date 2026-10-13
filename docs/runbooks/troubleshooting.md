# Troubleshooting Guide

## Runtime unavailable

Runtime commands and runtime-dependent MCP tool calls normally start `archctxd` lazily. If a command still returns `AC_RUNTIME_UNAVAILABLE`, run `archctx doctor` and `archctx daemon status`. If runtime state is stale, run `archctx daemon start` or `archctx daemon upgrade`, then rerun `archctx sync`.

## Unsupported Node.js version

`AC_NODE_VERSION_UNSUPPORTED` means the process runs a Node.js outside `>=22.22 <26`. `error.details.nodeVersion` and `error.details.supportedRange` name both. The error is not retryable: switch to a supported Node.js and rerun the command. No daemon was started.

## Daemon left behind by a deleted worktree

A daemon exits within its idle window once its worktree is deleted. To stop it sooner, run `archctx daemon list` from any existing directory, then `archctx daemon stop --state-dir <stateDir>` or `archctx daemon stop --workspace-id <storageWorkspaceId>` for each entry with `rootExists: false` and `pidAlive: true`.

## Argument errors

Every command checks its whole argument list before it runs or starts the daemon. `--help` and `-h` print help and never run the command. An unknown flag, or a value flag without its value, fails with `AC_SCHEMA_INVALID` (not retryable). The global `--format` and `--json` flags are accepted everywhere. `archctx prepare` and `archctx context` read bare words as the task text only when no option is given; with options, pass the task as `--task "<text>"`.

## CodeGraph unavailable

Run diagnostics and do not make architecture conclusions from missing evidence. Rebuild the CodeGraph index, then rerun `archctx sync`.

## Stale context

Rerun `archctx prepare --task "<task>"` and repeat the checkpoint before applying a ChangeSet.

## Privacy audit failure

Run `archctx privacy-audit` and `bun run verify`. Remove any cloud route or schema that accepts private content payloads.
