# Legacy manifest recovery guidance
Status: Review

## Task Breakdown
- [x] Reproduce missing actionable diagnostic using pure contract fixture.
- [x] Add conditional recovery guidance and missing-model safety documentation for #399.
- [ ] Run affected tests/typecheck, independent review, submit Draft PR without full CI.

Scope: baseline b4d62fa7b0c3eca4d45dd00c0fd300ae1e79edaa. No downstream data changes, manifest removal, apply operations or model reconstruction. Does not implement ignored-model detection.

Evidence: baseline diagnostic regression failed; final failure-envelope file 21 pass / 1117 assertions; typecheck and diff check passed. Independent read-only review found no actionable findings. No model migration or recovery executed. Full CI intentionally suppressed by [skip ci] per user instruction; Draft PR only.
