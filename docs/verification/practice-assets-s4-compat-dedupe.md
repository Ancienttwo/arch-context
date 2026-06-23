# Practice Assets S4 Compatibility Dedupe

This slice closes S4-22 for complete-stage review output. It prevents the same compatibility contract defect from being counted twice when both the legacy compatibility gate and the deterministic practice gate see the same invalid contract.

## P1 Map

- Review gate: `packages/core/review-engine/src/index.ts` owns user-facing findings, error counts, review result, and extensions.
- Compatibility gate: `packages/core/policy-engine/src/index.ts` owns `validateCompatibilityContract` and emits direct `unjustified-compatibility-path` / `invalid-compatibility-contract` findings.
- Practice checker: `packages/core/practice-engine/src/check-registry.ts` runs `compatibility-contract-required`, which intentionally calls the same compatibility validator and puts failing finding ids into check-result subjects.
- Tests: `packages/core/review-engine/test/review-engine.test.ts` covers the merged review result and schema validity.

Out of scope: changing checker semantics, changing compatibility policy rules, or suppressing non-compatibility practice violations.

## P2 Trace

Concrete duplicate path:

1. `completeTaskGate` receives `compatibilityPathIntroduced: true` plus an invalid `compatibilityContract`.
2. The direct compatibility gate pushes `compatibility-reason`, `compatibility-owner`, or related contract findings into `findings`.
3. The daemon-provided `practiceEnforcement` may also contain a failing `compatibility.single-owner / compatibility-contract-required` check.
4. The practice check's `subjects` are the same compatibility finding ids produced by `validateCompatibilityContract`.
5. `completeTaskGate` now suppresses only the `practice:*` finding whose compatibility subjects already appear in direct findings.
6. The review still retains `practiceViolations`, `actionsRequired`, and practice catalog/policy/check digests. Suppression metadata is recorded in `extensions.suppressedPracticeFindings`.

## P3 Decision

The invariant is that deterministic practice results remain attested even when their user-facing finding would duplicate an older review gate. Suppressing only the duplicate finding preserves auditability while keeping error counts and remediation output stable for humans.

The match is intentionally narrow: it requires `checkId === "compatibility-contract-required"` and subject ids that already match direct compatibility findings. Other complete practice violations still produce their own findings.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/core/review-engine/test/review-engine.test.ts
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
bun run verify
```

Observed readbacks:

- Review-engine focused suite: 7 pass / 0 fail / 34 expects.
- `bun run typecheck`: pass.
- `node scripts/sprint-status-check.mjs`: `STRUCTURE AND EVIDENCE CLAIMS OK`.
- `git diff --check`: pass.
- `bun run verify`: 598 pass / 0 fail / 3564 expects; packaged CLI smoke, privacy/security manifests, acceptance ledger, sprint status check, and representative eval all passed.

## Gate Evidence

- S4-22: direct compatibility findings remain visible; duplicate `practice:compatibility.single-owner:compatibility-contract-required` is suppressed from `findings` and `summary.errors`.
- Practice attestation data remains present: `practiceViolations`, `actionsRequired`, and snapshot practice digests are retained.
- Suppression is visible through `extensions.suppressedPracticeFindings` with the duplicate direct finding ids.
