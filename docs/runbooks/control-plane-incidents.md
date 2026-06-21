# Control Plane Incident Runbook

This runbook covers the FG5 control-plane alerts emitted by `ControlPlane.evaluateControlPlaneAlerts`.

Do not copy webhook bodies, Attestation bodies, source, diffs, detailed findings, bearer tokens, private keys, or customer Secret Store values into incident notes. Use IDs, counts, digests, reason codes, timestamps, and sanitized request IDs only.

## webhook-backlog

Signal: `webhook-backlog` fires when pending webhook projections exceed the configured backlog count or the oldest pending projection exceeds the age threshold.

Triage:

- Confirm the Worker health endpoint responds.
- Check queue consumer status and recent deployment version.
- Inspect pending webhook projection counts by provider, event type, and received time.
- Confirm GitHub delivery replay protection is still accepting new unique delivery IDs.

Remediation:

- Restart or roll forward the queue consumer if processing is stalled.
- Temporarily reduce batch size if downstream D1 writes are timing out.
- Pause nonessential replay jobs until new GitHub deliveries drain.

Verification:

- Pending count drops below threshold.
- Oldest pending age falls below threshold.
- New signed webhook deliveries produce one Challenge or no-op idempotent result.

## check-dlq

Signal: `check-dlq` fires when Check delivery rows enter `DEAD_LETTER`.

Triage:

- Group dead-letter rows by Check context and `last_error_code`.
- Check whether GitHub Check create/update calls are failing, rate limited, or stale-head rejected.
- Verify retry policy did not exceed max attempts because of a persistent GitHub outage.

Remediation:

- If the current PR head still matches, use the manual replay path.
- If GitHub sent a Check rerequest event, route it through the rerequest replay path.
- If the head moved or Challenge was superseded, leave the old delivery terminal and let the current Challenge publish.

Verification:

- Replayed delivery returns to `PENDING` or `RETRYING`.
- Successful current-head publication moves the delivery to `PUBLISHED`.
- No old-head delivery publishes a success Check.

## verify-failure

Signal: `verify-failure` fires when Attestation verification rejections exceed the configured threshold for a reason code.

Triage:

- Group failures by `reasonCode`, required trust, Challenge status, and affected Check context.
- Confirm whether failures are policy mismatches, current-head races, expired Challenges, revoked keys, or malformed Attestation metadata.
- Compare verification failures with recent Runner Key revoke events and GitHub App installation changes.

Remediation:

- For identity or trust mismatch, ask the user to run the correct Developer or Organization path for the required Check.
- For current-head races or expired Challenges, issue or lease a fresh Challenge for the current PR head.
- For revoked keys, follow `key-revoke` recovery and keep old keys terminal.

Verification:

- The dominant `reasonCode` count falls below threshold.
- A fresh current-head Challenge can verify with the intended trust level.
- No incident note includes Attestation bodies, model output, detailed findings, source, diffs, prompts, completions, or private key material.

## github-api-failure

Signal: `github-api-failure` fires when GitHub API failures exceed the configured threshold inside the configured window.

Triage:

- Confirm the failing category is metadata or Check API only, not Contents, Blob, Tree, Diff, Patch, or PR files.
- Check status code, retryability, request IDs, and current GitHub status without copying response bodies into notes.
- Compare the failure window with Check delivery retry, DLQ, and replay metrics.

Remediation:

- For retryable 429 or 5xx responses, let Check delivery retry/backoff proceed until the configured DLQ boundary.
- For persistent Check create/update failures, move affected deliveries through operator-reviewed replay when GitHub recovers.
- For permission failures, verify GitHub App installation state and expected-source permissions before retrying.

Verification:

- GitHub API failure count falls below threshold.
- Check delivery backlog drains or DLQ rows are manually replayed with current-head verification.
- Egress logs remain limited to method, path template, status code, request ID, latency, and timestamp.

## signature-spike

Signal: `signature-spike` fires when invalid GitHub webhook signatures exceed the configured count inside the configured window.

Triage:

- Confirm only signature-failed projections are increasing.
- Compare deployment time with GitHub App webhook secret rotation time.
- Check for repeated delivery IDs or unknown providers.

Remediation:

- If a secret rotation is in progress, verify the active secret binding and retry a known signed delivery.
- If traffic is hostile or unknown, keep rejecting before JSON projection and preserve only counts, request IDs, and timestamps.
- If the failure is from stale config, roll forward the correct secret reference.

Verification:

- Invalid signature count falls below threshold.
- A fresh signed GitHub delivery reaches normal projection.
- No raw body or signature secret is written to logs, traces, queues, or incident notes.

## key-revoke

Signal: `key-revoke` fires when Runner Key revoke or unregister audit events appear inside the configured window.

Triage:

- Confirm the audit action is `runner_key.revoke` or `runner_key.unregister`.
- Identify affected installation, scope kind, and repository IDs from metadata-only audit resource fields.
- Check whether Organization Runner submissions are returning `RUNNER_REVOKED` before nonce consumption.

Remediation:

- Ask the customer to register a replacement Runner Key and store the replacement private key in their Secret Store.
- Keep revoked keys terminal; do not reactivate old keys.
- Re-run the Organization Runner job with the replacement active key while the Challenge is still current, or lease a fresh Challenge.

Verification:

- Replacement Runner Key is active and scoped to the repository or organization.
- Revoked key submissions continue to fail before nonce consumption.
- Replacement key submission can satisfy the current Organization-required Challenge.
