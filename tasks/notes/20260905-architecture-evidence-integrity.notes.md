# Architecture evidence integrity notes

## Scope and authority

Reviewed upstream main 79c5ef88480684ce3d419c4399f04d70aa714db9 and downstream a95f41e3c2e5d39d8dc765ffdc89fb75eb8ff6aa. User authorized implementation, parallel workers, acceptance, commits and merge after the initial review. Downstream is concurrently developed on another machine; its handoff requires checking latest state first. No downstream writes, package publication, deployment, model or runtime ledger mutations.

## Root Cause Evidence

1. Observable failure: path-only src/legacy-wrapper-owner.ts and empty edges produced pressure65/high; prepare missing readiness supplied .8/true/true, giving86/high and a fixed target proposal. Root cause: text/name-derived structural assertions plus application defaults and deterministic target authoring. Regression: negative name/read-edge/summary controls and missing/invalid readiness tests fail before the fix. Corrective boundary: only observed graph/date facts affect structural pressure; unknown evidence remains unknown; accountable proposal authoring uses RF2.
2. Observable failure: compiler returned high100 for merely retrieving two symbols with generic verified records, and landscape high85. Root cause: nonempty symbols -> callerCoverage1; generic evidence -> testsAvailable; rollback hardcodedtrue. Regression: three assertions failed (single-repo, trimmed context, landscape). Corrective boundary: explicit readinessEvidence input, same confidence computation, existing context unknowns preserved through trimming.
3. Observable failure: cross-repo cycle plus task wording produced40/medium and invalid2026-99-99 could become an observed overdue signal. Root cause: advisory/observed aggregation and lexical comparison without calendar validation. Regression controls failed before shared observed-only scoring and strict calendar-day input validation.
4. Directly blocking adjacent invariant: a sealed RF2 targetDelta with the same relation in requiredRelations and temporaryRelations returned no invariant issues. Root cause: missing disjointness check in existing validator. Regression: contracts77pass/1fail before,78pass after; request/proposal propagation and a distinct-relations control covered. This is the sole adjacent repair; it preserves schema shape and existing AC_SCHEMA_INVALID handling.

## Evaluation migration rationale

Do not retune the original32drift labels or threshold. Remove task-to-symbol/file fabrication and retain the resulting22legacy recall misses. Four explicit independent graph/date controls validate the measured boundary in the existing evaluator. Retire the old target generator skeleton dataset to history and test actual RF2 authored input, derivation, assessment and invariant rejection. Historical performance is not a claim of released provider quality.

## Verification environment

Isolated branch codex/architecture-evidence-integrity, based on79c5ef8. Bun1.4.0 with frozen lockfile install. Default system Node26.3.1 lies outside the product >=22.22 <26 contract; use existing /opt/homebrew/opt/node@24/bin/node24.18.0 in the verification PATH without changing global configuration.

The global repo-harness executable resolves symlinked files in the concurrently developed downstream checkout and fails with stale installed contracts0.4.4. An isolated published repo-harness0.18.0 install provides workflow helpers; its strict workflow check passes. This does not repair or validate the other machine's runtime.

Focused worker tests and compiler red/green checks pass; final frozen-subject verification and acceptance are recorded in the review artifact. Contract's single bun run verify command covers typecheck, full tests, package/runtime/privacy/acceptance-ledger readbacks and eval without duplicating expensive runs.

Change Assessment preflight classified the target/migration fixture scope as migration and requested a runtime_readback oracle. The existing full verifier already runs scripts/packaged-cli-smoke.mjs, which starts a real daemon and exercises authored refactor scan/record/verify in disposable state. Declared that actual oracle in the contract; no gate downgrade or new benchmark.

Acceptance preflight stopped before executing the full verifier: the new contract omitted the standard evidence_requirements.benchmark declaration and an exploratory assessment JSON was outside the ignored runtime naming rule. Added benchmark:not_applicable because this work does not consume the harness-profile benchmark matrix, moved the exploratory JSON to ignored runs, and removed an archive EOF blank line. The helper also requires committed contract authority for evidence binding; create a candidate commit before final verification, without treating that commit as accepted or merged.

## Frozen candidate verification

Candidate implementation commit: 9b587af. The first actual full verifier passed in 324559ms with Node24.18.0/Bun1.4.0. `repo-harness run verify-sprint --prepare-acceptance` produced run-20260905T042200-40467-20260905-architecture-evidence-integrity.json, all contract/criterion-context/allowed-paths/change-assessment guards pass. Semantic subject: sha256:8de5abe4dbfebe9d6dcae5524509b077838722e04c4f213090dc9300537ce4c9. Independent gatekeeper returned PASS. AcceptanceReceipt external_pass is valid, and verify-sprint finalized it without rerunning verification.

The full verifier includes the repository's tests, Explorer checks, actual packaged CLI/daemon refactor lifecycle smoke, privacy/readback gates, acceptance ledgers, sprint status and representative eval. No duplicate full run was performed. The helper removes successful per-command raw logs; retain its signed workflow event, run snapshot and summary instead of rerunning only to recover a test count. The final representative eval is configured-gates PASS, RF2 target/migration4/4, drift precision1/1, overall drift recall1/23; preserved legacy prose-only positive recall0/22. This is an evidence-integrity improvement with an explicit capability gap, not a broad semantic-detection quality claim.

The acceptance receipt was projected by the official helper, not hand-written. The local merge-gate fingerprint reports required:false for main79c5ef8; the accepted source and clean-tree Git checks still govern this local merge. Raw workflow evidence remains in the retained isolated worktree.
