# Plan: Runtime State Quarantine and Git Rebuild

> **Status**: Executing
> **Created**: 20260712-1245
> **Slug**: runtime-state-quarantine-rebuild
> **Planning Source**: waza-think
> **Orchestration Kind**: standalone-recovery-slice
> **Source Ref**: user-approved-next-slice:runtime-state-quarantine-rebuild
> **Artifact Level**: work-package
> **Promotion Reason**: data_recovery_boundary
> **Verification Boundary**: Dry-run/write failure matrix, verified quarantine, daemon-owned Git rebuild, host recovery, package/full verify, Architecture/Security and lifecycle readback
> **Rollback Surface**: Code revert only; quarantined runtime bytes remain preserved and are never auto-restored
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md`
> **Task Review**: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md`
> **Implementation Notes**: `tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md`

## Agentic Routing
- Selected route: think
- Routing reason: Captured from waza-think planning output.
- Source ref: user-approved-next-slice:runtime-state-quarantine-rebuild
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md`
- Sprint contract: `tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md`
- Sprint review: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md`
- Implementation notes: `tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md`
- Review file: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md`
- Implementation notes file: `tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Code revert only; quarantined runtime bytes remain preserved and are never auto-restored
- **Verification boundary**: Dry-run/write failure matrix, verified quarantine, daemon-owned Git rebuild, host recovery, package/full verify, Architecture/Security and lifecycle readback
- **Review/acceptance boundary**: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: data_recovery_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md`, `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md`, and `tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Code revert only; quarantined runtime bytes remain preserved and are never auto-restored

## Captured Planning Output

# Objective

Add one supported, fail-closed recovery path for an unusable default ArchContext
SQLite operational partition: preserve it byte-for-byte in a private quarantine,
publish a clean current-schema runtime store, and rebuild ledger runtime state only
through the existing daemon-owned `ledgerRebuild --from-git` boundary.

# Success Criteria

- `archctx state recover --from-git` is dry-run by default and works even when normal
  daemon startup is blocked by the current SQLite target.
- The dry-run reports `recovery-required` only for the default partition whose target
  is `target-incomplete`; absent and current targets are explicit no-op/refusal states.
- `--write` requires both the exact current worktree digest and the exact target-file
  fingerprint returned by dry-run. There is no `--force`, arbitrary path, or implicit
  confirmation mode.
- Write recovery acquires the existing migration lock, revalidates every precondition,
  proves sufficient disk space, creates and verifies a complete private quarantine
  copy, builds a clean current-schema store in staging, and publishes it without
  touching `.archcontext/`.
- If publish fails, the original invalid target is restored from the verified
  quarantine copy. If Git rebuild fails after publish, the new target stays valid,
  quarantine stays intact, and the command returns the exact retry command.
- The Git rebuild crosses the existing daemon-owned `ledgerRebuild` API; the recovery
  helper never appends ledger events or translates old SQLite semantics itself.
- The current host-default failing partition is recovered through the shipped command,
  its quarantine/receipt are read back, and a no-override `bun run verify` passes.
- No compatibility reader, data salvage parser, database rewrite-in-place, authority
  promotion, direct `.archcontext/` mutation, or destructive cleanup is added.

# P1 · Architecture Map

- Authority: Git-visible `.archcontext/` remains the only recovery source of truth.
- Operational state: `runtimeStatePaths()` owns the default partition and quarantine
  directory; SQLite is disposable but the previous bytes remain preserved for audit.
- Recovery control plane: CLI handles `state` before ordinary runtime creation so a
  broken target cannot block the command intended to repair it.
- Mutation boundary: local-store owns lock/staging/quarantine/publish; daemon owns the
  typed rebuild event and runtime current-state fold.
- Evidence: ADR-0037 plus a JSON/Markdown host readback. Receipts contain only paths,
  sizes, digests, reason codes, and timestamps—never database rows or source bodies.

This touches more than eight repository artifacts once plan/contract/review/evidence
are counted, but the product blast radius is four files across two existing modules.

# P2 · Concrete Flow

```text
archctx state recover --from-git
  -> inspect default runtimeStatePaths without starting daemon
  -> classify target-incomplete
  -> stream-hash runtime.sqlite + WAL/SHM + migration marker
  -> return worktreeDigest + targetFingerprint + exact --write command

archctx state recover --from-git --write
  -> require expectedWorktreeDigest + expectedTargetFingerprint
  -> acquire existing migration lock
  -> re-inspect and re-hash; stale input fails before mutation
  -> disk-capacity preflight
  -> create current-schema staging SQLite and integrity-check it
  -> copy target family to private quarantine and verify copy fingerprint
  -> write fsynced metadata-only recovery receipt
  -> remove invalid target family; publish staged target; assert current schema
  -> start/reuse daemon on the new valid target
  -> daemon.ledgerRebuild(fromGit=true, expectedWorktreeDigest)
  -> return quarantine + receipt + rebuild result
```

Errors before publish leave the target untouched. A caught publish error restores the
exact quarantined bytes and verifies the original fingerprint. A post-publish rebuild
error does not restore an unusable database over a valid store; it returns
`archctx ledger rebuild --from-git --expected-worktree-digest <exact>` for retry.

# P3 · Decision

Choose explicit quarantine-and-rebuild, not automatic startup recovery. Automatic
quarantine would turn a migration bug, disk failure, or foreign database into silent
data loss. In-place repair or semantic salvage is rejected because it creates a
compatibility parser and can reinterpret non-authoritative runtime rows.

The fragile assumption is that the target is genuinely `target-incomplete`, not a
current store with a live writer. The design survives failure of that assumption by
accepting writes only after lock-protected reclassification and an exact fingerprint;
current, absent, overridden, or changed targets fail closed.

At 10x size, free disk and sequential copy/hash time fail first. The command therefore
preflights required bytes, hashes in bounded chunks, emits file counts/sizes, and never
loads a database body into memory.

# Public Interface

```text
archctx state recover --from-git
archctx state recover --from-git --write \
  --expected-worktree-digest <sha256:...> \
  --expected-target-fingerprint <sha256:...>
```

- Optional `--accept-external-projection` is forwarded only to the existing typed
  rebuild API; it is never implied by recovery.
- `ARCHCONTEXT_LOCAL_STORE_PATH` is rejected because recovery owns only the canonical
  default partition. `ARCHCONTEXT_STATE_DIR` remains supported for clean-room tests.
- Help and doctor/paths remain read-only; no alias or legacy command is introduced.

# File Scope

- `packages/local-runtime/local-store-sqlite/src/index.ts`
- `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`
- `packages/surfaces/cli/src/main.ts`
- `packages/surfaces/cli/test/cli.test.ts`
- `docs/adr/ADR-0037-runtime-state-placement.md`
- `docs/verification/runtime-state-recovery-readback.json`
- `docs/verification/runtime-state-recovery-readback.md`
- matching plan/contract/review/notes and lifecycle artifacts

# Verification

- Local-store tests: dry-run classification, bounded fingerprint, exact quarantine
  copy, permissions, receipt privacy, stale fingerprint, stale worktree contract,
  migration-lock contention, insufficient disk, publish rollback, and current/absent/
  override refusal.
- CLI tests: command bypasses broken runtime startup, exact confirmation flags, daemon
  rebuild only after publish, external-projection flag remains explicit, rebuild error
  includes retry evidence, help surface and packaged behavior.
- Focused commands:

```bash
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts \
  packages/surfaces/cli/test/cli.test.ts
bun run typecheck
node scripts/packaged-cli-smoke.mjs
bun run verify
repo-harness run verify-contract --contract <contract> --strict
REPO_HARNESS_DIFF_BASE=<base> repo-harness run verify-sprint -- --strict
```

- Host acceptance: dry-run current failing partition, execute its exact write command,
  verify original file-family digests under quarantine, run normal `archctx status`,
  `archctx ledger state`, and no-override `bun run verify`.

# Rollback and Stop Conditions

- Rollback code by reverting the merge. Runtime rollback is never automatic: the
  quarantine is retained, and restoring it requires a separate explicit future
  contract because the current command intentionally replaces an unusable target.
- Stop if implementation needs a legacy semantic reader, row-level salvage, direct
  event append, `.archcontext/` write, arbitrary path reset, live-daemon takeover,
  database migration-history rewrite, or deletion of quarantine/user state.
- Stop if the current host target fingerprint changes between dry-run and write or if
  the rebuild proposes external projection changes without explicit acceptance.

# Task Breakdown

- [x] Capture bounded plan/contract/worktree and preserve the user untracked checksum.
- [x] Add read-only recovery inspection and bounded target-family fingerprinting.
- [x] Add lock-protected staging, verified quarantine copy, publish, and restore-on-error.
- [x] Add the daemon-bypassing CLI dry-run/write surface and existing rebuild handoff.
- [x] Update ADR-0037 and add focused failure-matrix coverage.
- [x] Run focused/package/full verification plus Architecture and Security review.
- [x] Exercise the supported command on the current host partition and record readback.
- [x] Strict-verify, archive, fast-forward to main, clean branch/worktree markers, and
      prove the user-owned untracked artifact remains byte-identical.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->
