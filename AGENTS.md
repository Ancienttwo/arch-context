# Repo Agent Context

This is the root routing contract for Claude Code and Codex.

## Root Workflow Contract

- Keep sibling `CLAUDE.md` and `AGENTS.md` files aligned. Claude Code consumes `CLAUDE.md`; Codex consumes `AGENTS.md`.
- Treat `docs/spec.md` as stable product truth, `tasks/current.md` as a derived status snapshot, and `tasks/todos.md` as the deferred-goal ledger; current execution stays in the active plan's `## Task Breakdown`.
- Treat `docs/researches/`, `tasks/lessons.md`, and `.ai/harness/policy.json` as durable workflow context.
- Use `.ai/context/context-map.json` and `.ai/context/capabilities.json` to discover functional-block contracts.
- Do not infer local `CLAUDE.md` or `AGENTS.md` files from broad physical layouts such as `apps/*`, `packages/*`, or `services/*`.
- Put capability-specific ownership, entrypoints, and verification commands in explicitly selected functional-block contracts.
- Keep root context concise; route deep implementation detail into plans, task notes, research, workstreams, or architecture docs.
- Treat `_ref/` as ignored external reference material and `_ops/` as ignored local operations state.
- Prefer repo-local workflow artifacts over tool-specific chat memory.

## Architecture Ledger Contract

- Treat `docs/adr/ADR-0040-hybrid-architecture-ledger.md`, `docs/architecture/architecture-ledger-authority-matrix.md`, and `packages/contracts/src/ledger.ts` as the AL0 source of truth for ledger authority.
- Current Git-visible architecture truth remains `.archcontext/`; SQLite ledger state is operational runtime state until an accepted `ledger-authoritative` promotion.
- Do not edit SQLite databases, WAL files, runtime state directories, generated projections, or `.archcontext/` model files to bypass ChangeSet/daemon mutation rules.
- Ledger-affecting writes must go through ChangeSet or a daemon-owned transactional event append. CLI, MCP, hooks, and agents are triggers/readers unless an explicit command crosses that boundary.
- Subagents may produce typed proposals and investigation reports only; they must not directly mutate ledger, YAML, docs, policies, or waivers.
- Do not persist raw source bodies, raw diffs, prompt/completion bodies, full CodeGraph output, secrets, credentials, or private keys in ledger artifacts.

<!-- BEGIN ARCHCONTEXT AGENT CONTEXT id="capability.architecture.context" sourceDigest="sha256:2fdaf1f14686c4feec98054c2256c93776f73bff7ec3d25cceef04c340bc3088" rendererVersion="archcontext.agent-context-renderer/v1" outputDigest="sha256:3e4fe25ceff548e583d76672a5e0f49cf8614bd3460273dcd340e7701ef5503d" -->
# Agent Context: Architecture Context

- id: `capability.architecture.context`
- kind: `capability`
- summary: Keeps product and architecture intent available to coding agents.
- source.include: `packages/**/src/**`
- source.exclude: `packages/**/test/**`
- extensions digest: sha256:351dc5b26a520378d1e0766cda3dbba213f362971b4a90eff010d687db88111f
<!-- END ARCHCONTEXT AGENT CONTEXT id="capability.architecture.context" -->
