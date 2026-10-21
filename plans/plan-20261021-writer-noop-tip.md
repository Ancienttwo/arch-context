# Plan: recheck the base after a no-op writer apply

> **Status**: Executing
> **Owner**: Codex
> **Base**: 8951c56b3aa7831e03347d267feec93bd3079397

## Authorization
User requested verified bug reports, minimal repairs and linked PRs. No release or deployment.

## P1 / P2 / P3
The CLI invokes the runtime writer, which fetches main, applies via the owned worktree daemon, then publishes. The zero-changed-path return bypasses the existing latest-tip check. Reuse the existing bounded latest-wins loop for no-op results; preserve the pre-push check for changed results.

## Task Breakdown
- [x] Reproduce a base advance during a no-op apply and exhausted retries.
- [x] File a verified nonduplicate issue.
- [x] Recheck the remote base before accepting up-to-date.
- [x] Run regression tests and typecheck; review diff.
- [ ] Record full verification outcome.
- [ ] Commit, push, create linked PR and report limitations.

## Evidence and review
- Issue: https://github.com/Ancienttwo/arch-context/issues/381
- Red: both new tests failed on the baseline (0 pass, 2 fail), returning up-to-date after one attempt.
- Green: writer and CLI suites: 23 pass, 0 fail, 411 assertions; typecheck passed.
- Quick review: one runtime branch plus two regression tests; no new interface, dependency or generated output.
- Sibling sweep: changed-output publication already checks the base immediately before pushing; the cache-hit path fetches the base before comparing its successful SHA and performs no render. Human-action/error returns make no freshness claim. Only the post-apply no-op success missed this fence.
- Full verify first stopped at sandbox Chromium launch; rerun outside the sandbox is in progress. No assertions or CI changes.
- The final remote observation is not atomic with subsequent remote writes, matching the existing pre-push limitation.
