---
schemaVersion: archcontext.adr/v1
id: adr.0034.one-package-local-product-distribution
title: One-package Local Product Distribution
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - package.cli
  - package.runtime-daemon
  - package.mcp-local
supersedes: []
---

# Context

Users should not have to reason about CLI, daemon, and MCP as separately installed products with separate state. MCP is a local surface over the runtime, not a second product.

# Decision

Ship one versioned `archctx` local product distribution containing CLI entrypoint, `archctxd`, MCP stdio adapter, local RPC schema, SQLite migrations, CodeGraph adapter compatibility manifest, and runtime build provenance.

Only `archctxd` is the production composition root. CLI and MCP call the daemon through versioned local RPC and cannot construct production Store, CodeGraph, Review Engine, ChangeSet Engine, or Signer adapters.

## Distribution Sources

- Root workspace package: `package.json` uses `name: archcontext`, stays `private: true`, and records the product source version for this checkout.
- Private source packages: `packages/contracts`, `packages/core`, `packages/local-runtime`, `packages/surfaces`, and `packages/cloud` stay `private: true` and version-aligned with the root source manifest.
- Generated npm package: the public release artifact is generated as `archctx` by the release dry-run stage. Its package metadata, bins, bounded file list, registry readback, and install smoke are verified by release readback evidence rather than inferred from a workspace `package.json`.

The source manifests and generated npm package intentionally have different names. A release is consistent only when `bun run readback:release` proves the root/workspace source versions, generated `archctx` package, npm registry metadata, and CLI help surface all agree.

# Consequences

- Local Core works without GitHub App, Cloud account, subscription, or LLM provider.
- Version mismatch is handled by product-level version negotiation.
- Installation, upgrade, uninstall, and data retention policy are one release concern.
- Root/workspace `private: true` is not a release blocker by itself; the generated `archctx` package is the publishable artifact.
