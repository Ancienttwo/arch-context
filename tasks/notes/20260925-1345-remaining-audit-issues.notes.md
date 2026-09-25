# Implementation Notes: remaining-audit-issues

Status: Draft PR #223 published; stopped at the three-round Windows repair cap with an unresolved native subprocess failure. Umbrella issues and whole-work-package acceptance remain incomplete.
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
