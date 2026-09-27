# Architecture Index

> Umbrella architecture ledger for current boundaries, drift requests, snapshots, and diagrams.

AL0 ledger authority is frozen in
[`architecture-ledger-authority-matrix.md`](architecture-ledger-authority-matrix.md).

Script ownership and cleanup rules are frozen in
[`script-surface-policy.md`](script-surface-policy.md).

## Current Snapshot

- Latest snapshot: (none yet)
- Semantic diagram source: (none yet)
- Latest human diagram: (none yet)

## Architecture Drift Flow

- `repo-harness run architecture-queue` records architecture-sensitive edits as requests.
- `repo-harness run archive-architecture-request` archives handled requests after an agent records the resolution status and linked artifacts.
- `repo-harness run context-contract-sync` keeps only the controlled architecture block in functional-block `AGENTS.md` and `CLAUDE.md` files aligned.
- `repo-harness run workstream-sync` keeps durable multi-session progress under `tasks/workstreams/<domain>/<capability>/` and projects only pointers into local contracts.
- Semantic architecture diagrams live as Mermaid fenced blocks in the relevant module or snapshot Markdown.
- Human-readable architecture diagrams are optional `mermaid` HTML files in `docs/architecture/diagrams/` and should link back to the Markdown semantic source.

## Pending Requests

<!-- BEGIN ARCHITECTURE PENDING REQUESTS -->
- [ ] 2026-09-09T00:45:34+0800 [medium] `package.json` -> [root](requests/root.md)
<!-- END ARCHITECTURE PENDING REQUESTS -->

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.architecture.index" sourceDigest="sha256:ee6e339157f82b830fc9215416fd7ed56b9fe4046151586464fa59641321ccd8" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:b65b639a96eb1e15e0ca76023ecd625f4136dfde8762d9764d728a0b963bcc11" -->
# Architecture Index

Generated: 1970-01-01T00:00:00.000Z

## Entities

- [Architecture Context](modules/architecture/context.md) — capability / active

## Relations

- component.architecture-context.local-runtime.agent-jobs -> component.architecture-context.local-runtime.runtime-daemon — calls
- component.architecture-context.local-runtime.architecture-book -> component.architecture-context.core.architecture-ledger — calls
- component.architecture-context.local-runtime.architecture-book -> component.architecture-context.local-runtime.runtime-daemon — calls
- component.architecture-context.local-runtime.audit -> component.architecture-context.local-runtime.agent-jobs — calls
- component.architecture-context.local-runtime.audit -> component.architecture-context.core.agent-orchestrator — calls
- component.architecture-context.surfaces.cli -> component.architecture-context.local-runtime.control-file-security — calls
- component.architecture-context.surfaces.cli -> component.architecture-context.surfaces.github-review-state — calls
- component.architecture-context.surfaces.cli -> component.architecture-context.local-runtime.runtime-state-paths — calls
- component.architecture-context.local-runtime.developer-review-run -> component.architecture-context.core.review-engine — calls
- component.architecture-context.local-runtime.developer-review-run -> component.architecture-context.local-runtime.rpc-server — calls
- component.architecture-context.local-runtime.explorer-server -> component.architecture-context.local-runtime.runtime-daemon — calls
- component.architecture-context.local-runtime.external-documentation -> component.architecture-context.local-runtime.runtime-daemon — calls
- component.architecture-context.surfaces.github-review-state -> component.architecture-context.local-runtime.runtime-state-paths — calls
- component.architecture-context.local-runtime.ledger-admin -> component.architecture-context.core.architecture-ledger — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.projection-paths — calls
- component.architecture-context.local-runtime.local-store-sqlite -> component.architecture-context.local-runtime.process-liveness — calls
- component.architecture-context.local-runtime.local-store-sqlite -> component.architecture-context.local-runtime.control-file-security — calls
- component.architecture-context.local-runtime.local-store-sqlite -> component.architecture-context.local-runtime.runtime-state-paths — calls
- component.architecture-context.surfaces.mcp-local -> component.architecture-context.local-runtime.rpc-client — calls
- component.architecture-context.local-runtime.projection-apply -> component.architecture-context.projection-renderer — calls
- capability.architecture.context -> component.architecture-context.projection-renderer — calls
- component.architecture-context.local-runtime.projection-service -> component.architecture-context.projection-renderer — calls
- component.architecture-context.local-runtime.recommendations -> component.architecture-context.core.recommendation-engine — calls
- component.architecture-context.local-runtime.recommendations -> component.architecture-context.core.refactor-assessment — calls
- component.architecture-context.local-runtime.recommendations -> component.architecture-context.local-runtime.runtime-daemon — calls
- component.architecture-context.local-runtime.rpc-client -> component.architecture-context.local-runtime.recommendations — calls
- component.architecture-context.local-runtime.rpc-client -> component.architecture-context.local-runtime.rpc-server — calls
- component.architecture-context.local-runtime.rpc-server -> component.architecture-context.local-runtime.runtime-state-paths — calls
- component.architecture-context.local-runtime.rpc-server -> component.architecture-context.local-runtime.control-file-security — calls
- component.architecture-context.local-runtime.rpc-server -> component.architecture-context.local-runtime.process-liveness — calls
- component.architecture-context.local-runtime.rpc-server -> component.architecture-context.local-runtime.rpc-client — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.agent-jobs — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.architecture-book — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.audit — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.developer-review-run — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.explorer-server — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.external-documentation — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.ledger-admin — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.projection-apply — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.projection-service — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.recommendations — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.rpc-client — calls
- component.architecture-context.local-runtime.runtime-daemon -> component.architecture-context.local-runtime.rpc-server — calls
- component.architecture-context.surfaces.cli -> component.architecture-context.local-runtime.projection-paths — calls

## Projections

- [Mermaid](diagrams/architecture.mmd)
- [Structurizr JSON](diagrams/architecture.structurizr.json)
- [LikeC4](diagrams/architecture.likec4)
- [Decision index](decisions/index.md)
- [Architecture changelog](changelog.md)
<!-- END ARCHCONTEXT:generated target="projection_target.architecture.index" -->
