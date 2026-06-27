# FG6 Personal-User Beta Launch Review

> **Status**: Approved
> **Date**: 2026-06-22
> **Scope**: archctx-local-github-governance FG6 personal-user Beta
> **Current Release Supersession**: AL10 official npm release moved the current personal-user install artifact to `archctx@0.1.4` on 2026-06-27; this review remains the historical FG6 approval for the same personal-user boundary.

## Decision Requested

Approve a personal-user Beta for the then-active `archctx@0.1.0` public artifact. The current install artifact is `archctx@0.1.4` under the same personal-user boundary, as verified by `docs/verification/architecture-ledger-al10-npm-release.md` and `docs/verification/fg6-release-distribution-readback.json`.

This launch boundary is limited to one local developer installing the public npm package and using the no-cloud Local Core workflow on their own repository. It does not approve design-partner rollout, opt-in beta cohorts, team collaboration, shared organization policy rollout, or multi-seat workflows.

## P1 Map

The personal-user launch boundary is:

- Historical launch package: `archctx@0.1.0` from npm.
- Current install package: `archctx@0.1.4` from npm `latest`.
- Install runbook: `docs/runbooks/personal-user-install.md`.
- Local no-cloud workflow: `doctor -> init -> sync -> context -> prepare -> status`.
- Verification ledger: `docs/verification/acceptance-ledger.json`.
- Aggregate verifier: `bun run verify:governance`.
- Current-head support matrix guard: `bun scripts/fg6-platform-workflow-matrix-readback.ts inspect --evidence docs/verification/fg6-platform-workflow-matrix-readback.json --json`.

Out of scope for this launch:

- Design partner, opt-in beta, or team collaboration rollout telemetry.
- Managed Runner, team seats, shared organization policy management, and cross-account rollout.
- Production GA external readback, ChatGPT Directory release, external packet capture, and production security scan.

## P2 Trace

The original launch trace starts from the FG6 public npm artifact:

1. `archctx@0.1.0` is published and registry-visible.
2. `bun run readback:fg6:release-distribution` verifies the public install command `npm install -g archctx`.
3. A temporary public install smoke installed `archctx@0.1.0` and confirmed `archctx --help` returns the CLI envelope.
4. `docs/runbooks/personal-user-install.md` freezes the user-facing install path.
5. `docs/verification/fg6-local-no-cloud-readback.json` proves the local first-run path completes without GitHub App, ArchContext Cloud token, Cloudflare deploy access, or LLM provider credentials.
6. `bun run verify:governance` replays the aggregate evidence gate.
7. The hosted Ubuntu/macOS/Windows by Node 24/25 matrix passes on the readback head before this launch review returns to Approved.

Current release supersession trace: `docs/verification/architecture-ledger-al10-npm-release.md` records `archctx@0.1.4` published to npm `latest`, `docs/verification/fg6-release-distribution-readback.json` verifies the public install command against `0.1.4`, and `docs/runbooks/personal-user-install.md` now carries the current exact install command. This does not widen the FG6 launch boundary.

## P3 Decision Rationale

The current product risk is scope creep, not missing collaboration rollout telemetry. Personal users need a reliable public install and local first-run path first. Team and partner rollout add separate risks: cross-account installation, support coverage, observation windows, and collaboration policy semantics. Those are deferred to `tasks/todos.md`.

At 10x personal-user adoption, the first likely failures are install/runtime compatibility, unclear first-run steps, and local repository edge cases. The current release evidence directly covers those through npm distribution, cross-platform matrix evidence, local no-cloud first-run, representative benchmark, and rollback/security gates. It is sufficient for a personal-user Beta but not for collaboration or production GA.

## Evidence Summary

| Area | Status | Evidence |
|---|---|---|
| Public npm package | PASS | `docs/verification/fg6-release-distribution-readback.json` |
| User install path | PASS | `docs/runbooks/personal-user-install.md` |
| Local no-cloud first run | PASS | `docs/verification/fg6-local-no-cloud-readback.json` |
| Cross-platform local runtime matrix | PASS | `docs/verification/fg6-platform-workflow-matrix-readback.json`; hosted Verify run `27967560199` |
| Privacy and DLP | PASS | `docs/verification/fg6-privacy-dlp-readback.json` |
| Security scan and external review | PASS | `docs/verification/fg6-security-release-readback.json`; `docs/verification/fg6-external-security-review-readback.json` |
| Fault and SLO evidence | PASS | `docs/verification/fg6-chaos-fault-matrix-readback.json`; `docs/verification/fg6-slo-readback.json` |
| Rollback compatibility | PASS | `docs/verification/fg6-rollback-compat-readback.json` |
| Collaboration rollout | DEFERRED | `tasks/todos.md` |
| Human launch approval | PASS | `docs/approvals/fg6-personal-beta-launch.md` |

## Support Matrix

Personal-user Beta support is constrained to the verified local runtime matrix:

- OS: `ubuntu-latest`, `macos-latest`, `windows-latest`.
- Node lanes verified in CI: `24.x`, `25.x`.
- Runtime required by published CLI: Bun `>=1.3.10`.
- Package: current `archctx@0.1.4`.
- Historical package: initial FG6 approval artifact `archctx@0.1.0`.
- Default posture: local-only, no provider credential required.

## Known Limitations

- GitHub App and Organization Runner flows remain verified as governance evidence, but the current launch approval is not a team rollout approval.
- Design partner and opt-in beta cohort telemetry are deferred.
- Production GA external readback is deferred.
- ChatGPT Directory and provider delivery evidence are deferred.
- Collaboration features must not be marketed as launched from this decision.

## Launch Decision

Approved for the personal-user Beta boundary in `docs/approvals/fg6-personal-beta-launch.md`. Current exact npm version is governed by the release distribution readback and `docs/runbooks/personal-user-install.md`.
