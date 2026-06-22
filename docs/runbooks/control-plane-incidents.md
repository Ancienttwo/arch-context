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

## device-key-compromise

Signal: a user reports a lost or exposed local Device Key, or verify failures include `DEVICE_REVOKED` after an operator-initiated revoke.

Triage:

- Identify the affected account ID, Device ID, public key ID, and fingerprint from metadata-only Device Key records.
- Check recent Developer Review submissions for the affected Device ID and group rejected attempts by `reasonCode`.
- Confirm whether any active Challenge for the same account and PR head is still unsubmitted.

Remediation:

- Revoke the Device Key through the owner-authorized Device Key revoke API.
- Ask the user to register a replacement Device Key from a trusted local machine.
- Supersede or let expire any active Challenge that was issued before the replacement key was registered.

Verification:

- Submissions signed by the revoked Device Key return `DEVICE_REVOKED` before nonce consumption.
- The replacement Device Key is active and can satisfy a fresh current-head Developer Challenge.
- Incident notes contain only account ID, Device ID, public key ID, fingerprint, reason code, Challenge ID, and timestamps.

## runner-key-compromise

Signal: a customer reports a leaked Runner signing key, or `key-revoke` fires for `runner_key.revoke` / `runner_key.unregister`.

Triage:

- Identify the affected installation, runner ID, scope kind, repository IDs, workflow ref, and public key fingerprint from metadata-only Runner Key records.
- Check whether Organization Runner submissions are returning `RUNNER_REVOKED` before nonce consumption.
- Compare the revoke time with any GitHub Actions runs still using the old runner key reference.

Remediation:

- Revoke or unregister the compromised Runner Key and keep it terminal.
- Ask the customer to register a replacement Runner Key and update their Secret Store reference.
- Re-run Organization Runner only on a fresh current-head Challenge using the replacement active key.

Verification:

- Revoked Runner Key preflight fails and submit returns `RUNNER_REVOKED` without nonce consumption.
- Replacement Runner Key is active, scoped to the repository or organization, and can satisfy the Organization-required Challenge.
- Audit events remain metadata-only and do not include private key material, Secret Store values, or Attestation bodies.

## github-outage

Signal: `github-api-failure` fires for retryable 429 or 5xx Check API responses, or Check delivery rows move to `DEAD_LETTER` during a GitHub incident.

Triage:

- Confirm failing GitHub egress category is `github.check-create`, `github.check-update`, or metadata pull-head only.
- Record status code, retryability, request ID, failure count, and window age without copying response bodies.
- Compare Check delivery retry attempts, DLQ count, and replay eligibility for the current PR head.

Remediation:

- Allow retry/backoff to proceed for retryable failures until the configured DLQ boundary.
- Pause manual replay while GitHub status is degraded unless the customer explicitly needs a current-head retry.
- After GitHub recovers, replay only current-head Check deliveries through the manual ops path.

Verification:

- GitHub API failure count drops below threshold.
- Replayed current-head deliveries return to `PENDING` and then publish `PUBLISHED` success.
- No stale-head or superseded delivery publishes a success Check.

## queue-backlog

Signal: `webhook-backlog` fires for pending webhook age/count, or `check-dlq` fires because Check delivery retries are no longer draining.

Triage:

- Group pending webhook projections by provider, event type, received time, and processed status.
- Group Check delivery rows by Check context, status, attempt count, next attempt time, and last error code.
- Confirm queue consumers are running and recent deploy version matches the expected Worker version.

Remediation:

- Restart or roll forward queue consumers if processing is stalled.
- Reduce batch size or pause nonessential replay jobs if D1 writes are timing out.
- Replay DLQ rows only after verifying the PR head is still current.

Verification:

- Pending webhook count and oldest age fall below threshold.
- Check delivery retry queue drains or DLQ rows are replayed to `PENDING`.
- Queue, trace, and incident records contain only IDs, counts, timestamps, status, reason codes, attempts, and digests.
