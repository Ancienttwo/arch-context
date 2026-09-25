# Task Review: remaining-audit-issues

> **Status**: Pending
> **Plan**: plans/plan-20260925-1345-remaining-audit-issues.md
> **Contract**: tasks/contracts/20260925-1345-remaining-audit-issues.contract.md
> **Notes File**: tasks/notes/20260925-1345-remaining-audit-issues.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-25 13:48
> **Recommendation**: fail
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending

## Human Review Card

- Verdict: pending
- Change type: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | frontend
- Intended files changed:
- Actual files changed:
- Commands passed:
- Residual risks:
- Reviewer action required: inspect diff and card
- Rollback:

## Mode Evidence

- Selected route:
- P1/P2/P3 evidence:
- Root cause or plan evidence:

## Verification Evidence

- Waza `/check` run:
- Commands run:
- Manual checks:
- Supporting artifacts:
- Implementation notes reviewed:
- Run snapshot:

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- [ ] Exact manual_checks requirement
  - Evidence: concrete observation, command output, screenshot path, or reviewer note

## Acceptance Receipt Projection

> **Disposition**: unavailable
> **Reviewer**: unavailable
> **Source**: unavailable
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending
> **Verification Evidence SHA256**: pending
> **Issued At**: pending

- Summary: No AcceptanceReceipt has been recorded.
- Findings: none

## Behavior Diff Notes

- ...

## Residual Risks / Follow-ups

- ...

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 0/10 | |
| Product depth | 0/10 | |
| Design quality | 0/10 | |
| Code quality | 0/10 | |

## Failing Items

- ...

## Retest Steps

- Re-run:
- Re-check:

## Summary

- ...

## Manifest field mutation scope review

Source inspection confirms fixed-path/field admission before journaling, existing approval and repository freshness checks, no generic allowlist widening, no generated projection writes, rollback/recovery readback support, shared MCP/runtime schema, and digest-only ledger field metadata. YAML alias consumers are detached when computing the expected document so unrelated alias changes fail closed. Focused validation passes 21 tests / 140 assertions, plus typecheck and workspace boundaries. This is a scoped implementation review, not a provider-owned AcceptanceReceipt or whole-plan acceptance. Hosted candidate validation is recorded separately.

Hosted evidence for the frozen manifest source is complete: Verify `36125127163` passed nine full platform jobs plus Governance (all 24 commands), with zero full-suite failures. Merge/source tree identity and all nine archive/payload identities were checked; native ACL/lifecycle evidence passes the existing FG6 verifier. Source, logs and results are bound in `docs/verification/20260925-manifest-hosted-ci.json`. This closes the approved manifest slice; broad issue and formal whole-plan acceptance remain open.


## Local egress slice review

Reviewed concrete HTTP/process admission, audit side-effect ordering, manual and prepare Context7 ports, CodeGraph telemetry, process-scoped report authority, policy errors and the FG6 evidence cutover. No alternate compatibility authority was introduced. Kernel proof requires measured OS rejection and working loopback; unsupported/unisolated runs cannot pass. Local execution and focused verification are in the task notes. Linux namespace execution and full current-candidate CI are pending, so this is not whole-plan acceptance or an AcceptanceReceipt.


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


Published source `48a88cecbbc1906bdb1d75958d7423ed4170484a` to Draft #223. Historical full CI remains bound to `5117abd`; this repair has the scoped local verification recorded above. Publication/records completion is not hosted-CI or whole-plan acceptance.


## Integrated acceptance scope and source review

The current user directive accepts the existing PR work and cleans issue tracking. #220/#221/#222 heads are ancestors of #223; their feature extractions are included. Further composition-only facade work and general RPC decoders remain #164 and are explicitly deferred in `tasks/todos.md`, rather than claimed complete by this PR. Cloud delivery remains a blocking milestone under #224; ADR-0016/0017 retain the target and now point to it. This supersedes the earlier open-ended further-extraction task for this acceptance boundary, without marking #164 done.

S6 v2 now validates current CLI metadata, required evidence fields and the current generic harness README. Canonical output was generated; v1 was archived byte-for-byte. Source review found no blocking code defects. The reported stale S6 proof hashes/assertion count were corrected against final verified source. Windows run 36144083941 remains failed: the docs digest test exceeded 15 seconds once; unchanged production code previously passed that test in 3.608 seconds. No particular slow phase is proven. Retain the 15-second deadline and all assertions for the one planned frozen-candidate matrix.


## Final integrated acceptance disposition (2026-09-25)

**BLOCKED**. Hosted candidate `18d2075` passed all ten jobs in run 36149269956, with 2115 tests per full suite and zero failures; native/network artifacts and source/merge identities were verified. #220–#222 were closed as superseded by Draft #223, preserving branches. #162 is closed for completed local status truthfulness; #224 retains real cloud delivery. #164 and #171 remain open with explicit remaining work.

Formal freeze fails on the installed harness/repository capability contract mismatch (#225). Migrated direct local contract checks passed Explorer session, typecheck and boundaries, but full verify failed with 2112 pass / 1 skip / 2 fail: documentation-drift CodeGraph handshake timeout and a separate projection RPC readback outer timeout (#226). No second matrix, timeout change or additional repair was attempted. No AcceptanceReceipt, merge, release or deployment is claimed. Exact source/log/command evidence and P1/P2/P3: `docs/verification/20260925-integrated-pr-acceptance.json` and `docs/researches/20260925-integrated-pr-acceptance.md`.
