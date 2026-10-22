# Preserve nested arrays in canonical YAML

Status: Review

## Scope
Issue #393 on baseline 33e8059af00e7266695cf258e2fde454e68b6bcf. Authorized scheduled review, repair and Draft PR. Pure serialization only; no daemon or network fixtures.

## Task Breakdown
- [x] Reproduce serializer/parser mismatch and check duplicates.
- [x] Add round-trip regressions; render nested array items in JSON flow form.
- [ ] Run affected checks, independent review, create Draft PR and follow CI.

## Evidence
Corrected regression table: three failures on unchanged baseline. Fixed domain suite: 103 passed/172 assertions. Contract utilities: 5 passed/21 assertions. Typecheck and diff check passed. Independent read-only review found no actionable defects. Full suite not run; no services started. A fresh empty worktree could not install dependencies under the sandbox, so the existing clean isolated worktree at the identical baseline was reused. CLI Git networking unavailable; authenticated connector used for remote operations without expanding permissions. Draft PR/CI remain the delivery steps.
