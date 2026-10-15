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


Coordinator publication update: after the local hold above, the coordinator explicitly requests completing the necessary post checks and promptly delivering the exact HEAD for remote verification. All post checks and23 inspect commands are now complete and green; final typecheck passes. Proceed with ordinary same-branch push under that latest instruction, retaining the full/CLI failed attempts and unresolved intermittent W1 in the handoff and PR validation. This supersedes the earlier temporary publication hold; it does not claim local overall-governance success, classify the intermittent cause, or authorize merge/CI cancellation/manual rerun. Product inputs remain unchanged from805eed21.


## Post-79392f70 review findings

Coordinator adds automatic-review P1 discussion_r4281450751: persisted legacy manifest A then B was checked against intermediate A and falsely held pending. New fixtures persist ordered entries with a normalized path alias, close/reopen SQLite, and cover initially absent/present destinations. Pre-fix recovery file2/5 red; final7/0 green,67assertions. The preflight now selects the last postimage per normalized destination and guards every destination the existing reverse rollback may mutate, including prior creation with a missing later backup. External bytes, all backups and temps remain intact on conflict. Restoring exactly final B permits the unchanged B->A->prestate reverse unwind. Reverse-loop bytes are hash-proven identical; unknown/missing destination rules remain.

Coordinator also adds seven explicit descriptor-relative stale/EEXIST producers. Each now constructs FailureError(AC_PRECONDITION_FAILED,apply-preimage-changed,{issueCount:1}) and retains its exact original Error.message for internal diagnostics. No message inference, unknown-I/O mapping, descriptor operations, flags, locks or cleanup order changed. Public daemon docs pin and init races reproduce13/2 red ->15/0 green. The pin returns a strict refusal and preserves the racing lockfile; init throws its existing convention, cleans its own model files and preserves the racing generated destination. Whole-tree file inventories and empty journal maps verify no unauthorized persistence. An injected unknown error with the same diagnostic wording remains safe W1.

Affected whole-file command covers SQLite recovery+store, core changeset engine, final public failures, external documentation and model initialization:162pass/0fail,1178assertions,29.70s. Final typecheck,5-workspace boundary audit, production reachability and packaged CLI/native smoke all exit0; no filters/new skips/timeout increase. Product modifications are only these two confirmed findings; W1 diagnosis does not justify speculative changes.

W1 evidence: exact shared helper hash is equal to be19 except the one assertion message. A validated private canary proves boundary observation works. Isolated source snapshots use identical five workspace dependency links without install/version changes. be19 and79392f70 each pass the same12CLI steps/260child calls with zero child failures. Therefore current evidence cannot identify the intermittent underlying exception or prove change-relatedness, host load or upstream crash. Full root's2fail and CLI controls1/2fail refer to distinct observed tests, explicitly tabulated in workspace w1-failure-attribution.json. No repeated full root or whole CLI was run in this attribution phase.

Current hosted CI is still in progress, so same-branch push is held per coordinator. Governance job116387478083 was cancelled at its15min budget after the coordinator-observed11:19:03PASS/11:19:04native smoke; no assertion failure is inferred. Workflow remains unchanged; remaining-command durations and split/dedup suggestions are a separate read-only deliverable.


Final recovery edge check before commit: a trailing existing-file intent can be durable before its backup/mutation exists, leaving live A. Checking only recorded B would newly block that previously recoverable state. The added persisted intent-only pair reproduced7/2 against the initial repair, then9/0 after retaining the last rollback-relevant owned postimage when the tail has no backup. When the last B backup exists, that rollback entry is B itself, so the original P1 compares only final B. External C is refused in both initially-present/absent intent-only cases, with bytes/backups/temps retained. Reverse-loop bytes remain identical. This is bounded owned-postimage evidence, not unconditional rollback or a filesystem transaction redesign.

Final affected verification supersedes the earlier162-test intermediate result:164pass/0fail,1198assertions across the same6whole files,51.76s. Final typecheck, boundary, production and packaged checks all exit0;1477 tracked product/config/docs/test hashes are frozen. No filters/new skips/budget change or further full/CLI suite run. W1 remains unclassified; the exact failure matrix and causal limits are in workspace w1-failure-attribution.json.

Coordinator has completed the Governance budget analysis and owns the proposed independent CI adjustment pending human approval. Stop duplicate Governance research; this branch has no workflow change. Keep the current CI terminal gate before any concentrated same-branch push. Release-prep and CodeGraph upgrade remain queued.
