# Notes: #328 final recovery metadata and engine floors

## Baseline and authorization

Independent worktree /private/tmp/worktrees/arch-context-328-final-recovery-floors, branch codex/issue-328-final-recovery-floors, clean starting HEAD 1fd88cf61e2f5ba49914680fd43ba479266720b2. The coordinator relayed human approval “继续” (2026-10-15 06:58 UTC). Single implementation owner. Primary/BYOK/A/B/C1 preserved. Dependencies installed offline/frozen without lifecycle scripts; no tracked installation change.

## Producer evidence

- projection-service applyProjectionProtocolFixedPoint completes identity/result/recovery receipt before daemon.planUpdate.
- changeset-authority applyAuthorizedUpdate performs committed lookup under writer before ChangeSet apply; recordReceipt inside afterModelValidatedBeforeCommit is too late for capacity enforcement.
- accepted-change duplicate and same-request exact replay currently proveOrRestore before response; capacity gate must precede those calls.
- source maintenance client exposes inspectProjectionApplyReceipt(root, lookupKey) and readbackProjectionApply(root, fullRequest); compare returned identity.applyId before deriving the request. These calls do not deliver pending refresh signals.
- core renderer treats unrecognized future manifest as absent today; ChangeSet supplied projectionFiles bypass renderer and implicit rebuild happens after other operation writes.
- existing openSession writes administrative snapshots/session state. Tests distinguish them from business journal/receipt/ledger/files; lifecycle stays unchanged.

## Verification evidence

Pending implementation. No production edit or final-package test has run at freeze time.


## C1 delivery checkpoint

The separate C1 tree was verified clean at 1fd88cf61e2f5ba49914680fd43ba479266720b2. Parent opened the push window after old run38694500518 completed/success. One ordinary push advanced b824f402..1fd88cf6; GitHub PR359 reads exact head1fd88cf and base670b7474. New Verify38701008450 is in_progress, not accepted. C1 contains none of this final package. Delivery record: /Users/kito/Documents/Codex/2026-10-14/task/c1-main670-delivery.json.

## Incomplete final-package implementation checkpoint

The first two whole regression files ran on unchanged product code: 5 pass/5 fail (red). New writer regression file then ran before writer changes: 0 pass/3 fail (red). Contract recovery plus existing failure policy tests pass22 cases/727 assertions. Dedicated recovery policies, ordinary/full and historical/manual-only helpers, new-receipt guards and all three historical replay/refusal gates are implemented locally; final acceptance remains pending. Pure floor checker/schema/render preservation started. The latest renderer correction places floors on manifestValue and moves compatibility before semantic compilation. Writer implementation has NOT been applied: the edit script stopped at an assertion before writing changeset-engine. Its three new red tests remain red. Typecheck last reported only test narrowing errors in the new projection-recovery file; those fixes have not yet been applied. Do not treat these partial results as acceptance or push this final branch.

Next: implement writer compatibility callbacks before journal and immediately after async record-before-files, preserving live floors in supplied manifests; fix new test narrowing; add pure floor/budget threshold/direct-apply/maintenance-client/legacy-auto-refusal regressions; complete all agreed checks, bounded review and product docs. Wait for C1 merge, align only final task delta onto accepted main, then one final PR.

## Implemented candidate before final verification

Eight source paths, schema, two product docs and seven test paths now implement the frozen package. Exact UTF-8 -1/exact/+1 threshold and written true/false/absent cases pass. The complete protocol file, including real source maintenance RPC lookup/readback over two historical oversized receipts (recorded and unrecorded digest), passes during development; direct guard fixtures were repaired to recompute receiptDigest without including the previous digest and now pass. An additional adopt witness passes for explicit and observed acceptance with the initial request below 256 KiB but expanded metadata above it. Final verification is whole-file/directory without name filtering, with the existing timeout budget. It additionally includes complete contracts.test and all pure projection-engine tests because the shared manifest schema/renderer changed.

## Independent review and bounded repairs

Two independent read-only lanes returned two concrete P2 findings. Path alias guards were reproduced red (writer 2pass/2fail), repaired with one normalized destination helper and verified (four full ChangeSet files60pass302assertions; same34-file group646pass4584assertions plus type/audits/package). The second manifest-first rollback/floor race was reproduced red (writer4pass2fail), repaired by globally deferring a single manifest across supplied, ordinary and implicit file writes, and verified (four complete ChangeSet files62pass336assertions). The architecture lane closed both repairs by final source/test readback in the same review cycle. The final group is running with unchanged budgets and no name filters. Only the allowed engine/writer-test/spec paths changed in this second repair; no rollback, session, resolver, RPC or SQLite implementation was altered.

## Final local acceptance and remaining gate

Final repair2:648pass/0fail/4618assertions across34 complete files,173.18s. Type+5-workspace boundary0.77s, production audit0.30s, packaged native/CLI17.49s; every recorded source/test/config/schema/product-document hash unchanged. No name filters, added skips or timeout increases in final checks. The earlier development fixture digest issue was corrected in tests; actual direct writer refusals and administrative snapshot effects are asserted. Final explicit/observed apply/adopt requests remain below256KiB initially but exceed it after full receipt/readback expansion and stop before business plan. Legacy recorded/unrecorded oversized receipts reject exact/different/new-accepted request paths before automatic proof/restore; real RPC source-client inspect/readback returns the original full receipt and preserves pending delivery.

Primary main remains clean at e23ed5dafd492c79e2217f6793eacd9b66187bab. C1 remains clean at1fd88cf61e2f5ba49914680fd43ba479266720b2; this package did not modify it or operate CI. Provider readback shows PR359 open/unmerged, base670b7474. No commit, push or final PR has occurred. The coordinator owns C1 CI/retry and merge. Once merged, align only this delta to accepted main, prove content/verification-input preservation, then commit and one ordinary push/final PR.

## Publication and D6 closure audit

Latest coordinator authorization admits local commit and branch-only push before C1 merge after verifying no full matrix trigger, with no PR. All three workflows were read: Verify push is restricted to main; ACL diagnostics is PR/manual; Organization Runner is workflow_call. The target branch has no open PR. This branch push cannot start the repo-defined full Verify workflow. No CI operation or PR is authorized here.

RFC328 section6 says every failure carries code/action/reasonCode/bounded details. This package does not meet that universal claim. Direct synthetic probes on final product source show applyUpdate(approved:false) returns code/action without reasonCode/details; an approved unknown draft throws raw Error; projectionFailureEnvelope on an unknown error retains its message and lacks reasonCode/details; publicOperationFailure rethrows the original unresolved-recovery sentinel without a strict failure. RPC maps that sentinel to a legacy precondition envelope with raw message and no reason/details.

The original C1 inventory still explicitly holds ten partial C2 boundaries (acceptCommittedChange; ledgerProject/Migrate/Rollback/Rebuild; recommendations; refactorRecord/Verify; auditApprove; docs approved pin-recovery sentinel) and six lifecycle symbols (ArchctxDaemon constructor/start/stop/openSession, createStartedDaemon, createStartedProductionDaemon). Their selected local refusals have C1 coverage; their full returned legacy/recovery/lifecycle paths are not globally normalized by this package. The direct apply/projection counterexamples alone falsify closing all D6. Current648 tests cover34 affected files only, not every public boundary or the full RFC. No new resolver, generic gateway sweep or lifecycle rewrite was added to hide the residual scope.
