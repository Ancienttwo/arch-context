# First-adoption manifest fixed point

Status: Executing. Owner authorized the upstream repair on 2026-09-13.

## Goal and boundary

Make preview-bound adoption converge when existing human documents have no prior projection manifest and the model reports unresolved flow proof. Preserve human sections and unresolved-proof signals. No handwritten baseline, model changes, gate relaxation, product semantic changes or registry publication.

## P1 / P2 / P3

- Map: CLI docs adoption simulates projection-engine output and submits one daemon ChangeSet; generated document and manifest digests have separate inputs.
- Trace: adoption changes document bytes; the first simulated manifest records that digest as its baseline. Refresh signal IDs bind both prior and resulting digests, so one further metadata render precedes the fixed-point check.
- Decision: settle the manifest from the canonical document baseline, then require a clean drift check and unchanged document digest. Keep a finite deterministic sequence; continued drift fails closed. At 10x files, one additional pure render costs linear work in the existing projection pipeline.

## Tasks

- [x] Capture a failing no-baseline/no-flow approved-adoption regression.
- [x] Settle the canonical manifest before the final fixed-point assertion.
- [x] Run adoption regressions, projection-engine tests and typecheck.
- [ ] Package the exact candidate and replay the original AiphaBee adoption.

## Evidence

Logs live outside this checkout under the AiphaBee parent checkout's Garbage/closeout-20260913/architecture-evidence. This standard-profile slice uses this plan only; no contract/review/notes scaffold. Source fix is confined to packages/surfaces/cli/src/main.ts and its CLI regression test. Revert those changes together if proof fails.

## Verified evidence

The new regression failed before the source fix with the exact AiphaBee `projection-manifest-stale; digest=stable` error. After the four-line CLI fix: 3 adoption tests passed (including preview binding, semantic acceptance and preserved unresolved-proof behavior), 129 projection-engine tests passed, typecheck passed, and the one-package Node tarball lifecycle smoke passed. The source package version remains 0.5.10 for local candidate compatibility; no registry release is claimed.
