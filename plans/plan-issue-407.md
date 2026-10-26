# Issue 407: ADR native export and manifest diagnostics

Status: Review

## Authorization

The user explicitly requested parallel implementation of issues #402, #407, #408 and #409 on 2026-10-26. This isolated lane implements #407. Baseline: `0e08d30cb9e3daf87730a7126ca9b785d7663f72`.

## Task Breakdown

- [x] Implement the issue contract with backward-compatible defaults and explicit unknown/error states.
- [x] Add focused regressions and run affected tests and typecheck.
- [ ] Independently review and repair findings; check shared-interface composition.
- [ ] Submit a linked Draft PR with exact evidence and remaining gates.

## Boundaries

No full CI or full suite, merge, release, deployment, services, secrets or permission expansion. No user-data/model repair. Synthetic fixtures only. Preserve existing worktrees.

## Verification

Four regression cases failed on baseline. Affected checks: 171 pass; final focused: 8 pass; native CLI: 23 pass; typecheck passed. Independent code review found no blocking defect; synthetic ref/worktree ADR symlinks rejected. Combined lane validation and PR checks remain pending. Runtime orchestration tools unavailable; Draft retained. Strict v1 payload additions require paired runtime/contracts adoption.
