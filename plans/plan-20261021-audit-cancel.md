# Abort daemon-owned audits after scoped cancellation

Status: Review

## Scope
Baseline 8951c56b3aa7831e03347d267feec93bd3079397. User-authorized bounded review, issue, repair, and PR. Preserve queue scope guards and advisory stale-policy behavior.

## Task Breakdown
- [x] Reproduce explicit cancellation with an abort-aware injected transport; check duplicates.
- [x] File verified issue and minimally connect successful scoped cancellation to daemon-owned abort.
- [ ] Run audit/job regressions, typecheck, independent review; create linked PR and follow CI.

## Evidence
Issue #391. Baseline regression failed: queue cancelled but transport signal false. Fixed audit/job suites: 52 pass, 418 assertions; typecheck passed. Independent review found no actionable defects. Baseline recovery/RPC suites: 21 pass, 237 assertions. Full verify was not repeated. Extra verify:pre passed typecheck/boundary/production-mock audits but Chromium launch failed in sandbox; unchanged baseline reproduces the same failure. Practice unit tests passed 36/149; initial CLI default state path was denied, with isolated state checks tracked separately. PR remains Draft until hosted gates are settled.
