# Plan: #328 final recovery metadata and engine floors

> **Status**: Executing
> **Owner**: delegated Codex single implementation writer
> **Base**: 1fd88cf61e2f5ba49914680fd43ba479266720b2 (C1 + accepted main 670b7474)
> **Task Contract**: tasks/contracts/20261015-1535-issue-328-final-recovery-floors.contract.md
> **Task Review**: tasks/reviews/20261015-1535-issue-328-final-recovery-floors.review.md
> **Implementation Notes**: tasks/notes/20261015-1535-issue-328-final-recovery-floors.notes.md

## Goal and scope

The coordinator relayed explicit human approval “继续” at 2026-10-15 06:58 UTC for the final D6/C2 and D7 package. Freeze eight production source paths, one schema, two product documents and seven regression files before implementation. Exact paths and behavior live in tasks/notes/20261015-1535-issue-328-final-recovery-floors.scope.json. This exceeds eight files; there are no new services, commands, resolvers, dependencies or runtime/config migrations.

D6/C2 preserves ordinary complete committed readback metadata and the catalog code/severity/retryable/action. A dedicated closed policy permits at most 256 KiB UTF-8 JSON details, while C1 summary metadata stays at 8 KiB. Measure the final expanded receipt metadata including the longest written branch before plan/apply business writes, and guard direct applyUpdate inside its writer before ChangeSet apply. Existing session/snapshot administrative writes are not zero-write claims. Historical oversized committed receipts remain intact and return a bounded manual-only committed failure with complete lookup/apply IDs; gate before any automatic proof/restore/replay. An oversized original request ID is omitted whole with an explicit unavailable flag only when necessary. The existing source maintenance client lookup/readback flow is verified in an isolated fixture.

D7 adds optional minimumRendererVersion and minimumProtocolVersion to manifest v3, using existing archcontext.docs-renderer/vN and archcontext.projection-request/vN families. A pure compatibility check compares explicit engine versions. Missing floors remain compatible; future manifests and malformed/unsupported floors refuse. Preserve floors and unchanged no-floor serialization. Guard renderer entry plus ChangeSet actual writes, including supplied files, implicit rebuild and floors changed since planning. No command or renderer/protocol version bump.

## Data flow

    completed receipt -> dedicated bounded recovery details -> strict committed failure
    new receipt       -> worst-branch capacity guard        -> existing ChangeSet writer
    historical receipt -> capacity guard -> manual-only OR existing replay
    manifest          -> pure version/floor compatibility   -> renderer + writer recheck

Protect A/B/C1 reviewed semantics, B/#358, lifecycle/session/recovery algorithms, SQLite schema/state, RPC wire/client API, repo-harness and the Mini primary/BYOK checkout.

## Verification and rollback

Meaningful new regressions run red before product edits. Run the complete affected files, unchanged 60000 ms test budget, type/boundary, production audit and packaged CLI. Record commands, hashes and outcomes; do not call a partial/local attempt full green. One bounded semantic review cycle, with focused repair checks only for new findings. Rollback removes this task delta only, with no state migration.

C1 remains in its original worktree at 1fd88cf; wait for b824 hosted run 38694500518 to become terminal before one C1 integration push. The coordinator subsequently permits commit and branch-only ordinary push before C1 merge after verifying no full matrix trigger. No PR until C1 is merged; then align only its delta to accepted main and deliver one final cleanup PR. No stacked PR, merge, release or issue closure.

## Task Breakdown

- [x] Create independent tree; inspect authority and call chains without product edits.
- [x] Freeze exact source/behavior/test boundary under existing human approval.
- [x] Add and run meaningful red regressions.
- [x] Implement bounded recovery metadata and legacy manual-only gate.
- [x] Implement pure floors and renderer/writer enforcement.
- [x] Verify existing maintenance lookup/readback, ordinary behavior and all affected checks.
- [x] Complete one bounded semantic review; record any unresolved limitation.
- [ ] Align to accepted post-C1 main, commit, one ordinary push/PR and exact provider readback.


The existing failure-envelope policy iteration is admitted only to supply the new dedicated policy fixture; its default 8 KiB assertions remain.

## Final local acceptance

Final repair2 passes648 tests/4618 assertions across34 complete files, plus type/boundary, production reachability and packaged native/CLI smoke. Recorded inputs including product docs remain unchanged. Two independent lanes and the main writer closed two concrete P2 findings within one semantic cycle/two repair loops. No lifecycle/resolver/RPC/SQLite migration or command/dependency was added. Main/BYOK and C1 remain clean and unchanged. GitHub PR359 still reads open/unmerged at1fd88cf6 over670b7474; await accepted C1 main before alignment and the final PR; branch-only commit/push is subsequently authorized below.

## Branch-only publication authorization

The coordinator now explicitly permits committing this verified tree and ordinary-pushing its own branch if that cannot trigger a full matrix, with no PR. The three workflows are unchanged: verify.yml has push only on main; Windows ACL Diagnostics uses pull_request paths/workflow_dispatch; Organization Runner is workflow_call only. GitHub open-PR query for Ancienttwo:codex/issue-328-final-recovery-floors returns none. Therefore branch push alone has no declared full Verify trigger. No dispatch/rerun/PR is part of this publication. Current baseline/parent remains1fd88cf6, accepted main still670b7474; no base alignment now.

This finite package does not complete the RFC's universal D6 failure contract. The four direct synthetic probes and original held inventory show remaining generic writer/recovery/lifecycle exits. The coverage report is supporting workspace evidence, not a claim of whole-repository public-boundary acceptance.
