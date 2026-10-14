# Plan: #328 D6-A selected failure contract

> **Status**: Executing
> **Owner**: delegated Codex D6-A sole implementation writer
> **Baseline**: d6788c4b565aa043530b2f6407234b3ed108fa00
> **Task Contract**: `tasks/contracts/20261014-2030-issue-328-d6-a-failure-contract.contract.md`
> **Task Review**: `tasks/reviews/20261014-2030-issue-328-d6-a-failure-contract.review.md`
> **Implementation Notes**: `tasks/notes/20261014-2030-issue-328-d6-a-failure-contract.notes.md`
> **Created**: 2026-10-14

## Authority and workflow inventory

The coordinator explicitly accepted D5 and authorized D6-A implementation, tests, an ordinary
push and a separate Draft PR. Acceptance/merge stays with the coordinator; no release or issue
closure. Latest remote main and merged #353 were read back; no D6 branch/PR/claim existed.
The existing D5, BYOK, U4 and #351 worktrees are preserved. Current execution is this plan's
Task Breakdown, not the inherited D5 plan. Scope authority is this task contract.

## Goal and boundary

CLI debt, checkpoint, practices checkpoint, complete/review; MCP archcontext_checkpoint,
archcontext_practice_checkpoint, archcontext_complete_task; their direct/embedded producers;
hook checkpoint inner failures. Selected CLI/MCP input refusals are included. No practice
catalog/waiver, hook enqueue/fast, projection/apply/state, RPC registry/transport/wire, U4/scanner,
D5 evidence, #351 upgrade, D7 renderer/protocol floor/advertisement or workflow budget changes.
A is one slice, not completion of D6 or #328. No extra implementation writer.

P1: contracts own failure metadata; producers own classification; surfaces only adapt it.
P2: anchors loses metadata in ArchitectureDebtReadError; debt guesses preconditions for unknown
throws; practice/complete setup throws escape their typed catch; CLI/MCP overwrite source failures.
P3: retain successful value APIs and existing business judgments; classify once without reading
message/stack and retain call-local D5 discovery. No persistence, cache or new I/O in helpers.

## Frozen compatibility choices

W1: AC_UNCLASSIFIED_FAILURE / failure-unclassified / inspect-diagnostics; severity error,
retryable false prohibits automatic retry and does not assert permanence. Fixed safe message;
unknown details are empty or a fixed stage only. No arbitrary message, Error spread or logs.
W2: RPC_TIMEOUT/RPC_ABORTED remain their existing strings. A separate selected FailureCode /
FailureEnvelope type and CLI/MCP adaptation support these; the legacy AC-only JsonEnvelope and
RPC registry/transport remain unchanged. Embedded AC producers retain JsonEnvelope compatibility.
W6: successful readArchitectureDebt/readCompleteTaskArchitectureDebt signatures remain values;
known typed failures and pure toEnvelope normalization are exported, not envelope-return unions.
Known producer code/action/reason/severity/retryability survive adaptation. An unregistered or
unsafe purported failure is not an authoritative known error. Runtime RPC failures describe an
unobserved response, not proof of a failed mutation; no automatic replay.

## Frozen producer/reason details allowlist

Every row also permits fixed `stage`, chosen from debt, complete, practice-checkpoint, cli,
mcp, hook-checkpoint, failure-metadata. No arbitrary strings or caller-selected stages.

| Source / reason | Code | Additional allowed details | Action source |
|---|---|---|---|
| Git discovery / git-worktree-required | AC_REPO_NOT_FOUND | checks: ownership/anchors only | existing catalog / producer |
| adopted debt / model-missing | AC_MODEL_ADOPTION_REQUIRED | checks: ownership/anchors only | existing catalog / producer |
| debt paths / changed-path-invalid | AC_SCHEMA_INVALID | checks: ownership/anchors only | existing catalog / producer |
| checked report / debt-report-invalid | AC_SCHEMA_INVALID | checks: ownership/anchors only | existing catalog / producer |
| anchors or complete / projection-manifest-upgrade-required | AC_PRECONDITION_FAILED | none | existing catalog / producer |
| anchors or complete / projection-manifest-invalid | AC_PRECONDITION_FAILED | none | existing catalog / producer |
| anchors or complete / projection-footprint-uncovered | AC_PRECONDITION_FAILED | none | existing catalog / producer |
| required code facts / index-missing | AC_CODE_FACTS_UNAVAILABLE | none | existing catalog / producer |
| MCP checkpoint schema / checkpoint-input-invalid | AC_SCHEMA_INVALID | issueCount: finite nonnegative safe integer | correct-command-arguments |
| selected CLI preflight / cli-input-invalid | AC_SCHEMA_INVALID | none | correct-command-arguments |
| complete caller-owned fields / complete-input-invalid | AC_SCHEMA_INVALID | none | correct-command-arguments |
| hook event / hook-event-invalid | AC_SCHEMA_INVALID | none | correct-command-arguments |
| typed local egress / egress-policy-denied | AC_POLICY_VIOLATION | none | existing catalog / producer |
| typed runtime version / runtime-version-unsupported | AC_RUNTIME_VERSION_UNSUPPORTED | none | existing catalog / producer; no floor changes |
| selected transport / rpc-timeout | RPC_TIMEOUT | method enum health/practiceCheckpoint/completeTask, timeoutMs/elapsedMs finite nonnegative, mutationOutcome=unknown | reconcile-before-retry, retryable false |
| selected transport / rpc-aborted | RPC_ABORTED | same as timeout | reconcile-before-retry, retryable false |
| unknown / failure-unclassified | AC_UNCLASSIFIED_FAILURE | stage only; no omittedCount carrying raw diagnostics | inspect-diagnostics, error, retryable false |

Known messages are safe fixed reason text, never copied from upstream errors. Known action
values must be registered catalog actions or the explicit correct-command-arguments,
inspect-diagnostics, reconcile-before-retry actions. Unknown reason/code combinations are
unclassified; no message-based reclassification. Future real known reasons require ledger
and allowlist extension before calling the slice accepted.

## UTF-8 budgets and refusal policy

Details <=8192 bytes; message <=1024 bytes; depth <=4; per-object keys <=16; arrays <=32;
general strings <=256 bytes. Values are copied by the closed allowlist, not traversed as raw
Error/JSON. Excess ordinary summary facts are omitted and counted by bounded omittedCount.
No known reason in this slice currently carries an ID/digest/receipt recovery binding; such
unexpected keys are a metadata-contract refusal, not silently omitted as ordinary facts. Unknown
compound facts are also refused without traversal because they may contain a nested binding.
Key IDs/digests/receipts are never truncated. If an actual producer requires one, stop and
coordinate before extending this table. Unsafe/invalid typed metadata cannot be accepted as a
success or falsely preserved; the boundary may only emit a safe unclassified metadata-stage
failure. No stack, source/body/diff, stderr, credentials, absolute path, root or state output.

## Verification and acceptance

Producer x direct/embedded x CLI process x selected MCP must prove known metadata survives,
unknown/forged/cyclic/huge/sensitive inputs cannot leak, all output byte budgets hold, timeout/
abort preserves its code and never retries. Preserve success report/digest/coverage and
fail_action_required actions, hook outer fail-open, practice coalescing/citation repair.
Debt rejection does not advance baseline; reads do not create daemon/state/model/generated
outputs. Existing complete persistence and writer authority remain unchanged.
Use the canonical contract checks; capture exact subject/environment and do not reuse old-HEAD
passes as new evidence. Report timeout/cancel/omitted checks. A separate hosted matrix and
coordinator independent acceptance remain required. Revert only this composition/metadata
slice; no data migration. Stop on competing writer, scope expansion, unrecoverable binding,
known-code loss, guessed cause, privacy leak or changed success/read-write semantics.

## Task Contracts

- Contract file: `tasks/contracts/20261014-2030-issue-328-d6-a-failure-contract.contract.md`
- Review file: `tasks/reviews/20261014-2030-issue-328-d6-a-failure-contract.review.md`
- Notes file: `tasks/notes/20261014-2030-issue-328-d6-a-failure-contract.notes.md`
- Verification command: `repo-harness run verification-plan execute --repo . --contract tasks/contracts/20261014-2030-issue-328-d6-a-failure-contract.contract.md`

## Task Breakdown

- [x] Verify remote main, D5 merge and no duplicate D6 writer; create independent worktree.
- [x] Freeze W1/W2/W6, source/reason allowlist, exact paths and verification plan before source edits.
- [x] Capture red regression cases against unchanged baseline.
- [x] Add pure strict typed failures/allowlists/validator and selected producer/surface adaptation.
- [x] Run negative, compatibility, no-write/baseline/coalescing and affected-suite checks; repair.
- [ ] Review final source diff, run canonical verification and preserve bounded results.
- [ ] Ordinary push a separate Draft PR; hand exact HEAD/CI/limits to coordinator without merging.

## Coordinator-approved discovery timeout addition

The coordinator explicitly approved a minimal selected health timeout adaptation after review.
CLI complete/review/practices checkpoint opt in through internal optional parameters. MCP
practice/complete propagate the option through their actual stdio resolver. Only the existing
live-PID timeout refusal returns its original typed error; PID/compatibility/control-file/recovery/
startup predicates and call counts stay unchanged. No new public CLI flag or retry.
MCP without a resolver preserves an actual health timeout at its existing refusal point.
Discovery abort and post-start health remain excluded; this does not migrate every transport path.
Compared with #351 commit 468df532, these functions do not overlap upgradeDaemon's changed lines.
Real CLI and official SDK stdio processes must preserve connection/lock/seeded baseline bytes,
issue only the existing health probes and never invoke a mutation or start a competing daemon.

## Verification-required CLI compatibility follow-up

The coordinator authorized validation-required corrections and a new HEAD. Two existing CLI
tests retained five assertions requiring raw flag/message echo, contradicting the approved safe
fixed messages. Both tests were independently reproduced red. Add cli.test.ts to the exact test
paths and replace only those expectations with code/reason/action, exact empty details and
no flag echo. Retain existing refusal, preflight-before-runtime and successful integration checks.
A read-only assumptions reviewer checked this patch; no production behavior changes.
The canonical contract adds a narrow compatibility check without dropping any existing check.
