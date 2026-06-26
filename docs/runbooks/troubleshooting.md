# Troubleshooting Guide

## Runtime unavailable

Runtime commands and runtime-dependent MCP tool calls normally start `archctxd` lazily. If a command still returns `AC_RUNTIME_UNAVAILABLE`, run `archctx doctor` and `archctx daemon status`. If runtime state is stale, run `archctx daemon start` or `archctx daemon upgrade`, then rerun `archctx sync`.

## CodeGraph unavailable

Run diagnostics and do not make architecture conclusions from missing evidence. Rebuild the CodeGraph index, then rerun `archctx sync`.

## Stale context

Rerun `archctx prepare --task "<task>"` and repeat the checkpoint before applying a ChangeSet.

## Privacy audit failure

Run `archctx privacy-audit` and `bun run verify`. Remove any cloud route or schema that accepts private content payloads.
