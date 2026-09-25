# Implementation Notes: remaining-audit-issues

Status: Draft PR #223 published; approved continuation reproduced and corrected the Windows first-create child timeout. Bounded Windows verification passes; umbrella issues and whole-work-package acceptance remain incomplete.
Plan: `plans/plan-20260925-1345-remaining-audit-issues.md`.
Research/disposition: `docs/researches/20260925-remaining-audit-issues.md`.

## Implemented

- Locally integrated `ad11f03`, `fd61feb`, `df3f8fc` in dependency order. Preserved main's Developer Review and Explorer imports while resolving the import-block conflict. No upstream PR refs were modified.
- Explorer query-token rejection and port-scoped browser session with Bearer HTML/SSE requests. Runbook: `docs/runbooks/explorer-browser-auth.md`.
- Scripts owner node applied through `scripts/apply-model-proposal.ts`, exact proposal digest `sha256:20f4f11de9a95d8e7986c5b9046b7095f89a9b1fa6d1b8fac31c780a4fd5b82f`. Receipts: `_ops/remaining-issues/scripts-owner-preview.json` and `scripts-owner-applied.json`. An existing daemon held the worktree writer lock; it was stopped with the normal CLI daemon-stop command before preview/apply. No runtime files were manually changed.
- Cloud-delivery milestone recorded in the deferred-goal ledger; #162's already-delivered local truthfulness was not reimplemented.

## Root cause and review

The original `isExplorerAuthorized` accepted URL query credentials, and the renderer copied them into EventSource. Under pinned Bun 1.4.0 the new regression failed before the fix: `/health?token=...` returned 200, expected 401.

Initial cookie design was rejected during the single auth-boundary review: cookies do not isolate ports. The revised implementation removes cookies and the exchange endpoint entirely. The reviewer closed both findings after reading the revised source and independently recomputing the real-browser source fingerprint. This is a local auth review, not a harness provider-owned acceptance receipt or whole-issue closure.

## Verification evidence

- Final Explorer API/server/renderer tests: 17 pass, 0 fail, 252 assertions; typecheck and package boundaries pass.
- Existing integration slices: 21 targeted jobs/docs/hook/session tests passed; auth-only tests subsequently changed and reran in the final Explorer set.
- Privacy-route and production-mock reachability audits pass. Explorer compiler readback passes its configured renderer/budget/privacy gates.
- Real Chrome `154.0.8037.57`: `_ops/remaining-issues/browser-auth.log`, PASS with 6 real projection reads. Auth-source fingerprint `f8486f037049e72e7d3ae6b3322e7014aa8450797220465d2ea7c7bc5b7c870c`. Covers history clearing, no cookies, navigation/reload, SSE invalidation, sibling loopback isolation, revocation and expiry.
- Earlier full verify was intentionally terminated after the cookie finding; `_ops/remaining-issues/verify.log` is NOT passing evidence. Final frozen-source verification is recorded separately in `_ops/remaining-issues/verify-final.log` after it finishes.

## Remaining scope

#164 composition-only facade work remains (currently 4241 lines); #171 Windows ACL, supported manifest configuration mutation, effective egress admission/network isolation and historical readback archival remain. These are open implementation scopes, not passing gates. No commit/push/merge/issue closure/release/deployment is claimed.

## Verification stop boundary

The frozen-source `bun run verify` reached two 30-second timeouts in unchanged tests:

1. `tests/ownership-change-acceptance-recovery.test.ts:187`: raced accepted semantic recovery.
2. `packages/surfaces/cli/test/cli.test.ts:4674`: projection adoption composing an accepted semantic change.

Both reported `AC_PRECONDITION_FAILED` from the CodeGraph `npm-shim.js --version` handshake. A separate version probe returned 1.5.0 after the first failure; that is not evidence that either failed test passes. The root cause is unproven. No timeout or assertion was changed. The second out-of-scope failure activates the user AGENTS hard-stop rule: no further fixes or isolated reruns; retain the current run's final result and await direction. The `&&` verification pipeline cannot execute its post-test stages after a failed suite. No full verify PASS or acceptance receipt is claimed.

Windows follow-up is independently confirmed: `daemon-control.ts:148` bypasses ACL validation on win32, and `scripts/platform-ipc-permission-readback.mjs:137` emits a fixed ACL label. A sufficient bounded fix needs ACL setup before writing credentials, actual ACL inspection on reads, a broad-principal negative test, and real Windows matrix evidence. macOS testing cannot establish that boundary.

Final run disposition: stopped the identity-checked owned `bun test --timeout 60000` process with SIGTERM after the second failure; `bun run verify` exited 143. The log is partial and contains no complete-suite totals. No isolated rerun was started. The worktree daemon spawned by verification was stopped through `archctx daemon stop` (`ok: true`), not by editing runtime state. The Obsidian canonical project note received authority pointers only; the user-provided vault takes precedence over the different historical `brainRoot` configuration.

## Remaining facade inventory

Read-only inventory confirms `book` (:1638), recommendations (:1806), refactor orchestration (:2008), Explorer projection/cache (:2789), checkpoint (:1085), practice waiver (:1213), completeTask (:1322), ChangeSet/MCP approvals (:1282/:1421/:1455/:1503), ledger context (:2419/:2471), and repository/session lifecycle (:2655/:3211) remain in `runtime-daemon/src/index.ts`. Shared writer/feed boundaries at :3352/:3363/:3393 and cross-feature tests mean further extraction needs parity work, not a file-size-only split. No additional extraction was started after the stop boundary.

## Approved timeout repair

Owner approved continuing the two CodeGraph timeout diagnoses. P1/P2/P3 and command timing evidence: `docs/researches/20260925-codegraph-test-deadline.md`.

- root_cause: two real-CodeGraph multi-stage integration scenarios use the 30-second generic test budget; Bun expires the whole test and terminates its active child, which the adapter reports as a handshake failure. The isolated adoption trace records a SIGTERM after only 389 ms of a 10-second status call at the outer deadline.
- repro: pinned Bun `bun test tests/ownership-change-acceptance-recovery.test.ts --test-name-pattern 'semantic recovery delivers'`; and `bun test --preload ./_ops/remaining-issues/trace-codegraph.cjs packages/surfaces/cli/test/cli.test.ts --test-name-pattern 'projection adopt composes ownership adoption'` with `ARCHCTX_DIAGNOSTIC_TRACE` pointing at the ignored trace artifact.
- regression_guard: the two existing scenarios, preserving every test-body byte and assertion. Source comparison against HEAD proves only the intended timeout declarations/arguments changed.
- pre_fix_failure_artifact: `_ops/remaining-issues/recovery-isolated.log` (exit 1, 30.035 s) and `adopt-isolated.log` (exit 1, 30.025 s), plus `adopt-trace.jsonl`.
- fix: select the existing real-CodeGraph projection budget (120 seconds on macOS/Linux; Windows remains 240). The unrelated recovery negative test retains its original deadline. No product timeout or behavior changed.

The diagnostic recovery copy passed 43 assertions in 64.881 s; all 71 traced calls succeeded. That temporary `.test.ts` was renamed to an ignored `.fixture.txt` before final validation, so it cannot become an extra discovered test. Final focused validation uses the normal runner without the diagnostic preload.

Final bounded result: 3 tests passed, 0 failed, 68 assertions under Bun 1.4.0; exit 0. Durations: recovery 66.357 s, unavailable-proof negative 9.380 s, CLI adoption 46.279 s. Evidence: `_ops/remaining-issues/codegraph-deadline-fixed.log` and `codegraph-deadline-subject.json`. `git diff --check` passes. No full matrix rerun, remote action or whole-issue closure. The Obsidian canonical project note links the diagnosis.

## Windows ACL continuation

Owner approved implementing the Windows control-file ACL boundary. Source, P1/P2/P3, regression and remaining native gate: `docs/researches/20260925-windows-control-file-acl.md`. Local results: 25 tests pass, 1 Windows-only skip, 168 assertions; typecheck, boundaries, packaged smoke and macOS installed-bin IPC readback pass. Native Windows acceptance remains blocked. Historical FG6 evidence is correctly rejected by the strengthened gate (four missing-evidence findings), so Governance must not be reported green. Model owner/relations were applied through the recorded ChangeSet. The broad original issues remain incomplete.

## Candidate publication and Windows hosted attempt 1

Draft PR: https://github.com/Ancienttwo/arch-context/pull/223 . Published head `7136c6a`; upstream extraction ancestry retained with a tree-identical merge. Hosted run `36105876838` has six passing Linux/macOS jobs, Governance blocked by historical FG6 evidence, and all Windows jobs cancelled at the 20-minute limit. Windows negative fixtures failed native module autoload; stale/idle CLI fixtures also failed. No native acceptance, whole-CI pass, merge, issue closure or release is claimed.

The first bounded correction and its P1/P2/P3 are recorded in the plan and Windows research note. Local focused tests and typecheck pass; corrected Windows verification remains pending. No historical evidence was rewritten as passing.

## Final hosted disposition

Candidate `7b16ec6`, Draft PR #223, remains blocked. Previous subject `61b01b2` produced verified native Windows ACL artifacts on all three Node versions; all six Linux/macOS full jobs and Windows/Node 25 full job passed. Windows/Node 24 passed 2029 tests but hit the whole-job cap afterward; Node 22 hit it during late E2E. The final workflow-budget correction then exposed an intermittent first-create native operation failure on Windows/Node 24 at 10024.63 ms (run `36110137854`, job `107991495231`); other 14 focused cases passed. The fixed subprocess error prevents a confirmed cause. Repair cap reached: no further source change/retry; remaining run cancelled. Evidence is subject-bound in `docs/verification/20260925-windows-control-file-acl.json`; historical FG6 remains unpromoted. No merge, issue closure, release, provider acceptance receipt or whole-plan completion.

## Approved native diagnostics

Owner approved the bounded first-create diagnosis. New failure metadata is an allowlist of safe scalar values; no raw child-process data or cause is retained. Existing creation regression now observes first-create elapsed/completion. Diagnostic workflow: three fresh Windows/Node 24 jobs, one existing test each; no full matrix rerun intended. Local red/green and privacy sentinel guards pass; root cause and hosted results remain pending. Product deadlines and ACL semantics are unchanged.

## Native diagnostic conclusion

The approved continuation reproduced `ETIMEDOUT`/`SIGTERM` at 10252 ms on subject `86e2e7d`; peer samples succeeded at 3395/9885 ms. The fixed 10000 ms child deadline was too short for observed first creation. Only native create now uses 30000 ms, within the existing 150000 ms Windows daemon-start budget; read remains 10000 ms, ACL and credential semantics unchanged. Safe failure metadata omits cause, commands, paths, input and raw child output.

Subject `c6f7335` passed three fresh Windows/Node 24 creation cases and installed-bin private-ACL/redaction/start/status/stop readback. Typecheck, package boundaries and local diagnostic privacy tests pass. Exact evidence: `docs/verification/20260925-windows-first-create-diagnostics.json`. The OS subsystem responsible for variable startup cost is not identified; no full-matrix/Governance acceptance is claimed. Historical stop/run records remain historical evidence, superseded for this particular deadline finding by the approved diagnostic conclusion.

## FG6 conclusion authority and frozen matrix closeout

- Root cause: `extractHostedCiEvidence` interpreted the FG1 sentence “PASS for all nine matrix jobs” as whole-run PASS; the inspector trusted that aggregate without any job records. Pre-fix failed-job guard: 3 pass / 1 fail, exit 1, `_ops/remaining-issues/fg6-conclusion-red.log`.
- Correction: v2 structured GitHub REST run/jobs source, exact nine job names/IDs/head/run/attempt/completed-success checks, independent workflow conclusion, no Markdown/v1/legacy-matrix fallback. POSIX and Windows proof both come from artifacts.
- Validation: 10 focused tests / 40 assertions; typecheck. Frozen candidate `8f87777`, Verify `36117123203`: 9/9 full matrix success; 9 actual v2 artifacts, three measured Windows ACL proofs. GitHub archive digests, payload digests and identical candidate/CI-merge trees verified.
- Governance: hosted ordinary Verify passed 2036 tests, then old FG6 evidence failed. The new recording keeps workflow failure explicit and passes its inspection. Other 22 evidence commands passed locally. No new remote Governance PASS or full latest-head CI is claimed.
- Source and durable evidence: `docs/researches/20260925-fg6-matrix-conclusions.md`, `docs/verification/fg6-platform-workflow-matrix-readback.json`, `docs/verification/20260925-fg6-hosted-matrix-artifacts.json`. Final edits are records only; no expensive matrix rerun.
- Read-only architecture queue checkpoint: one pending advisory item remains; unrelated architecture projection work was not changed.
- Draft PR #223 remains open. Remaining #164 facade extraction and #171 manifest/egress work, optional #162 cloud milestone, and full work-package acceptance remain outside this completed FG6 slice.

## Independent hosted Governance completion

P1: existing Verify workflow owns Governance plus the matrix; the canonical Governance command remains unchanged. P2: a record-only follow-up cannot repair the old failed job through rerun because that job uses the old checkout. P3: a manual event runs only Governance with event-isolated concurrency, while PR/main events preserve every matrix target and read-only permissions.

- Workflow routing regression: before change 5 pass / 1 fail; after change combined routing/FG6 tests 16 pass / 92 assertions. Typecheck passed.
- Published candidate `405d6ca1bec1fe6ec603e9eb11ff9c7cc49e5ec8`; manual run `36122160055` and Governance job `108029917724` completed successfully in 5m40s. Matrix was skipped with no steps executed.
- Hosted Verify: 2037 pass / 2 platform skips / 0 fail. Canonical Governance summary: 24 executed commands, zero skipped commands, all successful; includes the 23 evidence inspections.
- Verified exact head/run/attempt, checkout SHA, GitHub job conclusion and downloaded log SHA-256. Durable record: `docs/verification/20260925-governance-revalidation.json`; operator procedure: `docs/runbooks/governance-revalidation.md`.
- The previous full nine-platform result remains on `8f87777`; differences through this candidate are only workflow routing, its tests and records. This manual run does not replace FG6 matrix evidence. Original failed workflow history remains truthful.
- Final follow-up changes records only and skips automatic CI. Draft #223, #162/#164/#171 remaining scope and formal acceptance are unchanged; no merge, release, deployment or issue closure.

## Approved manifest configuration contract

P1/P2/P3 and operator usage are recorded in `docs/researches/20260925-manifest-content-paths.md`. The new `update_manifest_fields` operation grants only the fixed manifest path and `content.decisions = docs/adr`, requires an existing-file hash, rejects mixed drafts and bypass payloads, and leaves projections untouched. Shared CLI/MCP/runtime schema, durable journal vocabulary and hashed ledger metadata use the existing daemon approval/writer boundaries.

Pre-fix regression: `_ops/remaining-issues/manifest-red.log` rejected manifest preview as outside the generic allowlist. Final focused validation: 21 tests / 140 assertions / 0 failures, including real RPC, dual-ledger append and single-use MCP approval. Typecheck, package boundaries and diff checks pass. During development, the non-exported schema type import and an error-message assertion were corrected; neither changes the product contract.

Production CLI plan/apply succeeded under `changeset.manifest-decisions-171` (digest `sha256:af2c4bc6e9a71bb5ab2ea4fa8322c5c163e21313c338a9fe71620c8eaeeffa2b`). Git diff is exactly one manifest scalar. Actual runtime mode is YAML, with no ledger promotion; dual mode was checked in isolated integration fixtures. Evidence: `docs/verification/20260925-manifest-fields-readback.json`. The worktree daemon was stopped through `archctx daemon stop`. Main was fetched and remains `e3d807759e917b26c539f25c51edc31946feb740` before candidate freeze. Whole issues #162/#164/#171 and Draft PR acceptance remain open.

Developer-requested security scan returned two existing unmanaged Herdr SessionStart hook warnings, no fail/high findings; architecture queue reported one advisory pending job. These are recorded without changing host hooks or processing the unrelated architecture queue.

Manifest hosted closeout: source `57664d58b90abcc69e8c5f71c43a93ace5dcd2e3`, base `e3d807759e917b26c539f25c51edc31946feb740`, Verify run `36125127163` completed successfully with all ten jobs passing. Every full suite ran 2060 tests, zero failures; Linux/Governance report 2058 pass and 2 platform skips, macOS/Windows 2059 pass and 1 platform skip. Governance ran all 24 canonical commands with 0 skipped inspections. Its job log confirms merge `3204b426fb88267114b3cb0d8b0e08c3e98afe3b`; merge and candidate trees match `4321daf4f3b7f6cc9297601c2c2d802a230c4843`. Nine downloaded archive digests match GitHub and their payloads pass the existing FG6 verifier, including actual Windows owner-only ACL and broad-read rejection. Exact job IDs, hashes and results: `docs/verification/20260925-manifest-hosted-ci.json`. Duplicate diagnostic run `36125127252` was cancelled because the full matrix executes the same native boundary tests. Earlier FG6/Governance records retain their historical subjects. Final publication is records-only with `[skip ci]`; no repeated full matrix or additional scope was started. The Obsidian canonical project pointer now references this bounded contract and readbacks.


## Local egress continuation: implementation and local proof

P1/P2/P3: `docs/researches/20260925-local-egress-admission.md`. One shared deny policy now gates actual Context7/npm/Claude/gh boundaries and explicit CodeGraph telemetry; existing feature consent remains mandatory. CLI and daemon policy are reported separately. Cached local documentation remains available; denied prepare auto-fetch retains its existing advisory behavior.

Pre-fix Context7 transport guard failed (one request reached the fixture, exit 1); the repaired guard rejects before transport side effects. Focused related suites: 111 pass / 0 fail / 643 assertions. Typecheck and package boundaries pass. Final macOS kernel-isolated first experience passed with direct and descendant IPv4/IPv6 `EPERM`, positive loopback and full task/review lifecycle; canonical FG6 v2 record regenerated from this actual execution. An unisolated probe failed. Linux CI has a dedicated namespace proof step; no Linux result is claimed before execution. Architecture queue remains one advisory pending item; no unrelated queue work was performed.

Candidate publication and current-source hosted verification remain pending at this checkpoint. No merge, release, provider call or umbrella issue closure.


## Egress verification stop (current checkpoint)

Runtime implementation and macOS kernel-isolated E2E are complete locally; publication is held. The broader CLI/workflow run finished after 664.60 seconds with 92 pass / 2 fail / 1 error (94 tests, 1507 assertions). `projection apply over real RPC ignores concurrent .ai/harness runtime churn` failed during shared fixture preparation at CLI test line 4448 (`unresolvedProtocol.ok === false`, underlying envelope absent). `projection CLI and MCP share RPC results and single-use request-bound write approval` exceeded the 120000 ms outer deadline; a subsequent unhandled line-5087 assertion expected one successful concurrent result and observed zero.

These are outside the named egress behavior; their causal relationship to this candidate is unproven. They are not labelled known flakes, existing baseline failures or egress regressions without evidence. No projection source/test fix or timeout increase was made. Per the user AGENTS second-out-of-scope-fault hard stop, the pending isolated rerun was interrupted (exit 130, no verdict), no full CI was launched and the work remains uncommitted in the isolated worktree. The 111 related tests, typecheck, package boundaries, architecture Mermaid and actual macOS FG6 proof passed. Linux kernel execution and current-source hosted checks remain unverified.

Exact WIP source hashes, log digests, results and stop boundary: `docs/verification/20260925-egress-local-checkpoint.json`. Next bounded diagnosis is the two projection/RPC failures: capture the typed failure envelopes and child/outer deadlines on this same source before changing any product behavior. Do not repeat a full matrix until that blocker is understood.


## Approved projection/RPC diagnosis outcome

Source fingerprints matched the prior stop. The churn case passed at 116.486s under its unchanged 120s budget, then passed at 109.124s in normal verification. Its original false envelope is not reproduced or explained; the assertion now retains the returned error and no product fix is claimed for it.

The parity case reproduced the 120s outer timeout: Bun killed `--version` after 738ms, well before its own 5000ms limit. An observational longer-budget run completed all 61 assertions in 129.938s; all 111 child commands succeeded, consuming 123.816s cumulatively (max 1.666s). Only this test now uses its existing Windows 240s allowance on all platforms. Product RPC/subprocess deadlines, one-time approval and receipt semantics are unchanged. Final uninstrumented verification: 2 pass / 0 fail / 95 assertions, 239.57s; typecheck passes. Exact diagnosis, source/log hashes: `docs/verification/20260925-projection-rpc-diagnosis.json`; P1/P2/P3: `docs/researches/20260925-projection-rpc-deadline.md`.

The previous failed aggregate run remains failed. These current named checks clear the observed parity deadline blocker, without retroactively explaining the historical churn envelope. Existing authorization permits frozen Draft publication and full current-source CI; the original stop and interrupted rerun remain historical.


## Egress candidate hosted closeout

Frozen source `5117abd2a98a5fdaeaab744d79b2386e1cd5037c`, base `e3d807759e917b26c539f25c51edc31946feb740`, Verify run `36138457129` passed all ten jobs. Every full suite executed 2072 tests with zero failures: Linux/Governance 2070 pass / 2 platform skips; macOS/Windows 2071 pass / 1 platform skip. Both diagnosed projection cases passed in every job. Governance executed all 24 commands with no skipped inspections. Longest job: 25 minutes.

CI merge `9e26ccd31a753e28bd250ab6673a5d0d8562f203` has the same tree as the frozen candidate. Ten downloaded archives match GitHub digests; all nine installed-bin IPC/native-permission payloads pass the existing FG6 inspector. Actual Ubuntu/Node 22 kernel proof reports a distinct namespace with only loopback, IPv4/IPv6 direct and child `ENETUNREACH`, positive loopback and complete local task/review flow. Local macOS proof remains in FG6 v2. The duplicate Windows diagnostic run was cancelled because the canonical matrix already includes that coverage.

Exact source/job/log/payload identities and results: `docs/verification/20260925-egress-hosted-ci.json`. The initial local artifact inspection rejected an operator-assembled jobs envelope missing GitHub `total_count`; supplying the original complete API response passed the unchanged inspector. No test, gate or source was altered to force that result.

The approved egress and bounded projection diagnosis slices are complete. The first historical churn false envelope remains causally unconfirmed despite the subsequent local/hosted passes; the parity outer deadline is proven and corrected. Final publication is records-only with CI skipped; the tested source remains explicit. Draft #223 stays Draft. Remaining #164 facade work, #171 historical DE1/DE3/S6 readback scope, optional #162 cloud delivery and formal whole-plan acceptance remain open. No merge, release, deployment or issue closure.


## DE1/DE3 predicate repair (approved bounded slice)

Completed the three current-source detectors without runtime behavior changes. Cause and P1/P2/P3: `docs/researches/20260925-de1-de3-source-predicates.md`; exact input hashes, baseline failures and mutation evidence: `docs/verification/20260925-de1-de3-predicate-readback.json`. Final scoped checks: 41 tests / 118 assertions; ownership 6 tests / 52 assertions; typecheck and package boundaries passed. Three actual product-source mutations failed at the intended assertions and were restored byte-for-byte. Historical DE1/DE3 artifacts remain unchanged; full old command matrices/preflights were not rerun. This is bounded predicate repair acceptance only. S6, remaining facade/cloud scope and whole-plan acceptance remain open.
