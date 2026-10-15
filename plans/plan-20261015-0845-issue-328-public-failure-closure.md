# Plan: #328 remaining public failure closure and post-write floor safety

> **Status**: Executing
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
- [ ] Ordinary commit/push; wait accepted C1 main then align and deliver one final PR.

Final local acceptance:609 passed across32 whole files (31+one complete corrected-file rerun); type/boundary/production/packaged pass. Both lanes report no remainingP1/P2. Exact closed boundary/authority/D4-adoption matrix is retained in workspace closure-matrix.json and notes. Publication gate remains C1 merge then accepted-main alignment and one final PR.
