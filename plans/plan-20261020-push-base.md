# Bind projection base to publication destination

Status: Complete

## Scope
Verify the reported fetch/push destination mismatch on baseline 8951c56b3aa7831e03347d267feec93bd3079397. Keep the base-plus-one-commit contract, use only local bare fixtures, and preserve existing no-op repair scope.

## Task Breakdown
- Reproduce divergent fetch/push base with a local fixture.
- File a verified nonduplicate issue, then resolve base and fences against the captured push URL.
- Run regression, writer suite, typecheck, independent review; submit linked PR.

## Evidence
Issue #387. Divergent local repositories failed the baseline regression. Standalone writer suite20passed/296assertions and typecheck passed. Rebased onto PR #382 to bind its no-op fence to the push destination too; combined writer suite23passed/321assertions and typecheck passed. Independent read-only review found no actionable defects after this integration correction. Separate PR based on fix/review-reliability; do not merge independently without that dependency.

Final affected writer+CLI suites:25passed,0failed,425assertions; typecheck passed. Intermediate CLI test exposed origin/main refresh regression; final code preserves tracking refresh for identical fetch/push URLs and isolates differing destinations. Corrected code received an additional independent review with no findings.
