# Sprint 2 Representative Eval

Date: 2026-06-20

## Scope

This report closes HL-EG6 for repo-local deterministic verification. It verifies representative Sprint 2 behavior across multi-repo impact, trust-level labeling, and annual entitlement decisions.

## Source of Truth

- `packages/cloud/hardening/src/index.ts` defines `sprint2RepresentativeEval`.
- `packages/core/architecture-domain/src/index.ts` owns cross-repo impact traversal.
- `packages/cloud/attestation/src/index.ts` owns trust-level labels and device-integrity disclosure.
- `packages/cloud/control-plane-client/src/index.ts` owns offline annual entitlement behavior.

## Eval Set

| Category | Cases | Expected |
|---|--:|---|
| cross-repo-impact | 2 | Impacted relation IDs are returned for changed repositories; unrelated repositories produce no impact. |
| trust-level | 3 | Organization/developer labels remain explicit, and organization attestation still discloses customer-controlled runner limits. |
| annual-entitlement | 3 | Annual Pro entitlement is active before `offlineUntil`, inactive after it, and reports private-repository scope. |

## Result

Threshold: 100%.

Observed: 8/8 representative cases passed.

## Verification

```bash
bun test packages/cloud/hardening/test/hardening.test.ts
```

Result: pass.

## Boundary

This is not a hosted external eval run and does not prove production launch readiness. Production packet capture and production security scan remain separate HL-EG1/HL-EG5 evidence.
