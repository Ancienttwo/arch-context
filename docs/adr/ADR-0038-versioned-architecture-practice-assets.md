---
schemaVersion: archcontext.adr/v1
id: adr.0038.versioned-architecture-practice-assets
title: Versioned Architecture Practice Assets
status: accepted
decidedAt: 2026-06-23
appliesTo:
  - package.contracts
  - package.core
  - package.runtime-daemon
  - package.surfaces-cli
  - package.surfaces-mcp-local
supersedes: []
---

# Context

ArchContext already has a deterministic local control loop, `.archcontext/` as
the Git-tracked architecture fact source, and machine-checkable completion
gates. What it lacked was a versioned practice layer that can be listed,
validated, audited, and later matched against repository evidence.

Practice guidance must not become a second policy engine hidden in CLI, MCP, or
hooks. It also cannot depend on live network documentation, LLM output, or
unreviewed copied source text.

# Decision

ArchContext ships a static built-in Practice Catalog under
`packages/core/practice-catalog/assets/`. Repositories may add explicit overlays
under `.archcontext/practices/`.

The runtime daemon resolves the effective catalog. CLI and MCP remain thin
read-only surfaces over the same daemon result.

The first catalog release uses strict JSON-compatible YAML files. This is valid
YAML, keeps parsing dependency-free, and makes asset digests stable across
platforms. Full YAML syntax can be added later behind the same schema and digest
contract.

Every practice asset requires:

- stable ID and revision
- scope and negative scope
- recall triggers
- evidence policy
- advisory guidance
- deterministic check IDs where applicable
- enforcement ceiling
- provenance and source records
- lifecycle review metadata

Built-in practices default to `advisory`. A practice can block completion only
in a later sprint when a registered deterministic checker exists and a
repository explicitly opts in.

Repo overlays must use explicit `overlay.mode` for `replace` or `disable`.
Silent duplicate IDs are rejected. Overlay files cannot be symlinks and cannot
define shell, network, hook, provider, or LLM behavior.

# Consequences

- Static practice assets work offline and do not require Context7, LLMs, or
  network access.
- `archctx practices list/show/validate/sources` can expose the effective
  catalog without changing `prepare` posture or `complete` results.
- `.archcontext/practices/` is part of the write allowlist, but path traversal
  and repository escape protection remain unchanged.
- Practice catalog provenance is represented by catalog, overlay, asset, source,
  and manifest digests.
- Later matching, checkpoint, and enforcement work must consume this catalog
  rather than inventing new practice text or decision logic in hooks.
