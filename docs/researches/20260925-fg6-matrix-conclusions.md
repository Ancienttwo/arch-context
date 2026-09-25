# FG6 matrix and workflow conclusion authority

## P1: boundary

`scripts/fg6-platform-workflow-matrix-readback.ts` records the nine local runtime targets, installed-bin IPC/permission artifacts, and two independent FG4 organization-runner records. `scripts/verify-governance.mjs` inspects that recording after ordinary Verify. The Verify workflow has a separate Governance job; its conclusion cannot be inferred from the nine matrix jobs.

## P2: concrete failure

The previous generator searched FG1 Markdown for `GitHub Actions Verify run ...: PASS`. The historical sentence says PASS for nine matrix jobs and separately reports Governance failure. The parser discarded that qualification and emitted `runConclusion: PASS`. The inspector accepted that aggregate without any matrix-job identities or conclusions. A new regression supplying a failed matrix job was accepted by the old implementation (3 pass / 1 fail; local pre-fix log `_ops/remaining-issues/fg6-conclusion-red.log`).

## P3: decision

Schema v2 replaces the Markdown input with GitHub REST run and complete jobs responses. It retains the actual workflow status/conclusion separately from matrixConclusion. Each of the nine exact jobs must occur once, have a distinct ID, bind the same run/head/attempt, and complete successfully. Incomplete pagination, obsolete v1/PASS fields, missing or failed jobs fail closed. POSIX permission proof now derives from the actual artifacts, just like Windows ACL proof. Independent FG4 workflow success checks remain unchanged.

A failed workflow with nine successful matrix jobs can establish this matrix gate; it cannot establish full workflow, Governance, PR, release or issue acceptance. The complete workflow conclusion stays visible. This avoids the circular demand that Governance pass its own evidence before that evidence can be recorded. Artifacts must be downloaded from the recorded run and archive/payload hashes verified during collection; the offline inspector validates the recording, not the live GitHub service.

## Reproduction and collection

Use the pinned Bun 1.4.0. Export `gh api repos/Ancienttwo/arch-context/actions/runs/RUN` and `gh api 'repos/Ancienttwo/arch-context/actions/runs/RUN/jobs?per_page=100'` to local JSON. The source accepts only a complete single response (nine targets plus Governance fit this page). Download the nine named platform artifacts, verify their run/head identity and archive digests, and retain payload hashes.

Run `bun scripts/fg6-platform-workflow-matrix-readback.ts run --hosted-run-source RUN_JSON --hosted-jobs-source JOBS_JSON --hosted-artifact-dir ARTIFACT_DIR --json` from the frozen tested checkout. The recorded currentHeadSha is that tested source, not a future evidence-only commit. Reinspect after any record-only commit; do not relabel the previous CI run as having tested it.

## Verified result

Frozen subject `8f8777722d8c9ec338868c55d300e76de02628a8`, base `e3d807759e917b26c539f25c51edc31946feb740`, Verify run [36117123203](https://github.com/Ancienttwo/arch-context/actions/runs/36117123203): all nine full matrix jobs completed successfully. Windows Node 22/24/25 took 21m51s / 22m6s / 21m39s. CI checkout merge `f3cd030620d2b27c53237033e1dc1a8e0c3e7889` and candidate share tree `91f54386c4cfbe43a36f2e3cc7890f3aa2ae14d9`; the checkout log confirms that merge SHA.

The workflow concluded `failure`: Governance completed ordinary Verify (2036 pass / 0 fail) then rejected the old v1/Windows-label FG6 recording. The new v2 recording preserves this workflow failure while recording matrix success. Generation and inspection pass with nine actual v2 artifacts, including owner-only protected Windows ACLs and broad-read rejection on all three Windows targets. All nine downloaded archive SHA-256 values match GitHub metadata; every payload SHA matches the FG6 recording. Provenance: `docs/verification/20260925-fg6-hosted-matrix-artifacts.json`.

Focused regression: 10 tests / 40 assertions and typecheck passed. The other 22 evidence-inspection commands from `scripts/verify-governance.mjs` passed locally; the refreshed FG6 inspection also passed (23 total). This is component evidence, not a successful remote Governance job or a new full local `verify:governance` invocation. The full matrix is not repeated for record-only publication. The redundant native-diagnostics workflow auto-triggered by cumulative PR paths was cancelled; existing native-source validation remained applicable.

Historical FG1 wording now explicitly distinguishes its nine-job success from the actual failed workflow and identifies its Windows label as unmeasured. No old evidence is translated into a new pass. The v2 replacement is generated from the new run.

Residual gate: Verify currently has no independent Governance dispatch. The existing remote Governance failure remains historical, and the final record-only commit is not represented as having been executed by this run. Draft PR #223 and umbrella issues #162/#164/#171 remain open. No AcceptanceReceipt, merge, release or deployment is claimed.
