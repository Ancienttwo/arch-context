# Developer-review state privacy — issue #165

Pinned implementation baseline: `30e50f938fb6cc1afa4ffe2cdba38707ad240d2c` (RPC client entrypoint slice).

## P1 — ownership

`runGithubReviewCommand` owns the local claim/run/submit lifecycle and calls the daemon for review execution and signing. `github-review-state.ts` now owns the metadata-only state schema, strict disk validation, credential-material guard, persistence and explicit legacy-state discard. The daemon remains the signer; no raw challenge or signature becomes local persisted review authority.

## P2 — root cause and trace

The old writer serialized the complete in-memory state, including `challenge.nonce` and `attestation.signature.value`. The sanitizer ran only on terminal output. Adding a disk nonce assertion to the existing CLI lifecycle test failed after `claim`, before production changes (`/tmp/archctx-165-privacy-before.log`). The generic credential patterns did not reject either field.

Every `run`, `submit` and forced `retry` already starts a new detached review and signs again. Submission has one call site immediately after that signing operation. Therefore the persisted signature was unnecessary; this fix passes the freshly signed attestation directly to the submission adapter in memory. No resume-and-re-sign receipt or new daemon RPC is needed.

The former cross-invocation dependency was the raw cached challenge fallback. That path is removed. Each operation resolves the challenge from explicit input or the configured fetch port, then performs the existing head/lease checks. Status and cancel read metadata only. The lease remains typed metadata so ownership and expiry checks retain their existing inputs.

## P3 — persisted contract and migration

State v2 stores challenge identity/metadata without nonce, the challenge digest, lease metadata, review result/digests, attestation digest, status and update time. Submission responses are transient; only `submissionDigest` is persisted. JSON schema validation rejects unknown fields, including a raw challenge nonce, attestation or submission body.

Before writing, the privacy guard rejects known transient nonce/signature strings of at least 16 characters within metadata or adapter response strings, including escaped strings and values nested under unrelated keys. The challenge contract also permits short nonces; these are checked as exact values, without treating arbitrary substrings or structural field names as leaks. Substring detection cannot reliably identify short nonce material. Raw `nonce`, `signature` and `attestation` fields in submission responses are rejected regardless of length. Failure leaves the previous file intact; the CLI records only the fixed safe error when a submission adapter echoes request secrets.

A v1 file is rejected with a specific instruction. `archctx github review discard-legacy-state --pr <number>` explicitly removes that legacy record, after which the operator fetches a fresh challenge and reruns review. The command refuses v2 or malformed files; there is no legacy authority fallback or automatic conversion of cached secrets into new state.

This intentionally changes cross-invocation usage: a prior claim is not a challenge source, and a later status shows the submission digest rather than the original response body. The review/sign/cleanup sequence and rerun behavior remain unchanged. At 10x invocations, review and Git work remain the cost; metadata validation is linear in the supplied state/adapter response size and makes no throughput claim.

## Verification

The lifecycle regression covers claim/run/submit/status/retry/cancel, authoritative challenge re-fetch, refusal when that source is absent, disk nonce/signature absence and detached-worktree cleanup. A malicious submission adapter echoing the new signature fails without leaking it to disk or output. Five focused state tests cover transient submission responses, nested/escaped secret rejection before file replacement, explicit legacy discard, refusal of secret-bearing/unknown stored fields, and short-nonce collisions. The short-nonce regression failed against the initial guard before the correction. Full `bun run verify` passes with 2014 tests and zero failures, including typecheck, package boundaries and all configured gates.

The CLI projection-to-daemon/MCP migration is another acceptance criterion of #165 and remains open. This slice closes only the developer-review state privacy boundary.
