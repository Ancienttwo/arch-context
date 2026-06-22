# FG6 Personal-User Beta Launch Review

> **Status**: Blocked — Current-Head Hosted Matrix Refresh Required
> **Date**: 2026-06-22
> **Scope**: archctx-local-github-governance FG6 personal-user Beta

## Decision Requested

Re-approve a personal-user Beta for `archctx@0.1.0` after the current HEAD has a passing hosted support matrix.

This launch boundary is limited to one local developer installing the public npm package and using the no-cloud Local Core workflow on their own repository. It does not approve design-partner rollout, opt-in beta cohorts, team collaboration, shared organization policy rollout, or multi-seat workflows.

## P1 Map

The personal-user launch boundary is:

- Public package: `archctx@0.1.0` from npm.
- Install runbook: `docs/runbooks/personal-user-install.md`.
- Local no-cloud workflow: `doctor -> init -> sync -> context -> prepare -> status`.
- Verification ledger: `docs/verification/acceptance-ledger.json`.
- Aggregate verifier: `bun run verify:governance`; while FG6-EG2 is marked in progress this proves blocked-state consistency, not launch approval.
- Current-head support matrix guard: `bun scripts/fg6-platform-workflow-matrix-readback.ts inspect --evidence docs/verification/fg6-platform-workflow-matrix-readback.json --json`.

Out of scope for this launch:

- Design partner, opt-in beta, or team collaboration rollout telemetry.
- Managed Runner, team seats, shared organization policy management, and cross-account rollout.
- Production GA external readback, ChatGPT Directory release, external packet capture, and production security scan.

## P2 Trace

The launch trace starts from the public npm artifact:

1. `archctx@0.1.0` is published and registry-visible.
2. `bun run readback:fg6:release-distribution` verifies the public install command `npm install -g archctx`.
3. A temporary public install smoke installed `archctx@0.1.0` and confirmed `archctx --help` returns the CLI envelope.
4. `docs/runbooks/personal-user-install.md` freezes the user-facing install path.
5. `docs/verification/fg6-local-no-cloud-readback.json` proves the local first-run path completes without GitHub App, ArchContext Cloud token, Cloudflare deploy access, or LLM provider credentials.
6. `bun run verify:governance` replays the aggregate evidence gate.
7. The hosted Ubuntu/macOS/Windows by Node 24/25 matrix must pass on the same current HEAD before this launch review can return to Approved.

## P3 Decision Rationale

The current product risk is scope creep, not missing collaboration rollout telemetry. Personal users need a reliable public install and local first-run path first. Team and partner rollout add separate risks: cross-account installation, support coverage, observation windows, and collaboration policy semantics. Those are deferred to `tasks/todos.md`.

At 10x personal-user adoption, the first likely failures are install/runtime compatibility, unclear first-run steps, and local repository edge cases. The npm distribution, local no-cloud first-run, representative benchmark, rollback, security, privacy, and SLO evidence remain relevant. The release is currently blocked because the support-matrix evidence must be refreshed against the current HEAD rather than reused from an older hosted run.

## Evidence Summary

| Area | Status | Evidence |
|---|---|---|
| Public npm package | PASS | `docs/verification/fg6-release-distribution-readback.json` |
| User install path | PASS | `docs/runbooks/personal-user-install.md` |
| Local no-cloud first run | PASS | `docs/verification/fg6-local-no-cloud-readback.json` |
| Cross-platform local runtime matrix | BLOCKED | Current-head hosted CI readback required; stale evidence is rejected by `scripts/fg6-platform-workflow-matrix-readback.ts` |
| Privacy and DLP | PASS | `docs/verification/fg6-privacy-dlp-readback.json` |
| Security scan and external review | PASS | `docs/verification/fg6-security-release-readback.json`; `docs/verification/fg6-external-security-review-readback.json` |
| Fault and SLO evidence | PASS | `docs/verification/fg6-chaos-fault-matrix-readback.json`; `docs/verification/fg6-slo-readback.json` |
| Rollback compatibility | PASS | `docs/verification/fg6-rollback-compat-readback.json` |
| Collaboration rollout | DEFERRED | `tasks/todos.md` |
| Human launch approval | PASS | `docs/approvals/fg6-personal-beta-launch.md` |

## Support Matrix

Personal-user Beta support remains constrained to the local runtime matrix, but current-head hosted verification is required before approval:

- OS: `ubuntu-latest`, `macos-latest`, `windows-latest`.
- Node lanes requiring current-head CI verification: `24.x`, `25.x`.
- Runtime required by published CLI: Bun `>=1.3.10`.
- Package: `archctx@0.1.0`.
- Default posture: local-only, no provider credential required.

## Known Limitations

- GitHub App and Organization Runner flows remain verified as governance evidence, but the current launch approval is not a team rollout approval.
- Design partner and opt-in beta cohort telemetry are deferred.
- Production GA external readback is deferred.
- ChatGPT Directory and provider delivery evidence are deferred.
- Collaboration features must not be marketed as launched from this decision.

## Launch Decision

Blocked for current-head personal-user Beta approval until the hosted support matrix passes and `docs/verification/fg6-platform-workflow-matrix-readback.json` is regenerated from that run. The prior human approval in `docs/approvals/fg6-personal-beta-launch.md` remains useful as scope approval, but it is not sufficient while FG6-EG2 is in progress.
