# FG5 Control Plane Verification

- Environment: local checkout `/Users/chris/Projects/arch-context`
- Started At: 2026-06-21
- Current slice: FG5-01 through FG5-EG7

## P1 Map

FG5 starts at the durable control-plane boundary. `packages/cloud/cloud-db/src/index.ts` is the executable D1 migration and transaction source, `deploy/sql/0001_archcontext_control_plane.sql` is the deployable SQL surface, and `packages/cloud/cloud-db/test/cloud-db.test.ts` is the first regression gate. `packages/contracts/src/control-plane-routes.ts` is the stable route allowlist, while `packages/cloud/control-plane/src/index.ts` owns the schema-versioned Challenge and key lifecycle API facades used before full durable API handler wiring. `packages/cloud/github-app/src/index.ts` owns Webhook replay projection and GitHub Check DTO idempotency fields. `review_challenges` is the first table because FG3/FG4 already froze Challenge identity, lease, nonce, supersede, and requiredTrust semantics in contracts and control-plane code. `attestations` is the second table because FG3/FG4 already froze Attestation v2 identity, digest, trust, execution origin, and signature semantics. `device_identities`, `runner_identities`, `runner_identity_repositories`, and `runner_key_rotation_windows` carry the durable key lifecycle metadata frozen in FG3/FG4. `check_deliveries` carries the durable Check publication state frozen in FG0 and exercised by FG3/FG4 GitHub App publishers. `webhook_deliveries` carries the metadata-only replay and retention projection frozen in FG2. Retry/DLQ consumers, retention jobs, and observability remain later FG5 slices.

## P2 Trace

The traced path for FG5-01 is SQL generation into a real SQLite/D1-compatible database. `d1MigrationSql()` emits the `review_challenges` table, high-frequency lookup indexes, active identity uniqueness, nonce uniqueness, lease expiry guard, consumed-state guard, and supersede-state guard. The deploy SQL mirrors the generated migration body. The regression test opens an in-memory database, executes the migration, inserts a baseline active Challenge, and then proves duplicate active identity, duplicate nonce, out-of-bounds lease expiry, consumed-at on non-consumed status, and superseded-by on non-superseded status all fail at the database boundary. Terminal retry and parallel Developer/Organization trust rows are accepted.

The traced path for FG5-02 starts from the same executable migration and inserts an Attestation v2 metadata row into `attestations`. The database requires a unique `payload_digest`, enforces one Attestation per `challenge_id`, and uses append-only triggers to abort UPDATE and DELETE attempts. The regression proves duplicate Challenge persistence, duplicate payload digest persistence, invalid payload digest shape, update, and delete all fail after the migration has been applied.

The traced path for FG5-03 applies the same migration and inserts Device and Runner identity metadata. Device identities enforce per-account public key uniqueness, valid display fingerprints, and revoked timestamp semantics. Runner identities enforce per-installation public key uniqueness, valid display fingerprints, active/rotating/revoked timestamp semantics, and termination-kind semantics. Repository scope uses `runner_identity_repositories` instead of an unindexed JSON column, and rotation overlap windows persist in `runner_key_rotation_windows` with an ordering CHECK.

The traced path for FG5-04 inserts Check delivery rows independently from Challenge and Attestation rows. A pending delivery has a stable `delivery_id`, Challenge ID, Check context, head SHA, zero attempts, and no CheckRun ID. A published delivery must have a CheckRun ID. A retrying delivery must have `next_attempt_at`, and a dead-letter delivery must have `last_error_code`. The regression proves valid PENDING, PUBLISHED, RETRYING, and DEAD_LETTER rows insert, while duplicate delivery IDs, missing CheckRun ID, missing retry timestamp, missing DLQ reason, negative attempts, and unknown Check context reject.

The traced path for FG5-05 inserts a webhook delivery projection with provider, delivery ID, event type, projected digest, received time, processed time, and retention delete time. The composite primary key still rejects replay for the same provider/delivery pair, while the same delivery ID from another provider remains valid. The regression proves invalid projected digests, processed-before-received timestamps, and retention-before-received timestamps reject without introducing raw webhook body storage.

The traced path for FG5-06 starts from the route allowlist and enters the schema-versioned Challenge API facade. `createReviewChallengeApi` validates `archcontext.challenge-create-request/v1`, rejects private source/diff fields, checks duplicate active Challenge identity before issuing a Challenge, and stores the metadata-only Challenge state. `get` and `list` read the same Challenge state by ID and identity filters. `lease` claims a Challenge through the existing lease state machine and stores the current lease. `submit` verifies the Attestation against the current pull head and public key, consumes the nonce through the shared nonce-hash set, transitions to `SUBMITTED`, and removes the lease. `cancel` uses the existing status transition guard to move active Challenges to `EXPIRED` and remove any lease.

The traced path for FG5-07 starts from the key lifecycle route allowlist and enters the schema-versioned key API facade. `registerDeviceKeyApi` validates `archcontext.device-key-register-request/v1`, rejects private source fields, requires a Device owner authorization whose account scope matches the target account, and then stores only Device public key metadata. `revokeDeviceKeyApi` reads the current Device identity, requires the same owner account scope, and transitions the key to revoked. `registerRunnerKeyApi`, `rotateRunnerKeyApi`, and `revokeRunnerKeyApi` validate their request versions, then reuse the existing Runner admin authorization guard so repository-scoped Runner Keys require repository admin coverage and organization-scoped Runner Keys require organization admin proof. The same path records metadata-only audit events for Runner register, rotate, and revoke.

The traced path for FG5-08 starts after `submitReviewChallengeAttestation` returns an accepted verifier result. `persistAcceptedReviewChallengeSubmission` requires the accepted result and canonical Attestation digest, maps the Attestation v2 payload into metadata-only persistence fields, and calls `persistAcceptedAttestationSubmission`. The DB transaction begins with a locked Challenge lookup, verifies the nonce hash and `LEASED` status, inserts the append-only Attestation row, then updates the Challenge to `SUBMITTED`, writes `consumed_at`, and clears lease fields. If the Attestation insert fails, the transaction rolls back and leaves the Challenge `LEASED` with its lease intact.

The traced path for FG5-09 starts at three write surfaces. Challenge create computes `apiIdempotencyKeyDigest(routeId,idempotencyKey)` plus a request digest before checking active identity; same key and same body replay the stored Challenge, while same key and a different body throw `api-idempotency-key-conflict`. Webhook delivery replay now computes `webhookDeliveryIdempotencyKey(provider,deliveryId)` and stores the digest key rather than a raw provider/delivery pair. Check delivery computes `checkDeliveryIdempotencyKey(challengeId,checkName,headSha)` for the durable `check_deliveries.delivery_id`, and GitHub Check create sends the same digest as `external_id`.

The traced path for FG5-10 starts after an accepted Attestation submit result. `persistAcceptedReviewChallengeSubmission` derives a pending Check delivery from the Challenge requiredTrust, inserts the append-only Attestation row, inserts a PENDING `check_deliveries` row, and transitions the Challenge to `SUBMITTED` inside the same DB transaction. Only after that transaction returns does `enqueueCheckDelivery` build a metadata-only `github.check-delivery` queue message and call the queue port. The queued message contains delivery ID, Challenge ID, Check context, head SHA, attempt, and payload digest; it does not carry GitHub installation/repository IDs, raw nonce, Attestation body, review details, or code content.

The traced path for FG5-11 starts when a PENDING or RETRYING Check delivery fails publication. `planCheckDeliveryRetry` increments the attempt count, rejects terminal deliveries, stops before scheduling beyond `maxAttempts`, parses Retry-After seconds or HTTP-date input, computes exponential backoff, adds deterministic digest-based jitter, clamps delay to the configured application and Cloudflare Queue bounds, and returns a RETRYING Check delivery with `nextAttemptAt`. `enqueueCheckDelivery` then passes that delay as Cloudflare-compatible `delaySeconds` options while preserving the metadata-only queue message.

The traced path for FG5-12 starts when retry planning reaches the maximum attempts or an operator receives a Check delivery failure. `deadLetterCheckDelivery` moves PENDING/RETRYING deliveries to `DEAD_LETTER`, clears `nextAttemptAt`, preserves attempt count, and records a reason code. The contract state machine now allows only controlled `DEAD_LETTER -> PENDING` recovery, while `replayDeadLetterCheckDelivery` requires replay authorization, resets attempts and error state, and returns a replay digest. `rerequestCheckDelivery` maps GitHub `check_run.rerequested` delivery metadata to the same replay path without widening the queue payload.

The traced path for FG5-13 starts when a queued Check delivery is ready to publish success. `publishCurrentCheckDeliverySuccess` requires a PENDING/RETRYING delivery, matching Challenge ID, matching Check context, a submitted Challenge, and a fresh current PR head verification. Only that path transitions the delivery to `PUBLISHED`, records the CheckRun ID, and transitions the Challenge to `VERIFIED`. Superseded Challenges, old-head races, delivery head mismatches, and Check context mismatches terminate as `DEAD_LETTER` with reason metadata instead of writing a `stale` Check conclusion.

The traced path for FG5-14 starts at `submitReviewChallengeApi` before nonce consumption. The API now requires `resourceAuthorization`, resolves the current Challenge, and calls `authorizeReviewChallengeResourceBinding`. Developer-required Challenges must bind the actor proof to the same installation, repository, pull request, and an active Device identity. Organization-required Challenges must bind the actor proof to the same installation, repository, pull request, Runner identity, and registered workflow ref. Only after that binding passes does the API call the existing Attestation verifier and consume the nonce.

The traced path for FG5-15 starts before route handlers parse or mutate business state. `validateApiRequestLimits` validates route ID, client identity, metadata-only body byte count, request time, optional received time, clock skew, and per-route/client minute window. It stores only a digest-keyed rate window and returns a digest-only validation result. Challenge issuance also calls `validateReviewChallengeExpiryLimits` before creating Challenge state, rejecting invalid or overlong expiry values.

The traced path for FG5-16 starts from `purgeExpiredControlPlaneData`. The purge computes PRD retention cutoffs, opens a SQL transaction, deletes expired Webhook delivery projections by absolute `retention_delete_after`, deletes unfinished active Challenges by creation age, deletes Check deliveries by update age, deletes legacy Attestation audit rows, removes revoked Runner key repository/rotation metadata before the Runner identity row, and deletes pass/fail Attestation metadata through a transaction-scoped `retention_purge_authorizations` row. The Attestation append-only trigger still rejects ordinary DELETE outside that purge context.

The traced path for FG5-17 starts when Runner Key register, rotate, revoke, or unregister calls `recordRunnerKeyAudit`. The event records only action, actor ID, occurred time, runner resource metadata, reason, event ID, and metadata digest. The audit resource keeps runner ID, installation ID, scope kind, repository IDs, and optional related runner ID, but drops actor login, workflow ref, public key ID, and public key fingerprint. `assertControlPlaneAuditEventMinimal` runs before the event enters `auditEvents`, and `auditControlPlaneAuditEvent` rejects non-minimal fields plus source, diff, patch, raw body, and detailed Finding keys.

The traced path for FG5-18 starts at the existing control-plane write paths. `submitReviewChallengeApi` records Challenge age, verify latency, and reject reason samples after Attestation verification returns. `planCheckDeliveryRetry` records delivery lag and retry counter samples when a retry is scheduled. `deadLetterCheckDelivery` and rejected Check publication paths record delivery lag plus reject reason counters, while successful Check publication records delivery lag. Every sample is a metadata-only `ControlPlaneMetricSample` with stable digest and allowlisted labels.

The traced path for FG5-19 starts when an operator or scheduled monitor calls `evaluateControlPlaneAlerts`. The evaluator reads metadata-only backlog counts, Check delivery rows, signature-failure counters, and Runner Key audit events. It emits `webhook-backlog`, `check-dlq`, `signature-spike`, and `key-revoke` alerts with summary, labels, numeric metrics, stable digest, and a runbook pointer to `docs/runbooks/control-plane-incidents.md`. The linked runbook gives triage, remediation, and verification steps without copying webhook bodies, Attestation bodies, detailed findings, tokens, or private key material into incident notes.

The traced path for FG5-20 starts from the current route and schema constants rather than a handwritten API inventory. `docs/api/control-plane-openapi.yaml` documents the metadata-only Webhook, Challenge, Device Key, and Runner Key routes exposed by `CONTROL_PLANE_ROUTES`, and records the current Challenge and Key request schema versions with `x-archcontext-schemaVersion`. `docs/api/control-plane-compatibility-policy.md` freezes versioning, breaking-change, privacy, deprecation, schema inventory, and verification rules. The control-plane regression reads both documents, checks route and schema-version coverage against runtime constants, verifies required schema inventory entries, and rejects API docs that introduce private-content-shaped terms.

The traced path for FG5-EG1 starts with a file-backed SQLite database standing in for D1 persistence rather than an in-memory database. The integration test runs the generated migration, writes a Device identity, Runner identity, Runner repository scope, leased Challenge, accepted Attestation, and pending Check delivery, then closes the database to simulate service restart. A new connection opens the same file, reruns the idempotent migration, and reads back the submitted Challenge state, Attestation payload digest, Device Key metadata, Runner Key metadata, repository scope, and pending delivery state. The same reopened database still rejects ordinary Attestation deletion through the append-only trigger.

The traced path for FG5-EG2 starts with two independent file-backed SQLite connections over the same D1-compatible database file. The first connection records a GitHub Webhook delivery; the second connection attempts the same provider/delivery ID and the durable primary key leaves one Webhook projection. The first connection then persists an accepted Attestation submit and pending Check delivery; the second connection retries the same submit input and observes `review-challenge-not-submittable` after the Challenge is already `SUBMITTED`, leaving one Attestation and one Check delivery. Finally, both connections attempt to create the same Check delivery ID derived from Challenge/check/head metadata, and the durable primary key leaves one pending delivery row.

The traced path for FG5-EG3 starts at the deployed staging Worker on `archcontext.repoharness.com`. A signed local readback request calls the HMAC-protected staging-only route `/v1/fg5/check-delivery/failure-injection`, which uses the real `ControlPlane` retry, DLQ, replay, and queue-message builders instead of a test-only stub. The injected path simulates two GitHub Check update `503` responses, applies Retry-After and deterministic backoff, enqueues delayed metadata-only retry messages, reaches the configured max attempt boundary, moves the delivery to `DEAD_LETTER` with `CHECK_DELIVERY_MAX_ATTEMPTS`, replays it through manual ops authorization, and enqueues a fresh PENDING delivery. The readback evidence is written to `docs/verification/fg5-check-failure-readback.json` and re-inspected locally for retry/DLQ/replay shape plus zero secret, code-content, forbidden endpoint, raw body, token, nonce, diff, patch, blob, or tree markers.

The traced path for FG5-EG4 starts inside `persistAcceptedAttestationSubmission`. The function opens `BEGIN IMMEDIATE`, locks and validates the leased Challenge nonce, inserts the accepted Attestation row, optionally inserts the pending Check delivery row, updates the Challenge to `SUBMITTED`, writes `consumed_at`, clears lease fields, and commits. The fault-injection regression wraps the same SQLite database with a statement-level failure shim. One injected failure aborts `INSERT INTO check_deliveries` after the Attestation insert has already run; another aborts `UPDATE review_challenges` after both the Attestation and Check delivery inserts have run. In both cases, the rollback leaves the Challenge in `LEASED`, keeps `consumed_at` null, preserves lease owner/expiry, and leaves zero Attestation and zero Check delivery rows for that Challenge.

The traced path for FG5-EG5 starts by creating remote Cloudflare D1 database `archcontext-control-plane-staging`, binding it to staging Worker config as `CONTROL_PLANE_DB`, and applying `deploy/sql/0001_archcontext_control_plane.sql` through `wrangler d1 execute --remote`. `scripts/fg5-retention-staging-readback.ts` seeds a time-shift fixture directly into the remote D1 with expired and recent Webhook projections, unfinished and terminal Challenges, verified and rejected Attestations, legacy Attestation audit rows, Check deliveries, revoked Runner identities, repository scope rows, and rotation windows. A normal DELETE against a recent Attestation is attempted first and must fail through the append-only trigger. The script then runs a D1-supported retention purge SQL file using the same PRD cutoffs, authorizes only retention Attestation deletes, clears that authorization, reads back the row matrix, and writes `docs/verification/fg5-retention-staging-readback.json`. The verified result shows every expired row deleted, every recent or audit-min row preserved, expired Runner scope/rotation rows removed before the revoked identity, and `retention_purge_authorizations` returned to zero.

The traced path for FG5-EG6 starts at the metadata-only alert evaluator rather than a live dashboard vendor. `evaluateControlPlaneAlerts` receives four bounded incident inputs: webhook backlog count/age, Attestation verify failure count plus reason code, Check delivery DLQ rows, and GitHub API failure count/status/retryability inside a time window. It emits normalized alert kinds, labels, numeric metrics, stable metadata digests, and runbook pointers. `scripts/fg5-control-plane-incident-drill.ts` then turns those alerts into a dashboard matrix with one row each for webhook, verify, queue, and GitHub API incidents, verifies every row links to the matching runbook section, and writes `docs/verification/fg5-control-plane-incident-drill.json` with zero secret and code-content marker hits.

The traced path for FG5-EG7 starts from the same D1 migration and control-plane privacy projectors used by production paths. `scripts/fg5-full-plane-dlp-readback.ts` creates an in-memory SQLite/D1-compatible database, applies `d1MigrationSql()`, seeds representative metadata rows for accounts, installation, Device Key, Runner Key, Webhook delivery, Challenge, Attestation, legacy Attestation audit, and Check delivery, then exports every control-plane table. The same script sends bait payload fields through `projectLogRecord`, `projectTraceRecord`, `projectQueuePayload`, `projectErrorObject`, and `buildCheckDeliveryQueueMessage`. It scans database, log, trace, queue, and error exports for code-content keys, bait values, forbidden GitHub content endpoints/media, forbidden bait keys, and secret markers, then writes `docs/verification/fg5-full-plane-dlp-readback.json`.

## P3 Decision

The migration keeps active identity uniqueness partial over `PENDING`, `LEASED`, and `SUBMITTED` rather than globally unique over all historical rows. The invariant is that only one active Challenge may exist for the same installation/repository/PR/head/requiredTrust, while terminal rows do not block a legitimate retry or audit history. The first 10x pressure point is query and lease scanning under webhook bursts; this slice adds current lookup and lease-expiry indexes, while durable API transactions and idempotency keys remain FG5-06 through FG5-10.

Attestation storage uses a unique `payload_digest` and append-only triggers rather than storing the raw submission body. The invariant is that Cloud can deduplicate and audit the exact submitted payload shape without retaining any code, finding text, prompt, or raw body. The first 10x pressure point is idempotent submit under duplicate clients; this slice gives the durable table the necessary uniqueness guards, while the API-level idempotency response path remains FG5-08 and FG5-09.

Runner repository scope is normalized into an association table instead of keeping `repository_numeric_ids_json`. The invariant is that runner lookup for a repository-scoped key must be indexable and auditable without JSON scans or private key material. The first 10x pressure point is runner lookup during Organization Attestation submit; this slice gives the durable shape and indexes, while transactionally reading these rows during submit remains FG5-07 and FG5-08.

Check delivery is stored as a separate state machine instead of mutating Challenge or Attestation rows. The invariant is that publication retry/DLQ behavior can proceed without reopening an accepted Attestation transaction or corrupting Challenge state. The first 10x pressure point is queue retry scheduling; this slice adds the `status,next_attempt_at` and head/context indexes, while worker retry, jitter, and replay remain FG5-11 through FG5-13.

Webhook delivery storage keeps the raw body retention policy at zero by storing only projected metadata and a digest. The invariant is replay protection plus retention auditability without retaining raw GitHub payloads. The first 10x pressure point is retention sweep performance; this slice adds an explicit `retention_delete_after` index, while the actual retention worker remains FG5-16.

Challenge API uses explicit request schema versions rather than accepting unversioned objects. The invariant is that API clients can evolve without weakening the privacy contract or bypassing Challenge state transitions. The first 10x pressure point is duplicate client retries and durable restart recovery; this slice freezes the API contract and in-process transition behavior, while stable idempotency response replay and D1 transaction wiring remain FG5-08 and FG5-09.

Key lifecycle API keeps Device owner authorization separate from Runner admin authorization. The invariant is that a local user may manage their own Device key through account ownership, while Organization Runner keys require GitHub installation plus repository or organization admin scope. The first 10x pressure point is delegated admin and installation membership drift; this slice preserves the scope contract at the API boundary, while live GitHub permission readback and durable transaction joins remain later FG5 authorization work.

Attestation submit persistence uses a transaction helper instead of separate ad hoc DB writes. The invariant is that an accepted Attestation cannot exist without a consumed Challenge, and a consumed Challenge cannot be left behind if Attestation persistence fails. The first 10x pressure point is duplicate submits under retry and webhook races; this slice establishes atomic persistence and rollback, while idempotent response replay remains FG5-09.

Stable idempotency keys are scoped per write surface instead of using one global string namespace. The invariant is that retries are replayable inside their own route/provider/check context, while conflicting request bodies remain visible as conflicts. The first 10x pressure point is queue retry and GitHub API partial failure; this slice freezes deterministic keys for API, Webhook, and Check writes, while retry/DLQ policy remains FG5-11 through FG5-12.

Check publication is split into durable delivery creation and asynchronous queue send rather than calling GitHub during Attestation submit. The invariant is that accepted Attestation verification and nonce consumption are not blocked or rolled back by GitHub Check API latency or queue send failure after commit. The first 10x pressure point is pending delivery backlog under GitHub outage; this slice leaves DLQ and replay policy to FG5-12.

Check delivery retry planning uses deterministic jitter instead of runtime randomness. The invariant is that retry scheduling is reproducible in tests and does not use predictable `Math.random()` in Worker code, while still avoiding synchronized retry spikes. Retry-After is treated as a lower bound on delay but remains capped by the application policy and the Cloudflare Queue delay ceiling.

Dead-letter recovery is explicit rather than implicit retry. The invariant is that `PUBLISHED` remains terminal, automatic retry stops at max attempts, and only manual ops or GitHub Check rerequest can reset a dead-lettered delivery back to PENDING. This keeps replay auditable, and FG5-EG3 proves the path through staging failure injection without requiring a real GitHub outage.

Current-head publication stays in the control plane rather than the GitHub adapter. The invariant is that GitHub API DTO code remains a thin allowlisted transport, while the governance decision that a success Check represents the current PR head is made against Challenge, delivery, and current pull-head metadata before the durable delivery becomes `PUBLISHED`.

Resource binding authorization is a separate guard rather than another field inside Attestation verification. The invariant is that cryptographic Attestation validity, current-head freshness, and caller/resource authority fail independently with clear reasons. At 10x scale, the first pressure point is live GitHub permission drift; this slice freezes the local authorization contract and leaves live permission readback to the later staging/ops work.

API request limits are implemented as a control-plane guard rather than embedded inside individual business methods. The invariant is that rate, body, skew, and expiry failures happen before private payload projection, nonce consumption, or persistent state mutation. The first 10x pressure point is distributed rate-limit coordination; this slice keeps deterministic single-process semantics ready for later D1/KV-backed windows.

Retention deletion is implemented in `cloud-db` instead of the GitHub App or control-plane UI. The invariant is that retention acts on durable metadata tables using explicit cutoffs and does not widen the privacy surface. Attestation keeps append-only behavior for normal callers; only the retention path can authorize deletion for expired rows, and FG5-EG5 proves this against remote staging D1.

Audit minimization is enforced at the control-plane event boundary rather than relying only on downstream log projection. The invariant is that audit history can answer who acted, what action happened, which resource was affected, why it happened, and what digest identifies the event, without retaining code, detailed findings, login aliases, workflow refs, or key fingerprints. At 10x scale, the first pressure point is durable audit querying; this slice keeps the schema minimal before that storage is introduced.

Metrics stay inside the control-plane domain instead of importing an observability SDK. The invariant is that operational signals are emitted as deterministic metadata samples that can later be exported to Cloudflare Analytics, logs, or a dashboard without widening the privacy surface. At 10x scale, the first pressure point is aggregating these samples across Workers and queues; this slice freezes the names, units, labels, and source paths first.

Alerts are evaluated from bounded metadata instead of directly reading logs or queue payloads. The invariant is that incident response can identify webhook, verify, queue, GitHub API, signature, and key-revocation failures using counts, reason codes, timestamps, status codes, retryability, and runbook links, while the alert itself remains safe to store or forward. At 10x scale, the first pressure point is routing these alerts to a real paging provider and dashboard, which remains FG6 work.

API compatibility is documented before every route is backed by the final durable handler. The invariant is that clients, docs, and schema-version policy align on the current metadata-only control-plane surface before staging hardening starts. The first 10x pressure point is generated OpenAPI parity from TypeScript sources when the handler surface stabilizes; this slice keeps the compatibility contract explicit without widening runtime behavior.

Durable restart proof stays in `cloud-db` instead of the higher-level API facade. The invariant is that service restart durability is a database property: rows, indexes, and triggers must survive connection teardown and idempotent migration replay before Worker handler wiring can claim reliability. At 10x scale, the first pressure point is multi-worker concurrency and duplicate delivery races, which remains FG5-EG2 rather than being hidden inside this restart proof.

Duplicate-message idempotency is proven at the durable write boundary rather than by timing-dependent JavaScript concurrency. The invariant is that Webhook delivery IDs, accepted Attestation submission state, and Check delivery IDs remain single-result even when another Worker connection retries the same logical write. FG5-EG3 now covers the injected GitHub API failure and replay workflow, and FG5-EG4 covers partial transaction failure around Attestation persistence and nonce consumption.

Staging Check failure injection stays behind a signed readback route rather than widening the public GitHub webhook path. The invariant is that an operator can prove retry, DLQ, replay, and queue payload privacy on the deployed Worker without storing or returning secrets, raw webhook bodies, PR file data, or real GitHub installation tokens. At 10x scale, the first pressure point is replacing this bounded readback with durable queue/DLQ drill automation and alert correlation, which remains FG5-EG6 and FG6 work.

Transaction fault injection stays at the `cloud-db` boundary instead of adding test-only hooks to production persistence code. The invariant is that Attestation insert, Check delivery creation, Challenge nonce consumption, and lease clearing are one SQLite/D1 transaction; any injected statement failure must leave all four surfaces in the pre-submit state. At 10x scale, the first pressure point is remote D1 transaction latency and retry classification, but this slice proves the local atomicity contract before adding worker-level retry orchestration.

The staging retention readback uses Wrangler D1 execution rather than a Worker-only in-memory simulation. The invariant is that deletion and preservation are proven on the same remote D1 product that will hold control-plane metadata. D1 remote execution rejects raw SQL `BEGIN IMMEDIATE`; this readback therefore exercises D1-supported sequential purge SQL while local `cloud-db` tests retain the transaction semantics for the production helper.

The incident drill stays as a deterministic evidence script instead of adding a dashboard service in FG5. The invariant is that the operational taxonomy and runbook linkage are proven first: each incident class must map to an alert kind, metrics, surface label, and runbook section without storing private payloads. At 10x scale, the first pressure point is alert aggregation and notification routing, but this slice is sufficient for EG6 because it validates the dashboard contract and evidence shape before picking a vendor surface.

The full-plane DLP scan is deterministic and local rather than another remote staging mutation. The invariant is that durable DB export and DTO projectors reject the same bait and forbidden key classes before any vendor-specific exporter sees them. Remote D1 retention and Check failure staging paths are already proven in EG3 and EG5; EG7 closes the privacy invariant by scanning the control-plane data plane itself, including the exported rows and queue/log/trace projections.

## Scope

- `review_challenges` keeps metadata-only fields for installation, repository, PR, head/base SHA, requiredTrust, policy profile, nonce hash, status, lease, supersede, and consumption timestamps.
- `nonce_hash` is unique; raw `nonce` is not stored.
- `ux_review_challenges_active_identity` rejects duplicate active rows for the same Challenge identity.
- `idx_challenges_current_lookup`, `idx_challenges_status_expiry`, and `idx_challenges_lease_expiry` cover current Challenge lookup, expiry scans, and lease recovery.
- Deploy SQL parity is checked against generated migration SQL.
- `attestations` stores Attestation v2 metadata plus a unique `payload_digest`.
- `ux_attestations_challenge` enforces one accepted Attestation row per Challenge.
- `ux_attestations_payload_digest` enforces stable payload-level dedupe.
- `trg_attestations_append_only_no_update` and `trg_attestations_append_only_no_delete` reject mutation after insert.
- `device_identities` enforces display fingerprint shape and active/revoked timestamp consistency.
- `runner_identities` stores runner scope kind, workflow ref, public key ID/fingerprint, lifecycle status, and termination kind.
- `runner_identity_repositories` stores repository scope rows with a composite primary key.
- `runner_key_rotation_windows` stores previous/next runner IDs and an ordered overlap window.
- `check_deliveries` stores independent Check state, attempt count, retry timestamp, last error code, Check context, and CheckRun ID.
- `idx_check_deliveries_challenge`, `idx_check_deliveries_next_attempt`, `idx_check_deliveries_head_context`, and `idx_check_deliveries_retention` cover Challenge lookup, retry scheduling, head/context dedupe, and retention scans.
- `webhook_deliveries` stores provider, delivery ID, event type, projected digest, received/processed timestamps, and retention delete timestamp.
- `(provider, delivery_id)` remains the replay primary key.
- `idx_webhook_deliveries_event_type` and `idx_webhook_deliveries_retention` cover operational lookup and retention scans.
- `CONTROL_PLANE_ROUTES` now exposes `GET /v1/challenges`, `POST /v1/challenges`, `GET /v1/challenges/:challenge`, `POST /v1/challenges/:challenge/lease`, `POST /v1/challenges/:challenge/attestations`, and `POST /v1/challenges/:challenge/cancel`.
- `CONTROL_PLANE_ROUTES` now exposes `POST /v1/device-keys`, `POST /v1/device-keys/:device/revoke`, `POST /v1/runner-keys`, `POST /v1/runner-keys/:runner/rotate`, and `POST /v1/runner-keys/:runner/revoke`.
- `CHALLENGE_API_REQUEST_SCHEMA_VERSIONS` freezes create/get/list/lease/submit/cancel request versions.
- `KEY_API_REQUEST_SCHEMA_VERSIONS` freezes Device register/revoke and Runner register/rotate/revoke request versions.
- Challenge API requests reject private source, diff, patch, prompt, completion, raw body, and similar content fields.
- Key lifecycle API requests reject private source, diff, patch, prompt, completion, raw body, and similar content fields.
- `createReviewChallengeApi` rejects duplicate active Challenge identity before issuing a new Challenge.
- `claimReviewChallengeApi`, `submitReviewChallengeApi`, and `cancelReviewChallengeApi` persist the in-process Challenge and lease state transitions through the API facade.
- `registerDeviceKeyApi` and `revokeDeviceKeyApi` require owner authorization scoped to the target account.
- `registerRunnerKeyApi`, `rotateRunnerKeyApi`, and `revokeRunnerKeyApi` reuse Runner repository/organization admin authorization and audit recording.
- `persistAcceptedAttestationSubmission` wraps Challenge lookup, Attestation insert, and Challenge submit transition in one SQL transaction.
- `persistAcceptedReviewChallengeSubmission` maps accepted verifier output to append-only Attestation metadata and uses the canonical Attestation digest as `payload_digest`.
- Accepted submit persistence clears `lease_owner` and `lease_expires_at` after transitioning the Challenge to `SUBMITTED`.
- `apiIdempotencyKeyDigest` and the control-plane `apiIdempotencyRecords` ledger make Challenge create replayable without storing the raw client key.
- `webhookDeliveryIdempotencyKey` makes GitHub Webhook replay keys digest-based.
- `checkDeliveryIdempotencyKey` derives stable Check delivery IDs from Challenge ID, Check context, and head SHA.
- GitHub Check create sends Check delivery idempotency digest as `external_id`.
- Accepted submit persistence now writes a PENDING `check_deliveries` row in the same DB transaction as Attestation persistence and Challenge transition.
- `CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION`, `CheckDeliveryQueuePort`, and `CloudflareCheckDeliveryQueuePort` define the async Check delivery queue boundary without importing GitHub API calls into the submit transaction.
- `enqueueCheckDelivery` sends only metadata-only `github.check-delivery` queue messages after the DB transaction returns.
- `DEFAULT_CHECK_DELIVERY_RETRY_POLICY` defines bounded max attempts, base delay, max delay, and jitter ratio.
- `planCheckDeliveryRetry` returns RETRYING delivery state with `attemptCount`, `nextAttemptAt`, Retry-After handling, deterministic jitter, and max-attempt stop conditions.
- `enqueueCheckDelivery` passes Cloudflare-compatible `delaySeconds` send options for retry scheduling.
- `CHECK_DELIVERY_STATUS_TRANSITIONS` now allows controlled `DEAD_LETTER -> PENDING` recovery while keeping `PUBLISHED` terminal.
- `CHECK_DELIVERY_FAILED` and `CHECK_DELIVERY_MAX_ATTEMPTS` reason codes cover Check delivery retry and DLQ paths.
- `deadLetterCheckDelivery`, `replayDeadLetterCheckDelivery`, and `rerequestCheckDelivery` implement DLQ, manual replay, and GitHub Check rerequest recovery without adding code-bearing queue fields.
- `publishCurrentCheckDeliverySuccess` allows Check delivery success publication only for the submitted Challenge matching the current PR head.
- Stale, superseded, head-mismatched, and context-mismatched delivery attempts become `DEAD_LETTER` with `CHALLENGE_SUPERSEDED`, `HEAD_SHA_MISMATCH`, or `TRUST_LEVEL_MISMATCH` reason metadata.
- Successful current-head publication records `checkRunId`, clears retry/error fields, marks the delivery `PUBLISHED`, and moves the Challenge from `SUBMITTED` to `VERIFIED`.
- `ReviewChallengeResourceBindingAuthorization` records actor proof for installation, repository, pull request, Device, Runner, and workflow-ref binding without storing tokens.
- `authorizeReviewChallengeResourceBinding` validates Developer Challenge submissions against an active Device identity.
- `authorizeReviewChallengeResourceBinding` validates Organization Challenge submissions against a scoped Runner identity and workflow ref.
- `submitReviewChallengeApi` requires resource authorization before invoking Attestation verification or consuming the Challenge nonce.
- `WORKER_LIMITS` now includes `maxClockSkewMs`.
- `validateApiRequestLimits` enforces body byte, per-route/client rate, and clock-skew limits using digest-keyed client/window state.
- `validateReviewChallengeExpiryLimits` rejects invalid Challenge expiry and TTL values greater than `MAX_REVIEW_CHALLENGE_TTL_MS`.
- `issueReviewChallenge` calls the expiry guard before creating Challenge state.
- `DEFAULT_CONTROL_PLANE_RETENTION_DAYS` freezes PRD defaults for Webhook delivery, unfinished Challenge, verified/rejected Attestation, legacy Attestation audit rows, Check delivery, revoked Runner key metadata, raw body, and private content retention.
- `retention_purge_authorizations` allows only transaction-scoped retention deletion of Attestation rows while preserving ordinary append-only DELETE rejection.
- `purgeExpiredControlPlaneData` deletes expired Webhook projections, unfinished Challenges, verified/rejected Attestations, legacy audit rows, Check deliveries, revoked Runner identities, repository scope rows, and rotation windows.
- Deploy SQL remains generated from the same D1 migration surface.
- `CONTROL_PLANE_AUDIT_EVENT_FIELDS` freezes the allowed audit event top-level fields.
- `ControlPlaneAuditEvent.actor` stores only actor ID and no login alias.
- Runner Key audit resource metadata keeps runner ID, installation ID, scope kind, repository IDs, and related resource ID only.
- `recordRunnerKeyAudit` calls `assertControlPlaneAuditEventMinimal` before appending an audit event.
- `auditControlPlaneAuditEvent` rejects non-minimal fields and code, diff, patch, raw body, or detailed Finding fields.
- `ControlPlaneMetricSample` freezes metadata-only metric samples with name, value, unit, timestamp, labels, and digest.
- `submitReviewChallengeApi` records `challenge_age_ms`, `verify_latency_ms`, and `reject_reason_total`.
- `planCheckDeliveryRetry` records `check_delivery_lag_ms` and `check_delivery_retry_total` for scheduled retries.
- `deadLetterCheckDelivery` and Check publication rejection record `reject_reason_total`.
- Metric labels are allowlisted and reject private-content-shaped values before a sample is stored.
- `evaluateControlPlaneAlerts` emits metadata-only `webhook-backlog`, `check-dlq`, `signature-spike`, and `key-revoke` alerts.
- Alert thresholds cover webhook pending count/age, Check DLQ count, invalid signature count/window, and key revoke count/window.
- Alert labels and metrics are normalized and reject non-allowlisted or private-content-shaped values.
- `docs/runbooks/control-plane-incidents.md` documents triage, remediation, and verification for every FG5-19 alert kind.
- `docs/api/control-plane-openapi.yaml` documents the current metadata-only Control Plane API routes for Webhook intake, Challenge lifecycle, Device Key lifecycle, and Runner Key lifecycle.
- OpenAPI operation extensions record all current Challenge and Key request schema versions.
- `docs/api/control-plane-compatibility-policy.md` defines API versioning, breaking-change, privacy, deprecation, schema inventory, and verification policy.
- FG5-EG1 file-backed integration persists Challenge, Attestation, Device Key, Runner Key, Runner repository scope, and Check Delivery state across database close/reopen.
- FG5-EG1 reruns D1 migration SQL after reopen to prove startup migration idempotency does not drop state.
- FG5-EG1 verifies the Attestation append-only trigger still rejects ordinary deletion after restart.
- FG5-EG2 uses two independent file-backed DB connections to prove duplicate Webhook writes leave one projection row.
- FG5-EG2 proves duplicate accepted Attestation submit retries leave one submitted Challenge, one Attestation row, and one Check delivery.
- FG5-EG2 proves duplicate Check delivery writes using the same deterministic delivery ID leave one pending delivery row.
- Staging Worker exposes `/v1/fg5/check-delivery/failure-injection` only when `ARCHCONTEXT_ENV=staging`.
- The FG5 readback route requires `x-archcontext-readback-timestamp` and HMAC `x-archcontext-readback-signature` derived from the existing staging webhook secret.
- The deployed FG5 readback injects GitHub Check update `503` failures, schedules two retry queue messages, stops at max attempts, dead-letters, manually replays, and enqueues a fresh PENDING delivery.
- `docs/verification/fg5-check-failure-readback.json` stores only metadata, digests, state transitions, retry delays, and queue message metadata.
- FG5-EG3 privacy checks require zero secret markers, code-content markers, forbidden endpoint/media markers, and forbidden keys in the staging readback recording.
- FG5-EG4 injects a failure at pending Check delivery insert after Attestation insert has run.
- FG5-EG4 injects a failure at Challenge update/nonce consume after Attestation and Check delivery inserts have run.
- Both FG5-EG4 injected failures prove rollback leaves the Challenge leased, `consumed_at` null, original lease fields intact, and zero Attestation/Check delivery rows for the failed Challenge.
- `wrangler.jsonc` binds remote D1 `archcontext-control-plane-staging` as `CONTROL_PLANE_DB` for staging.
- FG5-EG5 applies `deploy/sql/0001_archcontext_control_plane.sql` to remote D1 before the time-shift fixture.
- FG5-EG5 seeds expired and recent rows for Webhooks, unfinished Challenges, verified/rejected Attestations, legacy Attestation audits, Check deliveries, revoked Runner identities, Runner repository scope, and Runner rotation windows.
- FG5-EG5 proves ordinary Attestation DELETE is still rejected before retention authorization.
- FG5-EG5 proves retention deletes expired rows, preserves recent and terminal audit-min rows, removes expired Runner dependent rows before revoked identity rows, and leaves `retention_purge_authorizations` empty.
- `evaluateControlPlaneAlerts` now emits `verify-failure` alerts with reason-code labels and failure-count thresholds.
- `evaluateControlPlaneAlerts` now emits `github-api-failure` alerts with status code, retryability, and window-age metrics.
- `docs/runbooks/control-plane-incidents.md` documents triage, remediation, and verification sections for `verify-failure` and `github-api-failure`.
- `scripts/fg5-control-plane-incident-drill.ts` produces a metadata-only incident dashboard matrix for webhook, verify, queue, and GitHub API failure classes.
- `docs/verification/fg5-control-plane-incident-drill.json` records alert kinds, alert metadata, dashboard rows, runbook links, metric keys, and privacy scan counts.
- `scripts/fg5-full-plane-dlp-readback.ts` applies the D1 migration and exports all 13 control-plane tables from a representative local D1-compatible database.
- FG5-EG7 database export covers metadata rows for account, subscription, installation, Device identity, Runner identity, Runner repository scope, Webhook delivery, Challenge, Attestation, legacy Attestation audit, and Check delivery.
- FG5-EG7 log, trace, queue, and error exports are generated through the same `ControlPlane` privacy projectors used by runtime code.
- FG5-EG7 queue export includes a real Check delivery queue message with `archcontext.check-delivery-queue-message/v1`.
- FG5-EG7 scan requires zero code-content, bait value, forbidden bait key, forbidden endpoint/media, and secret marker hits on database, log, trace, and queue exports.

## Results

- `bun test packages/cloud/cloud-db/test/cloud-db.test.ts`: PASS, 16 tests / 225 expects.
- `bun test packages/cloud/control-plane/test/control-plane.test.ts`: PASS, 34 tests / 445 expects.
- `bun test packages/cloud/github-app/test/github-app.test.ts`: PASS, 31 tests / 207 expects.
- `bun test scripts/sprint-status-check.test.ts packages/cloud/cloud-db/test/cloud-db.test.ts packages/cloud/control-plane/test/control-plane.test.ts packages/cloud/github-app/test/github-app.test.ts deploy/cloudflare/fg2-staging-worker.test.ts scripts/fg5-check-failure-readback.test.ts scripts/fg5-retention-staging-readback.test.ts scripts/fg5-control-plane-incident-drill.test.ts scripts/fg5-full-plane-dlp-readback.test.ts`: PASS, 111 tests / 965 expects.
- `bun test deploy/cloudflare/fg2-staging-worker.test.ts scripts/fg5-check-failure-readback.test.ts`: PASS, 9 tests / 46 expects.
- `bun test scripts/fg5-retention-staging-readback.test.ts`: PASS, 2 tests / 6 expects.
- `bun test scripts/fg5-control-plane-incident-drill.test.ts`: PASS, 2 tests / 5 expects.
- `bun test scripts/fg5-full-plane-dlp-readback.test.ts`: PASS, 2 tests / 6 expects.
- `bun run typecheck`: PASS.
- `wrangler --version`: PASS, 4.74.0.
- `wrangler d1 create archcontext-control-plane-staging --config wrangler.jsonc`: PASS, created database `27f60a8d-e93a-4e7a-b7cc-035f4f842b26`.
- `wrangler d1 execute archcontext-control-plane-staging --remote --file deploy/sql/0001_archcontext_control_plane.sql --config wrangler.jsonc`: PASS, 41 queries, 13 tables.
- `wrangler deploy --dry-run --env staging --config wrangler.jsonc`: PASS, bundle upload 207.50 KiB / gzip 40.58 KiB.
- `bun run deploy:fg2:staging`: PASS, deployed `archcontext-fg2-staging` version `036ef059-8820-44c5-b73f-d1983afeb8fd` to `archcontext.repoharness.com` with `CONTROL_PLANE_DB`.
- `bun run readback:fg5:check-failure`: PASS, `docs/verification/fg5-check-failure-readback.json` status `verified`.
- `bun run readback:fg5:retention`: PASS, `docs/verification/fg5-retention-staging-readback.json` status `verified`.
- `bun run readback:fg5:incident-drill`: PASS, `docs/verification/fg5-control-plane-incident-drill.json` status `verified`.
- `bun scripts/fg5-control-plane-incident-drill.ts inspect --evidence docs/verification/fg5-control-plane-incident-drill.json --json`: PASS, `ok: true`.
- `bun run readback:fg5:full-plane-dlp`: PASS, `docs/verification/fg5-full-plane-dlp-readback.json` status `verified`.
- `bun scripts/fg5-full-plane-dlp-readback.ts inspect --evidence docs/verification/fg5-full-plane-dlp-readback.json --json`: PASS, `ok: true`.
- `bun test packages/contracts/test/contracts.test.ts packages/cloud/control-plane/test/control-plane.test.ts`: PASS, 127 tests / 786 expects.
- `bun run verify:acceptance-ledger`: PASS, 162 entries.
- `bun run check:sprint`: PASS.
- `git diff --check`: PASS.
- `bun run verify`: PASS, 485 tests / 2891 expects.

## Negative Tests

- Duplicate active Challenge identity rejects.
- Duplicate `nonce_hash` rejects.
- Terminal retry row with the same Challenge identity is allowed.
- Developer and Organization requiredTrust rows can coexist for the same head.
- `lease_expires_at` cannot exceed Challenge `expires_at`.
- `consumed_at` requires `SUBMITTED`, `VERIFIED`, or `REJECTED`.
- `superseded_by` requires `SUPERSEDED`.
- Deploy SQL must remain in parity with generated migration SQL.
- Duplicate Attestation `challenge_id` rejects.
- Duplicate Attestation `payload_digest` rejects.
- Invalid Attestation `payload_digest` shape rejects.
- Attestation UPDATE rejects.
- Attestation DELETE rejects.
- Duplicate Device public key ID rejects per account.
- Invalid Device and Runner fingerprint shape rejects.
- Active Device with `revoked_at` rejects, and revoked Device without `revoked_at` rejects.
- Duplicate Runner public key ID rejects per installation.
- Rotating Runner without `rotated_at` rejects.
- Revoked Runner without `revoked_at` rejects.
- Runner termination kind without revoked status rejects.
- Duplicate runner repository scope row rejects.
- Rotation overlap window must end after `rotated_at`.
- Duplicate Check delivery ID rejects.
- Published Check delivery without `check_run_id` rejects.
- Retrying Check delivery without `next_attempt_at` rejects.
- Dead-letter Check delivery without `last_error_code` rejects.
- Negative Check delivery attempt count rejects.
- Unknown Check delivery context rejects.
- Duplicate Webhook provider/delivery ID rejects.
- Same Webhook delivery ID under another provider is allowed.
- Invalid Webhook projected digest rejects.
- Webhook `processed_at` before `received_at` rejects.
- Webhook `retention_delete_after` before `received_at` rejects.
- Wrong Challenge API request schema version rejects.
- Challenge API request with private `diff` content rejects.
- Duplicate active Challenge identity rejects through the API facade.
- Accepted Challenge API submit clears the active lease.
- Challenge API replay submit rejects with `CHALLENGE_ALREADY_CONSUMED`.
- Challenge API cancel uses the status transition guard and rejects repeat cancel.
- Device Key API owner account mismatch rejects.
- Device Key API request with private `sourceCode` content rejects.
- Wrong Key API request schema version rejects.
- Runner Key API repository admin scope mismatch rejects.
- Runner Key API rotate records a rotating previous key, active replacement key, and overlap window.
- Runner Key API revoke records metadata-only audit action.
- Attestation submit transaction rejects wrong Challenge nonce hash before persistence.
- Attestation submit transaction rejects already consumed or non-leased Challenge state.
- Invalid Attestation persistence row rolls back Challenge state and preserves the lease.
- Control-plane durable submit rejects unaccepted verifier results before persistence.
- Challenge API create replay with same idempotency key and same body returns the original Challenge.
- Challenge API create with same idempotency key and different body rejects.
- API idempotency ledger keys do not contain the raw client idempotency key.
- Webhook delivery idempotency key does not contain the raw delivery ID.
- Duplicate Check delivery idempotency key rejects at the durable primary key.
- GitHub Check create `external_id` does not contain raw Challenge ID.
- Accepted submit creates a PENDING Check delivery row before queue publication.
- Queue messages omit raw nonce, GitHub installation/repository IDs, Attestation body, review details, and code content.
- Queue send failure after accepted persistence does not roll back the submitted Challenge or persisted Attestation.
- Retry planning rejects terminal published deliveries.
- Retry planning stops before scheduling beyond `maxAttempts`.
- Retry-After seconds and HTTP-date inputs are honored and bounded.
- Deterministic jitter is stable for the same delivery and attempt.
- Invalid Retry-After input rejects.
- Invalid queue delay options reject before sending.
- Published Check deliveries cannot be dead-lettered or replayed.
- Dead-lettered deliveries are not queueable until replayed.
- Manual replay requires explicit authorization and resets attempt/error fields.
- GitHub Check rerequest uses the same replay path with a GitHub delivery ID.
- Non-dead-letter deliveries cannot be manually replayed.
- Success publication rejects superseded old-head deliveries and records `CHALLENGE_SUPERSEDED`.
- Success publication rejects current PR head races and records `HEAD_SHA_MISMATCH`.
- Success publication rejects Check context mismatches and records `TRUST_LEVEL_MISMATCH`.
- Terminal published deliveries cannot be republished with a new CheckRun ID.
- Success publication does not emit or depend on a `stale` Check conclusion.
- Challenge submit API without resource authorization rejects before nonce consumption.
- Device binding rejects repository mismatches, Device ID mismatches, and revoked Device identities.
- Organization Runner binding rejects missing Runner identity, workflow-ref mismatch, and repository scope mismatch.
- API body byte count above `WORKER_LIMITS.maxBodyBytes` rejects.
- Per-route/client request count above the configured minute limit rejects until the next window.
- Request clock skew greater than `WORKER_LIMITS.maxClockSkewMs` rejects.
- Challenge expiry at or before `createdAt`, or beyond the maximum Challenge TTL, rejects before Challenge creation.
- Ordinary Attestation DELETE still rejects with the append-only trigger.
- Retention purge deletes only expired Attestation rows through an authorization row and removes that authorization before commit.
- Recent Webhook projection, Challenge, Attestation, Check delivery, legacy audit, and revoked Runner metadata rows are preserved.
- Terminal old Challenges are not deleted by the unfinished-Challenge retention rule.
- Runner Key audit events do not serialize actor login, public key ID, public key fingerprint, workflow ref, or private key material.
- Audit event validation rejects extra actor/resource fields and detailed Finding payloads.
- Metrics samples store challenge age, verify latency, delivery lag, retry, and reject reason without actor login, code content, or detailed Finding fields.
- Metrics labels reject fields outside the control-plane allowlist.
- Alert evaluation emits all four FG5-19 alert kinds from metadata-only inputs.
- Alerts point to a runbook section for every alert kind.
- Alerts do not serialize actor login, Runner Key ID, workflow ref, private key material, webhook bodies, or detailed Finding fields.
- OpenAPI route coverage rejects missing current `v1` and Webhook route documentation.
- OpenAPI and compatibility policy must include all current Challenge and Key request schema versions.
- Compatibility policy must list required cloud schema inventory entries plus privacy and breaking-change rules.
- OpenAPI and compatibility policy reject private-content-shaped API contract terms.
- Reopened file-backed database must keep submitted Challenge, Attestation, Device Key, Runner Key, repository scope, and pending Check delivery rows.
- Idempotent migration replay after reopen must not drop persisted rows.
- Reopened Attestation table must still reject ordinary DELETE through the append-only trigger.
- Second connection duplicate Webhook delivery insert must throw and leave one row.
- Second connection duplicate accepted submit must throw after the Challenge is consumed and leave one Attestation plus one Check delivery.
- Second connection duplicate Check delivery insert must throw and leave one pending delivery row.
- Unsigned FG5 staging failure-injection readback must return `401` without exposing secret material.
- Signed FG5 staging failure-injection readback must prove injected Check API failures, Retry-After backoff, max-attempt stop, DLQ transition, manual replay, and replay queue enqueue.
- FG5 Check failure readback evidence must reject missing retry/DLQ/replay proof or secret markers.
- Injected Check delivery insert failure must roll back the previously inserted Attestation row and leave the Challenge nonce unconsumed.
- Injected Challenge update/nonce consume failure must roll back the previously inserted Attestation and Check delivery rows.
- Remote D1 ordinary Attestation DELETE must fail before retention purge authorization.
- Remote D1 retention readback must reject any expired fixture row that remains after purge.
- Remote D1 retention readback must reject any recent or terminal audit-min fixture row that is accidentally deleted.
- Remote D1 retention readback must reject a non-empty `retention_purge_authorizations` table after purge.
- Incident drill evidence must include dashboard rows for webhook, verify, queue, and GitHub API failure classes.
- Incident drill evidence must reject missing dashboard rows or secret markers.
- Verify-failure and GitHub API alert kinds must have matching runbook sections.
- Full-plane DLP evidence must cover database, log, trace, and queue exports.
- Full-plane DLP evidence must reject code-content, bait values, forbidden bait keys, forbidden endpoint/media, and secret markers.
- Queue DLP evidence must include a Check delivery queue message before the queue surface is accepted.

## Known Limitations

- FG5-01 through FG5-EG7 prove durable restart, duplicate delivery idempotency, staging Check failure retry/DLQ/replay, Attestation nonce transaction rollback, remote D1 retention purge, incident dashboard/runbook mapping, and full-plane DLP export.
- Live GitHub permission readback for key admin proof remains a later staging authorization readback outside the FG5 exit gates.

## Decision

PASS for FG5-01 through FG5-EG7.
