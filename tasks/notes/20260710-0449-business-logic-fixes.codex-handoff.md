# Business Logic Deep Review Remediation

> **Status**: Completed
> **Source Review**: `tasks/reviews/20260710-0449-business-logic-deep-review.review.md`
> **Authority**: ADR-0040, architecture-ledger authority matrix, and current contracts/source
> **Scope**: F1-F18 from the source review

## Goal

Close every verified finding in the business-logic deep review without enabling
`ledger-authoritative` promotion. Git-visible `.archcontext/` remains the review
boundary; SQLite remains daemon-owned operational state.

## Architecture Map

- `packages/core/changeset-engine`: filesystem mutation state machine, expected
  hashes, validation, rollback, and journal coordination.
- `packages/local-runtime/local-store-sqlite`: durable journal, ledger event
  transaction, scoped materialized state, recovery, and privacy persistence gate.
- `packages/local-runtime/runtime-daemon`: single-writer orchestration for
  ChangeSet apply, ledger project/rollback, recommendation feedback, and complete
  gate readback.
- `packages/core/architecture-ledger`: typed event validation, YAML import/export,
  replay, graph digest, and contract-preserving projection.
- `packages/core/projection-engine` and `model-store-yaml`: generated/mixed file
  planning, path ownership, manifest integrity, and generated projection writes.

## Authoritative Flow

`plan_update` captures HEAD, worktree, and model digests. `apply_update` must
compare that captured base with current state, persist full file intent before
the first destructive filesystem operation, validate the resulting model, and
atomically finalize the ledger event plus ChangeSet journal. Startup recovery
must deterministically finish or roll back the same durable operation.

## Invariants

1. Invalid or stale ChangeSets fail closed and leave YAML/ledger unchanged.
2. Journal intent is durable before rename/delete/write; every crash point is
   recoverable without orphan backups or fabricated success.
3. Ledger state and replay are scoped by repository, worktree, branch, HEAD, and
   worktree digest, with base/resulting graph digest CAS.
4. Raw source, raw diff, prompts/completions, full CodeGraph output, secrets,
   credentials, private keys, and raw webhook bodies are rejected before any
   durable ledger/FTS/artifact write.
5. Ledger-to-YAML projection is schema-valid and preserves declared fields.
6. All Git-visible multi-file writes use the ChangeSet journal boundary.

## Task Breakdown

### Phase 1 - ChangeSet atomicity and correctness

- [x] F1 reject `{ valid: false }` before commit and prove rollback.
- [x] F2 persist file intent before destructive rename and prove real-SQLite
      crash recovery leaves no orphan backup and permits the next apply.
- [x] F3 enforce draft HEAD/worktree/model base digests at apply time.
- [x] F4 atomically finalize ledger append and ChangeSet journal state.
- [x] F5 set and verify `PRAGMA synchronous = FULL`.

### Phase 2 - Boundary containment

- [x] F6 reject writes through symlinked parent directories using canonical
      containment checks.
- [x] F7 enforce a typed, size-bounded privacy gate immediately before ledger
      persistence, including recommendation feedback.
- [x] F15 reject escaping `source.include`, verify marker digests, and coalesce
      same-path capability regions deterministically.

### Phase 3 - Ledger authority consistency

- [x] F8 make YAML import/export round trips contract-preserving and schema-valid.
- [x] F9 route ledger project and rollback Git-visible writes through ChangeSet.
- [x] F10 scope current state, replay, hash chain, idempotency, FTS, and snapshots
      by the complete worktree cursor.
- [x] F11 enforce base/resulting graph digest CAS inside append transactions.

### Phase 4 - Recovery, integrity, and scale

- [x] F12 isolate recovery failures per journal and preserve remaining recovery.
- [x] F13 treat malformed planned ledger metadata as a recovery error, never as
      an absent append plan.
- [x] F14 bound committed-journal cleanup and remove O(history) startup scans.
- [x] F16 protect generated projection replacement with journaled file writes.
- [x] F17 include the projection manifest and marker digests in drift/complete gates.
- [x] F18 replace implementation-shape tests with invariant and negative tests.

## Verification

- Targeted tests for each owning package and every named negative/crash case.
- `bun run typecheck`.
- `bun test` after targeted suites pass.
- `bun run verify` before declaring the remediation complete.
- Requirement-by-requirement evidence recorded back into the source review; no
  authority-promotion claim is permitted by this task.

## Verified Closeout

- `git diff --check`: pass.
- `bun run typecheck`: pass.
- `bun test`: 1008 pass, 0 fail, 6096 assertions.
- `bun run verify`: pass, including package boundaries, production mock
  reachability, privacy audits, acceptance ledgers, packaged CLI smoke, and the
  representative eval.
- Negative coverage now exercises invalid-model rollback, pre-rename recovery,
  stale ChangeSet bases, atomic ledger/journal rollback, symlink escape, privacy
  rejection, full-cursor isolation, graph CAS, idempotency rollback, per-journal
  recovery isolation, malformed recovery metadata, bounded cleanup, journaled
  generated projection replacement, and manifest tamper blocking.

## 10x Pressure

The first scale failure in the current design is unbounded journal/event startup
work. Phase 4 bounds recovery scans and makes cleanup state-driven. Event history
compaction remains owned by the existing ledger snapshot/compaction contract and
is not replaced by a second retention mechanism here.
