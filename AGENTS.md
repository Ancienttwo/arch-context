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
