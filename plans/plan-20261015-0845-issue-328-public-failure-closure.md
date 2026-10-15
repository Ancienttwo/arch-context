# Plan: #328 remaining public failure closure and post-write floor safety

> **Status**: Review
> **Owner**: delegated Codex sole writer
> **Base**: 386d3f8ca2725be176619baf8449d76febbc976d
> **Task Contract**: tasks/contracts/20261015-0845-issue-328-public-failure-closure.contract.md
> **Task Review**: tasks/reviews/20261015-0845-issue-328-public-failure-closure.review.md
> **Implementation Notes**: tasks/notes/20261015-0845-issue-328-public-failure-closure.notes.md

## Goal and scope

The coordinator explicitly authorizes all remaining D6 consumer-visible failures, overriding the temporary C1 lifecycle exclusions, plus the concrete post-manifest-write D7 rollback finding. This package exceeds eight source/test paths; the closed machine scope is tasks/notes/20261015-0845-issue-328-public-failure-closure.scope.json. No service, command, resolver, dependency, protocol version, success shape or credential is added. Existing main/BYOK and PR359 stay unchanged.

Use producer-declared typed refusals for deterministic input/approval/stale/authority predicates; preserve known code/action/reason and complete recovery bindings. Unknown exceptions become safe registered failures only at public exits. Keep existing return-versus-throw behavior, locks, recovery and lifecycle order. The unresolved sentinel keeps its class identity and original journals, exposes a dedicated bounded complete snapshot, and uses explicit full-readback/manual-only metadata if the whole authority exceeds the dedicated budget. Existing status/health supplies the full original journal list.

    producer predicate -> registered failure -> direct public return or throw
    unresolved journals -> bounded authority or explicit full-readback reference
    RPC transport -> existing v2 response slots -> frozen old/new cross verification

Freeze actual386d old v2 client/server before source changes. Verify both cross directions before choosing any RPC failure metadata change; preserve HTTP status and envelope/data method calling conventions. Source API success bytes and method arguments remain unchanged.

D7: reproduce floor raises during after-validation, commit callback and journal commit; prevent rollback replacing externally changed manifest bytes. Retain backup and pending journal on unsafe rollback and return a typed manual-recovery refusal; use journal's existing bodyHash to refuse the same external overwrite during startup, without changing recovery sequence. Successful commits and ordinary failure rollback retain original semantics.

## Verification

Add deterministic red regressions before edits. Run whole affected contract/core/runtime/CLI test files with60000ms unchanged budget, frozen v2 cross directions, type/boundary, production reachability and packaged CLI. Record exact commands/input hashes. One bounded semantic cycle/two independent read-only lanes with at most two repair loops for this explicitly expanded work package. Ordinary additional commits and branch-only pushes, no force or CI dispatch; align to accepted post359 main before one final PR.

## Task Breakdown

- [x] Read current state and freeze old v2 code artifacts.
- [x] Inventory ten partial C2, six lifecycle symbols and adjacent projection/write public exits.
- [x] Reproduce and repair post-write manifest rollback conflict with recovery replay guard.
- [x] Close D6 deterministic/unknown public failures and bounded unresolved authority.
- [x] Verify frozen v2 old/new compatibility before final wire choice.
- [x] Run complete scoped checks and one independent review cycle.
- [x] Ordinary implementation commit/push; merge accepted C1 main without changing verified product bytes.
- [x] Record planned 0.8.0 compatibility and existing release authorities/gates; no npm publishing.
- [x] Deliver the single final PR (#360); complete the follow-up below before the next exact-head handoff.

Final local acceptance: 609 passed across 32 whole files (31 + one complete corrected-file rerun); type/boundary/production/packaged pass. Both lanes report no remaining P1/P2. The exact boundary/authority/D4-adoption matrix is retained in workspace closure-matrix.json and notes. C1 merge and accepted-main alignment are complete; one final PR remains to be delivered.

C1 gate cleared: be19d8ec tree equals 1fd88cf6; local merge a713228c has two parents and exactly the tested ea063698 tree. Nine squash-ancestry conflicts were resolved from that verified tree equality. Release-prep checklist is preparation-only and keeps actual versions 0.7.2.

## PR360 follow-up: in-process pending recovery gate

Coordinator reports that an in-process incomplete rollback leaves a durable pending journal without refreshing the daemon startup-only cache. Reproduce J1 floor-v5 publication/external supported-v6 conflict, then prove immediate status, J2 refusal before journal begin, and restart preservation. Refresh/isolate pending authority while the original writer remains held; never run recovery during an active operation. Release-prep is paused in its clean separate worktree. The initial hold on push was superseded after the coordinator aggregated findings and confirmed the original hosted run terminal; ordinary same-branch push is authorized after the affected whole files pass. No CI cancellation, dispatch, or rerun.

- [x] Run deterministic red status/J2/restart regressions.
- [x] Repair the writer-held unresolved-authority publication boundary.
- [x] Repair confirmed CI producer/surface losses and preserve original preview diagnostics; original two review lanes rechecked with no remaining P1/P2.
- [x] Receive coordinator aggregate findings and ordinary same-branch push authorization.
- [x] Run bounded whole-file residual controls and product post/governance readbacks, retaining every failed attempt; CLI acceptance remains blocked.
- [x] Commit the follow-up locally at805eed211dc31dafe7b3a310c412cdae423192f7; coordinator latest instruction directs ordinary same-branch push for remote verification.
- [ ] Complete exact-head hosted verification and coordinator merge acceptance.

## PR360 CI follow-up

Both completed jobs have the same151 unique failures (140 RPC-table tests, 11 others). Preserve strict schemas and move legacy-message consumers to code/action/reason/facts; fix CLI/MCP typed boundary losses, stale preimage and ledger invalid-base producer escapes. No message parsing, extra RPC wire shape, CI cancellation/retry or early push. Run full affected files then full suite.

Full unfiltered follow-up attempt finished with3234 pass/3 existing skip/2 fail across275 files. The pending-journal acceptance fixture now keeps pending last, retains every refusal assertion and adds immediate/later-writer quarantine checks; its whole file passes36/0. The unmodified15s CLI freshness test passed743.09ms in the first whole-file control. That control ended111/1 with a different opaque docs-adoption refusal; one assertion-context-only edit supports a bounded second whole-file control. No full-root repeat or timeout increase. Release-prep and CodeGraph1.6.2 remain queued; no added execution scope.

Final bounded-control status: acceptance36/0; first whole CLI111/1, second110/2. Original freshness deadline passed in both controls743.09ms/735.80ms. The new intermittent refusals are docs.adopt and the shared helper signal plan; the diagnostic assertion captures registered W1 at public-operation, not an underlying cause. A diagnostic-only real shared helper passed once, then3/3 fresh fixtures in one process; these do not count as test acceptance or prove dependency/load attribution. No further full/root repetition or CodeGraph change. Existing verify:post and all23 governance inspect commands pass individually (no skip); the original overall governance command remains exit1. Freeze includes1477 exact inputs with no drift. Remaining CLI gate prevents push/merge; retain one local reviewable commit and report the blocker to the coordinator.


Coordinator publication update: after the local hold above, the coordinator explicitly requests completing the necessary post checks and promptly delivering the exact HEAD for remote verification. All post checks and23 inspect commands are now complete and green; final typecheck passes. Proceed with ordinary same-branch push under that latest instruction, retaining the full/CLI failed attempts and unresolved intermittent W1 in the handoff and PR validation. This supersedes the earlier temporary publication hold; it does not claim local overall-governance success, classify the intermittent cause, or authorize merge/CI cancellation/manual rerun. Product inputs remain unchanged from805eed21.


## Coordinator follow-up: legacy duplicate manifest recovery and W1 attribution

Explicit same-writer authorization adds automatic-review P1 discussion_r4281450751: a persisted legacy journal may create manifest A then replace it with B. Recovery must compare the live destination to only that normalized destination's final postimage, then retain the existing reverse rollback. Cover first-created and preexisting destinations, aliases, real external conflict preservation and missing later backup; do not restore unconditional rollback. Run deterministic persisted close/reopen red before product repair and whole affected SQLite recovery files after. Continue W1 only with isolated diagnostic fixtures and a be19d8ec source snapshot; do not seek green by repeating the full root/CLI file. Wait for current CI38724679198 terminal before the next concentrated ordinary push. No CodeGraph upgrade writes or new review fleet.

- [x] Reproduce legacy duplicate manifest journal from persisted SQLite (2 pass/5 fail before repair).
- [x] Guard the final postimage per normalized destination while preserving byte-identical reverse rollback and external conflicts (7/0).
- [x] Verify both new fixes across6whole files162/0; preserve inconclusive W1 attribution with exact be19/current paired evidence.
- [ ] Wait current CI terminal, then concentrate any authorized same-branch publication.


Descriptor producer closure: seven explicit stale/EEXIST branches now construct the registered apply-preimage-changed refusal while retaining exact original local diagnostics. Real daemon pin/init tests reproduce13/2 red ->15/0 green; an unknown-I/O lookalike message stays unclassified and no business journal is created. Complete six-file verification passes162tests/1178assertions; type/boundary/production/packaged checks all pass. No lock, dependency, schema or workflow change.

W1 attribution is bounded and inconclusive: shared helper body equals be19 after removing the added assertion diagnostic; same-dependency isolated be19/current sequences each complete12steps/260child executions without failures. The observed full2fail versus CLI1/2fail sets are retained in w1-failure-attribution.json; no product/upstream/load cause is inferred. The two newly fixed findings are independently confirmed, not relabeled as the W1 cause.

Governance job116387478083 reached its15min job boundary, with no assertion failure reported by the coordinator, after verdictPASS and packaged-native smoke. Treat as budget/cancellation evidence, not an assertion regression. Prepare existing remaining-command timings and a bounded split/dedup proposal only; do not change workflow or timeout. Current CI38724679198 still has running sibling legs, so next push remains held.


Final recovery edge check before commit: a trailing existing-file intent can be durable before its backup/mutation exists, leaving live A. Checking only recorded B would newly block that previously recoverable state. The added persisted intent-only pair reproduced7/2 against the initial repair, then9/0 after retaining the last rollback-relevant owned postimage when the tail has no backup. When the last B backup exists, that rollback entry is B itself, so the original P1 compares only final B. External C is refused in both initially-present/absent intent-only cases, with bytes/backups/temps retained. Reverse-loop bytes remain identical. This is bounded owned-postimage evidence, not unconditional rollback or a filesystem transaction redesign.

Final affected verification supersedes the earlier162-test intermediate result:164pass/0fail,1198assertions across the same6whole files,51.76s. Final typecheck, boundary, production and packaged checks all exit0;1477 tracked product/config/docs/test hashes are frozen. No filters/new skips/budget change or further full/CLI suite run. W1 remains unclassified; the exact failure matrix and causal limits are in workspace w1-failure-attribution.json.

Coordinator has completed the Governance budget analysis and owns the proposed independent CI adjustment pending human approval. Stop duplicate Governance research; this branch has no workflow change. Keep the current CI terminal gate before any concentrated same-branch push. Release-prep and CodeGraph upgrade remain queued.
