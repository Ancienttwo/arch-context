# Issue 408: Ordered layers and evaluated dependency direction

Status: Review

## Authorization

The user explicitly requested parallel implementation of issues #402, #407, #408 and #409 on 2026-10-26. This isolated lane implements #408. Baseline: `0e08d30cb9e3daf87730a7126ca9b785d7663f72`.

## Task Breakdown

- [x] Implement ordered layers, evaluated direction constraints and explicit unknown/error states.
- [x] Add focused regressions and run affected tests and typecheck.
- [ ] Independently review and repair findings; check shared-interface composition.
- [ ] Submit a linked Draft PR with exact evidence and remaining gates.

## Boundaries

No full CI or full suite, merge, release, deployment, services, secrets or permission expansion. No user-data/model repair. Synthetic fixtures only. Preserve existing worktrees.

## Evidence and remaining gates

The isolated lane passed 36 focused tests (188 assertions), 74 contract/adapter
tests (235), 64 native tests (1558), 58 recovery tests (243) and the final pure
ledger validator regression (1 test, 4 assertions); these sets overlap.
Typecheck and whitespace checks passed. Independent review passed 37 tests (193
assertions) and four recovery tests (17), then identified the ledger metadata gap.
The final validator delta preserves `layerOrderErrors` and unrelated blocking
errors; its pure regression passed. Shared-interface composition is still pending.
Logs remain in the parent task directory as `issue408-*.log`.

The optional order preserves existing layer behavior when absent. Rollback is a
code revert; any adopted manifest `model.layers` must first be removed through an
approved ChangeSet before using a runtime that cannot read it. No user model has
been migrated by this task.
