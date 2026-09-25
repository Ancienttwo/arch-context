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
