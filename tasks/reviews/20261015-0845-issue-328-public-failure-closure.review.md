# Review: remaining public failure closure

## Scope and result

One semantic cycle, two read-only independent lanes, at most two repair loops for the explicitly expanded D6 package. Prior finite receipt/floors review remains historical and is not relabeled. Root is the only writer.

The coordinator's post-manifest-await rollback finding reproduced red and was repaired. Lane d6_wire_lifecycle found first-created-manifest startup deletion and prepublication absence misclassification; both reproduced red and were independently closed after repair. Lane d6_remaining_inventory found docs.pin authority loss, recovery metadata getter escape and MCP stale snapshot classification loss; all three reproduced red and were independently closed after repair. An obsolete field reread was removed after the producer became a FailureError; its zero-getter regression passes. No remaining P1/P2 was reported.

Lifecycle acquisition/recovery/cleanup sequence and exception precedence remain intact. Complete original journal references and fitting metadata remain; oversized authority uses explicit whole-readback digest/count. Frozen actual386d old/new v2 compatibility passed, no extra wire field/version. Four data methods remain throws and426 upgrade authority remains complete.

## Verification evidence

609 passed across32 whole files, assembled as31files/524passing tests plus an85/85 entire local-runtime rerun after its last legacy string-error assertion changed to code/reason/full-id. Product/config/product-doc hashes stayed fixed. Raw failed attempt is not claimed green. Typecheck,5workspace boundary, production reachability and packaged native/CLI smoke pass. No filters/new skips/timeout increase or hosted CI retrigger. Workspace verification-final.json, final-inputs.json, verified-test-records.json and closure-matrix.json retain exact provenance.

## Delivery gate

Local implementation accepted; ordinary branch-only publication authorized. PR359 merge and accepted-main alignment precede the single final PR. No issue closure or merge is authorized in this local acceptance step.


## PR360 follow-up recheck

The original d6_wire_lifecycle lane rechecked same-process pending authority, dirty-read fail-closed handling, lock/exception precedence and startup recovery ordering. The original d6_remaining_inventory lane rechecked CLI/MCP preservation, producer typing, strict consumer fixtures and local preview diagnostics. Both closed their findings with no remaining P1/P2; no new independent review cycle or writer was started.

The full follow-up attempt is retained as3234/3skip/2fail, exit1. Whole-file residual controls and existing post/readback checks are in progress; no green overall-governance claim or merge approval is inferred. The coordinator explicitly authorizes ordinary same-branch commit/push once affected whole files pass and confirms the old hosted CI is terminal. No CI cancellation, manual rerun/dispatch or timeout increase is authorized.


## Final follow-up verification and remaining gate

The two complete CLI controls ended111/1 at10:49:22Z (271.23s) and110/2 at10:55:02Z (316.04s). The original unchanged freshness deadline passed743.09ms and735.80ms. New failures are intermittent refusals in runAdoptedHookAdaptersScenario: docs.adopt (generated present first control; generated missing second) and signalPlan before the RPC runtime-churn case. The only captured failure result is strict AC_UNCLASSIFIED_FAILURE/failure-unclassified, stage public-operation. Its original exception is not available from the public envelope; no claim of load/upstream cause is made.

A temporary ignored operations script reused the real shared helper with boundary observers delegating to frozen original functions. An initial probe import error is retained as diagnostic scaffolding failure, then the corrected fixture passed, followed by a bounded3/3 fresh fixtures in one process. No underlying exception was captured. This is diagnosis only, not an accepted-test substitute. No product source, timeout, skip, dependency, global process/network setting or public logging changed to hide the failure.

Existing bun run verify:post passes separately, and all23 unchanged governance inspect commands extracted from the original script pass individually with zero skips. Original verify:governance remains exit1. Final typecheck is recorded separately. All1477 frozen product/config/docs/test inputs match the v3 snapshot; the only changes since the full run are the acceptance fixture order/quarantine assertions and one CLI assertion message. No assembled all-passing corpus is claimed.

Implementation and honest failed-check evidence are retained in a local reviewable commit. Ordinary same-branch push is authorized after affected whole files pass, but the CLI condition is not met; remote remains12f6f6a6 and no new CI is triggered. Coordinator disposition of this unclassified residual is needed before publication, or further scoped root-cause work. No merge/issue closure. Release-prep and CodeGraph candidate remain clean/queued. Read-only latest primary observation is clean be19d8ec (changed externally since the earlier snapshot); this task did not update it. C1 and release-prep remain clean at their recorded heads.
