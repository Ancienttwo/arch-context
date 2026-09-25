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

Focused validation: 10 tests / 40 assertions passed; typecheck passed. Full frozen-candidate CI and refreshed FG6 evidence are pending.
