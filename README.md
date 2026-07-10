# ArchContext

[English](README.md) | [简体中文](README.zh-CN.md)

> Code with an architect on standby.

ArchContext is a software architecture control loop embedded in the Agentic Coding Runtime. It compiles architecture context before a task, detects structural pressure during development, pushes evidence-based refactors when necessary, and synchronizes and verifies system state before a task completes.

This repository is the product, architecture, and execution contract skeleton for the ArchContext MVP, and includes the contracts, local runtime, surfaces, and cloud governance scaffold.

## Product Shape

- Local Core is the product center: one `archctx` install ships CLI, `archctxd`, MCP stdio adapter, local RPC schema, local SQLite migrations, CodeGraph adapter compatibility, and runtime provenance.
- GitHub App is optional governance. It handles installation metadata, PR lifecycle events, Challenge, Attestation verification, and Check delivery. It does not clone repositories, read PR files, run review, or host an LLM provider.
- Developer and organization results are separate: `ArchContext / Developer Review` is developer-attested; `ArchContext / Organization Runner` is customer-runner-attested and is the only context intended for organization required checks.

## ChangeSet & Ledger Integrity

- ChangeSet apply is fail-closed end to end: an invalid model is rejected and rolled back instead of committed, file intent is journaled before any destructive rename, draft preconditions compare the declared HEAD/worktree/model base digests, and ledger append plus journal commit share one SQLite transaction (`PRAGMA synchronous=FULL`).
- Writes under `.archcontext/` are contained by realpath parent resolution, so a symlinked write target cannot escape the repository; ledger persistence enforces a single privacy gate that rejects secret-shaped, raw-diff, or free-text payloads before they reach storage.
- `ledger project` and rollback run through the same ChangeSet journal as any other write, and the ledger-to-YAML round trip preserves declared schema fields instead of dropping them into an opaque `metadata` blob.
- Ledger state, replay, FTS, and snapshots partition by the full worktree cursor (repository, worktree, branch, HEAD, digest) with base/resulting graph digest CAS enforced on append; crash recovery is isolated per journal entry and startup cleanup work is bounded per run.

## Practice Assets Trust Boundary

ArchContext Practice Assets v1 has two deliberately separate inputs:

- Static Practice Assets: versioned YAML assets shipped with the product plus
  explicit repo overlays under `.archcontext/practices/`. They are
  deterministic, provenance checked, packaged in the npm tarball, and usable
  offline through `archctx practices list/show/validate/sources`.
- Dynamic Documentation References: optional Context7 resources fetched only
  through explicit `archctx docs resolve|pin|fetch` commands with
  `--allow-network`. They are cached as external, unverified, advisory-only
  resources and cannot create complete-stage enforcement.

Local Core does not need GitHub App, ArchContext Cloud, an LLM provider, or
Context7 to run practice matching, checkpoint, complete, or MCP. By default
there is no source body, diff, prompt, model output, secret, or unredacted path
sent to a documentation provider. See `docs/runbooks/practice-assets-v1.md` for
repo practice authoring, enforcement promotion, waiver, hook, Context7 pinning,
source-update, rollout, and rollback operations.

## Repository Map

- `docs/spec.md`: stable product truth.
- `docs/runbooks/local-core-quickstart.md`: Local Core first-run path.
- `docs/runbooks/practice-assets-v1.md`: Practice Assets v1 authoring,
  privacy, rollout, and rollback operations.
- `plans/prds/20260619-2039-archcontext.prd.md`: ArchContext PRD v2.0.
- `plans/prds/20260620-0236-archcontext-local-github-governance.prd.md`: Local product and GitHub governance follow-up PRD.
- `plans/sprints/archctx-local-github-governance-sprint.md`: Follow-up governance execution checklist.
- `plans/sprints/archctx-sprint.md`: MVP M0-M6 execution backlog.
- `docs/researches/`: research material and historical PRD baselines.
- `docs/architecture/`: architecture index, diagrams, and entrypoints for later snapshots.
- `packages/contracts/`: M0 contract types, Envelope, Digest, path guards, and the minimal JSON Schema validator.
- `AGENTS.md` / `CLAUDE.md`: root working contracts for Codex and Claude.

## Current State

- Repo-harness workflow/context/task gates are initialized.
- CodeGraph project index is initialized for source navigation.
- `bun test` and `bun run verify` are the current local code gates.
- Repo-harness runtime helpers come from the global `repo-harness` CLI; local generated wrappers under `scripts/` are ignored compatibility files and may be absent. Use `repo-harness run <helper>`.
