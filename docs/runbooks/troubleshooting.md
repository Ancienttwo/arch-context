# Troubleshooting Guide

## Runtime unavailable

Run `archctx doctor`. If runtime state is stale, restart `archctxd` and rerun `archctx sync`.

## CodeGraph unavailable

Run diagnostics and do not make architecture conclusions from missing evidence. Rebuild the CodeGraph index, then rerun `archctx sync`.

## Stale context

Rerun `archctx prepare --task "<task>"` and repeat the checkpoint before applying a ChangeSet.

## Privacy audit failure

Run `archctx privacy-audit` and `bun run verify`. Remove any cloud route or schema that accepts private content payloads.
