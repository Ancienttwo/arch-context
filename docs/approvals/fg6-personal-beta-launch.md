# ArchContext FG6 Personal-User Beta Launch Approval

> **Status**: Approved
> **Date**: 2026-06-22
> **Approved By**: Chris
> **Scope**: archctx-local-github-governance FG6 personal-user Beta launch; FG6-EG10; FG6-20
> **Current Release Supersession**: The approved personal-user boundary remains active; the exact current npm artifact is now `archctx@0.1.4` from the AL10 official npm release.

## Source

- Sprint plan: `plans/sprints/archctx-local-github-governance-sprint.md`.
- Launch review: `docs/verification/fg6-personal-beta-launch-review.md`.
- Personal install runbook: `docs/runbooks/personal-user-install.md`.
- Initial public release package: `archctx@0.1.0`.
- Current public release package: `archctx@0.1.4`, verified in `docs/verification/architecture-ledger-al10-npm-release.md`.

## Approved Boundary

- Approves only the personal-user Beta launch boundary; it does not approve team or production GA scope.
- A personal user may install the current release with the command in `docs/runbooks/personal-user-install.md`.
- The approved user path is local no-cloud usage on the user's own Git repository.
- This approval does not approve design partner rollout, opt-in beta cohorts, team collaboration, shared organization policy rollout, Managed Runner, multi-seat workflows, or production GA.
- Deferred collaboration rollout remains tracked in `tasks/todos.md`.

## Evidence To Review

- `docs/verification/fg6-personal-beta-launch-review.md`
- `docs/verification/fg6-release-distribution-readback.json`
- `docs/verification/fg6-local-no-cloud-readback.json`
- `docs/verification/fg6-acceptance-evidence.md`
- `docs/verification/fg6-staging-release-gate.md`
- `tasks/todos.md`
- `bun run verify:governance`

## Approval Record

The repository owner approved the personal-user Beta launch in the active execution thread on 2026-06-22 with the response `approved`.
