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
- (none)
<!-- END ARCHITECTURE PENDING REQUESTS -->

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.architecture.index" sourceDigest="sha256:53690c91a7030265ad7abd043d685e34060093cb732aff4aa6faa50b367d5b55" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:5367cf6edd0e2b2f58bd1cb2c9c3703759eac308a50c36a4c29960bf96a1145c" -->
# Architecture Index

Generated: 1970-01-01T00:00:00.000Z

## Entities

- [Architecture Context](modules/capability-architecture-context.md) — capability / active
- [Agent Orchestrator](modules/component-architecture-context-core-agent-orchestrator.md) — component / active
- [Application Control Loop](modules/component-architecture-context-core-application.md) — component / active
- [Architecture Delta](modules/component-architecture-context-core-architecture-delta.md) — component / active
- [Architecture Domain](modules/component-architecture-context-core-architecture-domain.md) — component / active
- [Architecture Ledger](modules/component-architecture-context-core-architecture-ledger.md) — component / active
- [ChangeSet Engine](modules/component-architecture-context-core-changeset-engine.md) — component / active
- [Context Compiler](modules/component-architecture-context-core-context-compiler.md) — component / active
- [Policy Engine](modules/component-architecture-context-core-policy-engine.md) — component / active
- [Practice Catalog](modules/component-architecture-context-core-practice-catalog.md) — component / active
- [Practice Engine](modules/component-architecture-context-core-practice-engine.md) — component / active
- [Pressure Engine](modules/component-architecture-context-core-pressure-engine.md) — component / active
- [Recommendation Engine](modules/component-architecture-context-core-recommendation-engine.md) — component / active
- [Reconcile Engine](modules/component-architecture-context-core-reconcile-engine.md) — component / active
- [Refactor Decision](modules/component-architecture-context-core-refactor-decision.md) — component / active
- [Retrieval](modules/component-architecture-context-core-retrieval.md) — component / active
- [Review Engine](modules/component-architecture-context-core-review-engine.md) — component / active
- [Architecture Documentation Renderer](modules/component-architecture-context-projection-renderer.md) — component / active
- [Cloud Workspace](modules/module-architecture-context-cloud.md) — module / active
- [Contracts Workspace](modules/module-architecture-context-contracts.md) — module / active
- [Core Workspace](modules/module-architecture-context-core.md) — module / active
- [Local Runtime Workspace](modules/module-architecture-context-local-runtime.md) — module / active
- [Surfaces Workspace](modules/module-architecture-context-surfaces.md) — module / active

## Relations

- [capability.architecture-context -> component.architecture-context.projection-renderer](relations/relation-architecture-context-projection-renderer.md) — calls

## Projections

- [Mermaid](diagrams/architecture.mmd)
- [Structurizr JSON](diagrams/architecture.structurizr.json)
- [LikeC4](diagrams/architecture.likec4)
- [Decision index](decisions/index.md)
- [Architecture changelog](changelog.md)
<!-- END ARCHCONTEXT:generated target="projection_target.architecture.index" -->
