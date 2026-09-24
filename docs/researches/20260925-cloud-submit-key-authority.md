# Cloud submit key authority — issue #171

## Map and trace

`ControlPlane.submitReviewChallengeApi` loaded the stored challenge but authorized device/runner objects supplied by the same request as the public key. The cryptographic verifier checked that supplied key, and developer revocation status could be omitted. The control plane already owns device and runner registries with fingerprints and revocation state, but submit did not consult them.

A leased challenge plus an attacker-signed attestation, fabricated active identity and fabricated active key status was accepted for both developer and organization trust with an empty registry. Regression tests reproduce both accepted submissions before the change.

## Decision

Resolve identity and key status from the current control-plane registry using the authorized resource identity. Reject request-supplied `deviceIdentity`, `runnerIdentity` and `signingKeyStatus` fields instead of retaining an alternate authority. Require the signed principal and public-key ID to match that registered identity, and bind the request's verification key to its registered fingerprint before signature verification or nonce consumption.

Resource/account/repository/workflow checks use the resolved identity. Revocation therefore cannot be bypassed by omitting status or resubmitting a pre-revocation identity. Failed bindings leave the challenge nonce unconsumed.

The lower-level signature and submit primitives remain trusted composition functions for offline/readback callers; they do not authenticate an external request or perform registry resolution. External submit adapters must call `submitReviewChallengeApi`. No production Worker submit route exists in the current repository. The in-memory registry still requires durable integration under #162; this change does not claim restart persistence or live endpoint delivery.

The API lookup and fingerprint check add bounded work per submission and no network calls. At larger traffic volumes registry persistence and lifetime, already tracked by #162, remain the limitation.

## Validation

Tests cover forged authority with an empty registry, missing registry entries without authority fields, replacement public keys, principal/key-ID substitution, active registered success and revocation for both trust levels. Existing challenge replay/metrics behavior remains covered. The complete control-plane and attestation suites pass 51 tests with zero failures; typecheck passes. The sole existing submit API test now uses a registered identity whose IDs match its signed attestation; no production caller needed migration.

## Submit v2 migration and rejection evidence

The authority change uses `archcontext.challenge-submit-request/v2`; submit v1 is rejected. Migration notes and supplemental E1 (repository-level) evidence under the existing FG5-20 API compatibility entry are in the API compatibility policy and acceptance ledger. Historical deployment recordings are not rewritten. After the review fixes, 53 control-plane/attestation/rollback-fixture tests and typecheck pass. Tests verify malformed, legacy and privacy-violating attestations return classified rejections with metrics and no consumed nonce; key-binding failures use the same typed rejection path.
