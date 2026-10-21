# Plan: retain RPC cleanup after daemon stop errors

> **Status**: Executing
> **Base**: 8951c56b3aa7831e03347d267feec93bd3079397

## Authorization
Second bounded review pass authorized issue, repair and PR. No merge or release.

## Trace and decision
Daemon stop already releases its store in finally, but RPC stop awaits it before cleaning control files and its lock. Preserve the original error while attempting remaining cleanup, including the stop callback. Verify with a failing daemon cleanup and successful subsequent start on the same control paths.

## Task Breakdown
- [x] Reproduce cleanup failure and restart refusal.
- [x] Check duplicates and create verified issue.
- [x] Implement minimal error-preserving cleanup and regression tests.
- [x] Run affected tests, typecheck and independent review.
- [ ] Commit, push and create separate linked PR.

## Evidence
- Issue: https://github.com/Ancienttwo/arch-context/issues/383
- Regression fails on the baseline: the connection file remains after daemon stop rejects.
- Fixed RPC suite: 13 passed, 1 existing Windows-only skip, 0 failed; 80 assertions.
- Typecheck and diff whitespace checks passed.
- Independent read-only review found no actionable flaws; reviewed shutdown, store ownership, Windows removal, original error preservation and the CLI stop waiter.
- No CI, assertion, timeout or platform changes. Tests use isolated control files and ephemeral loopback listeners.
