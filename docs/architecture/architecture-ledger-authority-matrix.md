# Architecture Ledger Authority Matrix

> Status: AL0 accepted contract
> ADR: `docs/adr/ADR-0040-hybrid-architecture-ledger.md`
> Contract source: `packages/contracts/src/ledger.ts`

This matrix freezes which component can write each fact class during the
architecture-ledger workstream. It is intentionally stricter than the later SQL
schema plan: AL0 defines authority before AL2 adds tables.

## System Boundary

| Component | Responsibility | Strong dependencies | Cannot do |
|---|---|---|---|
| Code + CodeGraph | Observed code facts, selectors, changed symbols, changed edges | Git HEAD/worktree, CodeGraph adapter | Declare architecture truth or update projections |
| `.archcontext/` in Git | Reviewable declared architecture, policies, waivers, deterministic projections | ChangeSet engine, renderer, Git merge/review | Store mutable runtime state or local investigation output |
| Local SQLite runtime | Operational events, snapshots, evidence bindings, recommendation runs, agent jobs, freshness | Runtime daemon, migrations, WAL, repository/worktree identity | Become the only recoverable copy before ledger-authoritative promotion |
| ChangeSet engine | Preview, validate, approve, apply, rollback architecture-affecting mutations | Policy engine, path allowlist, expected digests | Apply stale or out-of-scope writes |
| Runtime daemon | Single writer for event append, snapshot creation, queue/job state, and dual writes | Local store, model store, CodeGraph adapter, CLI/MCP adapters | Let CLI/MCP/hooks bypass mutation rules |
| CLI/MCP/hooks | Trigger workflow, read status/context, submit bounded commands | Runtime daemon RPC | Edit SQLite, WAL, model YAML, generated docs, or direct event rows |
| Subagent runner | Investigate uncertainty and draft typed proposals | Agent job contract, bounded context bundle, evidence bindings | Directly mutate ledger, YAML, docs, policies, or waivers |

## Fact Authority

| Fact class | Writer | Canonical ID rule | Conflict policy | Promotion rule |
|---|---|---|---|---|
| Declared | ChangeSet-approved Git projection in `.archcontext/` | Stable declared architecture ID from repo model | Git conflict or projection drift blocks promotion until reconciled | Already authoritative in `yaml`; in `dual` and beyond, accepted events must rebuild the same projection digest |
| Observed | CodeGraph adapter and deterministic runtime probes | Selector digest scoped by repository and worktree identity | Observed facts can support evidence but cannot overwrite declared facts | May become evidence only after typed selector/provenance is recorded |
| Verified | Deterministic checks, test/readback artifacts, accepted attestations | Verification subject plus evidence digest | New verification supersedes older verification only at the same HEAD/worktree cursor | May promote recommendation authority only through `EvidenceBinding/v1` |
| Proposed | ChangeSet drafts and subagent investigation proposals | Proposal ID plus idempotency key | Proposal remains non-authoritative until validated and approved | Requires deterministic validation and ChangeSet approval |
| Projected | Renderer from accepted architecture state | Projection target path plus source snapshot digest | Human edits outside generated regions become drift requiring explicit reconcile | Runtime may read projected state only in `yaml`; later modes treat it as review/rebuild boundary |

## Repository And Worktree Scoping

Every ledger-affecting record must include:

- repository identity: `repositoryId`, `storageRepositoryId`
- worktree identity: `workspaceId`, `storageWorkspaceId`, `branch`
- cursor identity: `headSha`, `worktreeDigest`
- state identity: base/resulting digest or snapshot cursor

Branch switches, rebases, detached worktrees, and multiple worktrees must never
share mutable current-state rows unless the repository/worktree identity and
cursor match. Stale jobs may remain as history, but they cannot append new
events or update projections.

## Mutation Contract

The only allowed mutation paths are:

1. ChangeSet preview and apply for Git-visible `.archcontext/` projections.
2. Daemon-owned transactional event append for accepted ledger records.
3. Daemon-owned dual operation that performs both sides and can recover or
   rollback consistently.

Direct DB edits by coding agents, scripts, CLI commands, MCP tools, or subagent
outputs are outside the contract.

## Privacy And Storage Guard

Ledger contracts may store:

- repo/worktree IDs, HEAD SHA, worktree digest
- selectors, paths when already allowed by local runtime policy, and bounded
  summaries
- evidence IDs, binding IDs, digests, provenance, status, counters

Ledger contracts must not store:

- raw source body
- raw diff or patch body
- prompt or completion body
- full CodeGraph output body
- secrets, credentials, private keys, or raw GitHub webhook bodies

## Out Of Scope For AL0

- Creating SQLite ledger tables.
- Implementing dual-write or replay.
- Adding Book CLI commands.
- Enabling automatic subagent spawning.
- Promoting SQLite to runtime authority.
