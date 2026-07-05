---
schemaVersion: archcontext.adr/v1
id: adr.0043.agent-context-provider
title: Agent Context Provider
status: accepted
decidedAt: 2026-07-05
appliesTo:
  - package.contracts
  - package.projection-engine
  - package.model-store-yaml
  - package.surfaces-cli
supersedes: []
---

# Context

repo-harness maintains its own capability filing (`.ai/context/capabilities.json` plus
seven consumers) so coding agents can discover which files a capability owns. That
filing work is moving to ArchContext so agentic runtimes across products read
capability-context from one provider instead of each product reinventing path-ownership
and agent-context file conventions.

ArchContext's `archcontext.node/v1` schema already carries `id`, `kind`, and
`source.include`/`source.exclude`/`entrypoints` globs
(`schemas/repo/architecture-node.schema.json`). No node schema field is missing; what is
missing is the cross-product contract for how an agentic runtime is supposed to consume
these fields: which field is the capability identifier, how ownership ties break when
more than one node's globs match a path, where non-schema conventions live, and what a
per-capability agent-context file looks like.

# Decision

1. **Capability identity.** A node's `id` doubles as the capability ID for agentic
   runtimes when `kind` is `capability`. Capability IDs use the naming convention
   `capability.<domain>.<name>` (for example `capability.workflow-engine.inspection-migration`).
   This convention already fits the existing `id` pattern in
   `schemas/repo/architecture-node.schema.json`; no schema change is required.

2. **Path ownership and tie-break.** `source.include` globs are the source of truth for
   which paths a node owns. Resolving "which capability owns path P" against the full
   node set follows exactly one tie-break, in this order:
   - Apply every candidate node's `source.exclude` globs first; a node whose `exclude`
     matches P is disqualified for P regardless of its `include` globs.
   - Among the remaining candidates, the node whose matching `include` glob has the
     longest literal prefix (the most specific declaration) wins.
   - If two or more surviving candidates tie at the same longest literal-prefix length,
     resolution is **rejected as ambiguous**. This is a deliberate outcome, not a
     fallback: it mirrors the default projection manifest's
     `ownership.ambiguousOwnership: "reject"`
     (`packages/local-runtime/model-store-yaml/src/index.ts`) and repo-harness's existing
     same-length-ambiguity-fails rule. Callers must narrow the declared globs; ArchContext
     does not guess an owner.
   - A node with no `source` field, or with an empty `include` list, owns no paths and
     never participates in resolution.

   This tie-break is implemented exactly once: `resolveArchitectureOwnerForPath`
   (`packages/core/projection-engine/src/index.ts`), called by `archctx resolve --path`
   (`packages/surfaces/cli/src/main.ts`). Other adapters, including a future repo-harness
   Stage 0 adapter, are expected to call this command rather than re-implementing glob
   tie-break semantics, so the two products cannot drift apart on what "ambiguous" means.
   `archctx resolve --path <p>` exits `0` on a single match, `1` when no node owns the
   path, and `2` when resolution is ambiguous.

3. **Non-schema conventions live under `extensions`.** Per
   `docs/runbooks/schema-upgrade-guide.md`, new node fields must be optional or live
   under `extensions` until every adapter understands them. This ADR reserves two
   `extensions` keys by convention, not by schema change:
   - `extensions.lspProfile: string` — names the language-server/tooling profile an
     agentic runtime should assume for this capability's source tree.
   - `extensions.verification: string[]` — the commands an agentic runtime should run to
     verify changes inside this capability, in the same spirit as the per-capability
     "Verification" line already used in repo-local `CLAUDE.md`/`AGENTS.md` contracts.
   Neither key is schema-validated; adapters must treat a missing or malformed value as
   absent, not as an error, until a later ADR promotes them to validated schema fields.

4. **`agent-context` projection.** A new `ProjectionTarget` `type` value, `agent-context`
   (`schemas/runtime/projection-target.schema.json`), projects one capability node into
   its own primary source directory as a marker-owned region inside that directory's
   `CLAUDE.md` and `AGENTS.md` files. The primary source directory is derived from the
   node's first `source.include` entry: the literal prefix before its first wildcard,
   with any trailing partial path segment dropped, or the containing directory when the
   entry has no wildcard at all. The projected region:
   - Is delimited by its own marker pair, `BEGIN/END ARCHCONTEXT AGENT CONTEXT`, distinct
     from the `docs/architecture/*` `ARCHCONTEXT:generated` marker family, so it can
     coexist with unrelated generated regions already present in the same
     `CLAUDE.md`/`AGENTS.md` file (for example a repo-harness-managed architecture
     contract block).
   - Carries the capability's `id`, `name`, `summary`, `source`, and an `extensions`
     digest, so the region changes only when the underlying node facts change.
   - Replaces only its own marker-delimited region on re-render; every other line in the
     file, including regions owned by other tools, is preserved untouched. This reuses
     the existing projection ownership model — marker-owned generated regions replace by
     marker, human-authored regions are preserved, ambiguous ownership is rejected —
     rather than introducing a second ownership model.

# Consequences

- Agentic runtimes, including this product's own CLI/MCP surfaces and any future
  repo-harness adapter, resolve "who owns this path" and "what capability context
  applies here" through one command and one tie-break, instead of re-deriving glob
  semantics per product.
- `extensions.lspProfile` and `extensions.verification` are conventions, not schema
  contracts; they can be promoted to validated schema fields in a later ADR once more
  than one adapter depends on them, without a breaking migration, since they are already
  optional and namespaced under `extensions`.
- Ambiguous ownership is a first-class, deliberate resolution outcome (`archctx resolve
  --path` exit code `2`, not a thrown error), so callers see declaration conflicts
  instead of a silently guessed owner.
- The `agent-context` projection only writes into a capability's own primary source
  directory; it is not part of the fixed `docs/architecture/*` drift/rebuild pipeline, so
  it does not change the behavior or coverage of the other eight projection target
  types.
- This ADR does not migrate repo-harness's existing capabilities into ArchContext, add a
  repo-harness-side adapter, extend the MCP `prepare_task` output, or add a write-time
  overlap-exclusivity validator; those remain separate, later decisions.
