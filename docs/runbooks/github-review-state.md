# Local Developer Review state

Developer Review requires a configured adapter that verifies the connection and device registration. Each `github review claim`, `run`, `submit` or `retry` obtains a challenge from `--challenge-json`, `--challenge-path`, or `--pr` through the configured challenge fetch port. A previous claim's state file is not a challenge source.

State version `archcontext.github-developer-review-state/v2` stores challenge identity and digest, lease metadata, review metadata, attestation digest, status and timestamps. It excludes the challenge nonce and signed attestation. The signed attestation is passed directly to the submission adapter in memory. Each submit reruns review and signing, as before.

The current submission response is available in the command result. Only its digest is retained for later `github review status --pr <number>`. A response that echoes the nonce, signature or raw attestation is rejected before persistence or output.

## Existing v1 records

A command encountering an old secret-bearing state file fails with `github-review-legacy-state-requires-discard`. Remove that record explicitly:

```sh
archctx github review discard-legacy-state --pr 42
```

This deletes the local v1 review record for PR 42. Fetch a fresh challenge and run review again. The command refuses to remove v2 or malformed records. `status` and `cancel` operate on v2 metadata without retrieving a nonce or signing key.
