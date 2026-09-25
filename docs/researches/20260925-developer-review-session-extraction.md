# Developer Review session extraction — issue #164

Status: targeted verification complete; full verification and hosted CI pending. Baseline: #218 production extraction `64bc3b641c37fc2353b3eea0aeb06a8f9eeeada4`; its readback-input follow-up is included before final verification.

## P1 — ownership

Digest-bundle calculation, deterministic review sessions and signed Developer Review attestation move into the existing `developer-review-run.ts` module beside worktree lifecycle. Their public DTOs and private policy/runtime-identity helpers move with them. Shared complete-task gates, caller-field guards, code-facts digest and storage/signing ports keep their owning boundaries.

## P2 — trace

The service verifies detached/clean HEAD and tree authority, loads model data, obtains code facts, computes digests, invokes the existing review gate and persists through `saveReviewResult`. Signing rejects caller-authored attestation fields and uses only the injected device signer over the canonical daemon-produced payload. Clock, principal/key references, challenge nonce and digest inputs are unchanged. Cross-method calls use the facade callbacks, preserving the existing in-process dispatch points.

Composition identity is captured only after the daemon initializes its composition report. No private key material is read or copied into the service; the injected signing port remains the only private-key operation.

## P3 — move boundary

The facade retains identical signatures and delegates to the composed service. Existing public types are re-exported and all 34 runtime exports are unchanged. No schema, storage policy, signing rule or default changes. At 10x reviews, model/code-facts reads and detached worktree validation remain the cost; this extraction claims no throughput change.

## Verification

Normalized parity passes for the three method bodies, DTOs and exclusive policy/runtime-identity helpers. The existing co-located suite remains unchanged: nine tests pass with 116 assertions, covering worktree authority, daemon-owned digests, review persistence, signing, private-key non-disclosure and caller-field rejection. Typecheck, package boundaries and public runtime export parity pass.

The existing component summary and review-engine relation were updated through daemon ChangeSet; model validation reports no errors. Full verification and hosted CI results will be recorded in the PR after code is frozen.
