---
schemaVersion: archcontext.adr/v1
id: adr.0040.hybrid-architecture-ledger
title: Hybrid Architecture Ledger
status: accepted
decidedAt: 2026-06-25
appliesTo:
  - package.contracts
  - package.local-store-sqlite
  - package.runtime-daemon
  - package.changeset-engine
  - package.surfaces-cli
  - package.surfaces-mcp-local
supersedes: []
---

# Context

ArchContext already has two useful state classes:

- Git-reviewed `.archcontext/` YAML and generated projections.
- Local runtime state in SQLite, snapshots, checkpoints, evidence, review results,
  and ChangeSet journal records.

The architecture-ledger workstream needs passive, queryable history without
making a local database the only recoverable architecture source in one release.
The sprint checklist originally named `ADR-0026`, but that number is already
assigned to Multi-repo Architecture Context. This ADR uses the next available
number to preserve the ADR ID invariant.

# Decision

Adopt a hybrid architecture ledger.

Git-tracked `.archcontext/` remains the review and collaboration boundary.
Local SQLite becomes the operational architecture ledger for events, snapshots,
current graph state, evidence bindings, recommendation runs, agent jobs,
freshness, and history.

The runtime modes are:

- `yaml`: YAML is authoritative; ledger tables may be absent.
- `dual`: accepted mutations update YAML projections and ledger records through
  one daemon-owned operation.
- `ledger-shadow`: YAML remains authoritative; ledger records and compares
  deterministically but does not drive runtime decisions.
- `ledger-authoritative`: runtime reads ledger current state; Git projections
  remain rebuildable review artifacts.

All ledger-affecting mutations must pass through ChangeSet or an equivalent
daemon-owned transactional event append. CLI, MCP, hooks, and coding agents must
not edit SQLite files, WAL files, generated projections, or `.archcontext/`
model files as a shortcut around the daemon/change-set boundary.

Subagents are investigators and drafters only. They may produce typed
`InvestigationReport/v1` output with evidence references and proposed deltas,
but they cannot directly mutate the ledger, YAML, or docs.

The ledger stores selectors, digests, summaries, provenance, and bounded typed
evidence. It must not persist raw source bodies, raw diffs, prompt/completion
bodies, or full CodeGraph output.

# Consequences

- AL2 must extend the existing `runtime.sqlite` store; it must not introduce a
  second database unless a measured isolation need is accepted by a later ADR.
- AL3 must prove YAML-to-ledger-to-YAML determinism before any authority
  promotion.
- Ledger snapshots and events must be scoped by repository, branch, HEAD SHA,
  and worktree digest so branch switches and multiple worktrees cannot
  contaminate each other.
- Rollback must always be able to return to `yaml` mode from Git projections and
  observed code facts.
- Evidence binding is a first-class contract; free-text practice ID matching
  cannot grant checkpoint or complete authority.
