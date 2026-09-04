# Architecture evidence integrity acceptance

> **Status**: Accepted
> **Reviewer**: Codex independent gatekeeper
> **Implementation Commit**: 9b587af0d3983901b360d7a0187d460ab134348a
> **Target Revision**: 79c5ef88480684ce3d419c4399f04d70aa714db9
> **Semantic Subject**: sha256:8de5abe4dbfebe9d6dcae5524509b077838722e04c4f213090dc9300537ce4c9

## Verdict

PASS. One independent post-implementation gate reviewed the complete work-package and recommended the authorized local main merge. No blocking findings. The review includes the staged source-commit references in the two research/handoff documents.

## P1 / P2 / P3

P1: CodeFacts and explicit runtime facts feed context/pressure/readiness; accountable proposal authoring and RF2 assessment remain separate from downstream scheduling. Git model and daemon/ledger writer boundaries are unchanged.

P2: Name-only input previously yielded pressure65/high; missing prepare readiness became86/high and then a fixed target architecture. After this change names and summaries cannot establish observations, absent readiness remains unknown, and prepare no longer authors an intervention. Target/migration overlap is rejected through the existing RF2 request validator.

P3: Remove false evidence and the duplicate authoring authority while preserving valid measured signals, explicit inputs, existing schema shapes and RF2 lifecycle. Do not restore the old recall by increasing weights or inventing facts. Additional measured direction violations and downstream orchestration are independently bounded follow-up work.

## Verification

- Environment: Node24.18.0 via /opt/homebrew/opt/node@24/bin, Bun1.4.0, isolated worktree, frozen lockfile.
- First actual full `bun run verify`: PASS, exit0,324559ms. Includes full repository tests, typecheck, package boundaries, Explorer, packaged daemon/CLI lifecycle smoke, privacy/readbacks, acceptance ledgers, sprint status and representative eval.
- Canonical prepared run: `.ai/harness/runs/run-20260905T042200-40467-20260905-architecture-evidence-integrity.json`; summary: `.ai/harness/runs/architecture-evidence-full-verification.log`; all contract/criterion-context/allowed-paths/change-assessment guards passed.
- Independent gate: source and fixture review, staged/unstaged diff checks, allowed-path check, dependency-manifest check and added-secret-literal scan passed. It reused the exact full-verifier evidence instead of repeating the expensive pipeline.
- Focused red/green proof: context compiler3failed assertions before correction; invalid/missing readiness and automatic intervention regressions failed before correction; contracts overlap control failed before the validator fix. Final worker suites and full verification passed.
- Eval: original32drift records byte-identical;22legacy positive false negatives remain visible. Four explicit facts controls give1/1 positive detection, overall recall1/23 and precision1/1. Target/migration oracle is4/4 through real RF2 (3valid,1exact-error rejection). Configured gate PASS does not establish broad semantic architecture detection.

Canonical finalization passed without rerunning verification. Retained runtime evidence is under the isolated worktree `../arch-context-wt-architecture-evidence-integrity/.ai/harness/`, not copied into main as a new receipt authority.

## Residual boundaries

Source acceptance only: no npm release, deployment, remote push, downstream installation or downstream implementation is claimed. `repo-harness` on the other machine must reconcile latest work against the handoff before dispatch. The local installed0.4.4 dependency mismatch was observed only on this machine.

The fixed source remains version0.5.6 in manifests until a separately authorized release; consumers cannot infer installation of this fix from that version string. The complete architectural review and portable downstream work packages are in the two `docs/researches/20260905-repo-harness-*.md` files.

## Acceptance Receipt Projection

> **Disposition**: external_pass
> **Reviewer**: Codex
> **Source**: codex-review
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: sha256:8de5abe4dbfebe9d6dcae5524509b077838722e04c4f213090dc9300537ce4c9
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 79c5ef88480684ce3d419c4399f04d70aa714db9
> **Verification Evidence SHA256**: sha256:a1ad71668c8bc63e2503de630849fac38cf73a335641f2a3b84231f4cffc7ebd
> **Issued At**: 2026-09-04T20:30:34.903Z

- Summary: Independent Codex gatekeeper PASS; frozen source, full bun run verify and evidence-integrity controls passed; downstream and release remain outside this merge.
- Findings: none
