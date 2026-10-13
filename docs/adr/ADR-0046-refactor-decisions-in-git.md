---
schemaVersion: archcontext.adr/v1
id: adr.0046.refactor-decisions-in-git
title: Refactor Decisions in Git
status: accepted
decidedAt: 2026-10-13
appliesTo:
  - module.architecture-context.contracts
  - component.architecture-context.core.changeset-engine
  - component.architecture-context.core.module-statistics
  - component.architecture-context.core.policy-engine
  - component.architecture-context.core.recommendation-engine
  - component.architecture-context.core.refactor-assessment
  - component.architecture-context.local-runtime.local-store-sqlite
  - component.architecture-context.local-runtime.recommendations
  - component.architecture-context.local-runtime.runtime-daemon
  - component.architecture-context.surfaces.cli
supersedes: []
---

# ADR-0046: Refactor Decisions in Git

## Context

Refactor recommendation selectors hashed `repositoryId`, which is a digest of the worktree
realpath. A second `git worktree add` of the same repository therefore produced a different id for
the same subject. Human decisions (`reject`, `waive`, `defer`, ...) lived only in the SQLite ledger
partition of one workspace and branch, so a new branch or worktree showed every decided
recommendation as open again, and removing the worktree lost the decision. ADR-0037 treats runtime
SQLite as derived state that can be rebuilt from Git; human decisions could not be rebuilt.

The cycle observation was one strongly connected component. Its fingerprint hashed the sorted
member list, so any module entering the component created a new id and a rejection stopped
applying. Its evidence was the first edges in path order, and scans with a `node` or `paths` scope
returned the same repository-wide observations.

## Decision

### 1. Refactor identity is the product namespace

Refactor subject selectors are scoped by the manifest `product.id`
(`.archcontext/manifest.yaml`), read strictly by the runtime and passed explicitly to the planner.
Missing `product.id` fails with `AC_MODEL_ADOPTION_REQUIRED`; a blank or malformed value fails with
`AC_SCHEMA_INVALID`. There is no fallback to `repositoryId`, `storageRepositoryId`, a remote URL or
a package name. The runtime `repositoryId`, the ledger partition and `bindRepository` keep their
meaning. The refactor fingerprint schema moves to `archcontext.recommendation-fingerprint/v3`.

`product.id` is a semantic namespace, not a security principal. Two repositories that declare the
same `product.id` share refactor ids by design; every decision read and write is still bound to one
repository root and its own Git files.

### 2. Human refactor decisions live in Git

One file per recommendation generation:
`.archcontext/refactor-decisions/<recommendationId>.json`, typed
`archcontext.refactor-decision/v1` (`RefactorDecisionV1`,
`schemas/repo/refactor-decision.schema.json`). It holds the latest human decision for that
generation: namespace, id, fingerprint, category, kind, subject, affected nodes, `regressesFrom`,
status (one of the six human statuses, never `open`), the decided metrics, a bounded one-line
reason, actor, time and bounded provenance (HEAD, assessment and baseline digests). It never holds
absolute paths, storage ids, source, diffs or evidence bodies. The reader takes the Git-visible
files of the directory (tracked plus untracked, not ignored), so ignored OS and editor files are
never read; it passes over exactly the ChangeSet engine's own backup and temp names of an open
journal. It rejects symlinks and directories inside it, any other Git-visible file, unknown fields,
conflict markers, a basename that does not match the id and a namespace that does not match the
manifest; a single bad file fails the whole read.

The directory is not under `.archcontext/decisions/` (which is part of `listModelFiles` and would
change `modelDigest`) and not under `.archcontext/waivers/` (practice waivers have their own
semantics). It is outside the default write allowlist; only the ChangeSet operation
`write_refactor_decision` may write it, and only the daemon builds that operation.

### 3. One write path, one journal boundary

All six human verbs on refactor categories (`acknowledge`, `accept`, `reject`, `defer`, `waive`,
`resolve`) write the decision file through `write_refactor_decision`. The ledger records (the
implicit run record for a scan candidate, the lifecycle transition and the feedback) are appended
inside the ChangeSet `afterModelValidatedBeforeCommit` hook with the journal id, so the event
append and the journal commit are one transaction. An append failure rolls the decision file back.
A decision-only ChangeSet does not plan generated projections and does not change `modelDigest`.
The apply runs under the writer lock the decision verb already holds. Practice recommendations keep
their ledger-only lifecycle.

### 4. Approval

The one-shot CLI verbs `archctx recommendations <verb> --id <id> --reason <text>` are the explicit,
narrow approval for that single decision write; no separate plan/apply step is required (#263).
MCP and other programmatic ingress must pass an explicit approval field. The generic
`apply_update` approval gate is unchanged.

### 5. Authority rule

Human status comes only from the decision files in the current checkout. SQLite lifecycle and
feedback events are audit. Every entry point (scan, record, decide, list, show, book, verify) reads
one materialized decision set and its digest; the digest joins the run `inputDigest`. Planner
mapping:

- `rejected` / `waived`: suppressed as `decided-fingerprint`, unless a severity metric got worse;
  then a new generation with `regressesFrom`.
- `deferred` / `acknowledged` / `accepted`: suppressed as `duplicate-active-fingerprint`.
- `resolved`: eligible again, linked through `regressesFrom`.
- No decision file: only a machine `open` record in SQLite suppresses a duplicate. A SQLite human
  status without a Git file has no suppression authority; if that id would be emitted again, it is
  emitted as a new generation with `regressesFrom` (a decided id is never emitted `open` again).
  Readers label such a record `ledger-audit`: it keeps its recorded status as history and never
  appears as open or in a status listing; `book recommendations` without `--open` lists it in
  `ledgerAuditRecommendationIds`. Deciding a `ledger-audit` id is refused with `AC_REFACTOR_STALE`
  (`ledger-audit-generation`) and writes no Git file, because that generation is no longer the
  planner's current one; the refusal names the current generation, found by walking the
  fingerprint's chain forward (each id derives from fingerprint and `regressesFrom`).
  `recommendations metrics` stays report-only over ledger counts and does not read the decisions.

A decision that reached a worktree through Git without a record in that worktree's ledger stays
usable there. `show` answers it from the file (`source: "git-decision"`, no ledger record). A
decision verb plans the current scan without that one decision, which materializes exactly that
generation again (its id derives from fingerprint and `regressesFrom`), records that run in the
local ledger, applies the transition from the file's status and rewrites the file, all in the one
writer-held ChangeSet. The recorded run's `inputDigest` therefore binds the decision set without
that file. If the scan no longer observes that generation, the verb is refused. `refactor verify`
and `resolve` on an id that is only in Git fail with `AC_REFACTOR_EVIDENCE_REQUIRED`
(`git-decision-not-recorded`): no baseline is synthesized and no verification is rebound. The
refusal's `recordCommand` is the verb of the file's status, and on this path a same-status verb is
a first local record rather than a lifecycle no-op, so following it keeps the Git decision as it
was; a `resolved` file is terminal and names no command. The consumer worktree records the
decision before changing the code, so the recorded baseline is the pre-change measurement.

`resolve` stays gated on recorded `refactor verify` evidence at the current HEAD and worktree. A
carried `resolved` decision never makes old verification count as current.

Decisions reach another worktree or branch only through Git: commit the decision file, then create
the branch or worktree from that commit (or merge it). An uncommitted decision is not visible in a
second worktree. A decision changes the worktree digest, so rescan after deciding.

### 6. Cycles are reported per bidirectional module pair

The module statistics snapshot carries the module dependency table, ordered
`(fromNodeId, toNodeId, distinctFileEdgeCount)`, digest-bound and attributed by the same rule as the
file-edge evidence. Each pair `{A, B}` with edges in both directions is one `cycle` observation:
subject `pair:A|B`, affected nodes `[A, B]`, forward and backward counts, `thinDirectionEdgeCount`
and total; evidence holds only that pair's edges, with both directions sampled when the budget
allows, thin direction first. Its fingerprint is namespace, pair and kind only. Cycles that survive
removing the thin direction of every pair are reported as `residual-cycle` observations (one per
remaining strongly connected component, subject `cycle:<component id>`, members as affected nodes). Pairs are ordered by thin
count, total, then ids, before suppression and the cap.

`refactor verify` of a pair succeeds when at least one direction of the pair is zero (or an
endpoint is gone); a residual cycle succeeds when its recorded members no longer form a cycle.
Missing or partial coverage is unverifiable, never success.

### 7. Scan scope filters observations

Every observation carries producer-authored, sorted `affectedNodeIds`; the planner copies them.
The full graph is measured, then `node` and `paths` scopes keep only observations whose affected
nodes intersect the scope before digest, pressure and cap. Repository-only observations drop out of
scoped scans; coverage stays visible in confidence and code facts.

### 8. No migration

Existing SQLite-held refactor decisions from 0.7.x do not carry over: v3 fingerprints and pair
subjects cannot match them, and a component decision cannot be split into pair decisions. Legacy
events stay untouched as audit. Release notes and the runbook say so.

## Consequences

- Decisions survive worktree removal, branch switches and fresh clones of a commit that contains
  them.
- Two branches that decide the same generation differently produce a Git conflict on one file,
  which the reader refuses until it is resolved.
- This is not a ledger-authoritative promotion (ADR-0040): SQLite stays operational state, and
  `.archcontext/` gains one more Git-visible fact class.
- Architecture-delta selectors outside refactor recommendations keep their repository-scoped
  identity.
