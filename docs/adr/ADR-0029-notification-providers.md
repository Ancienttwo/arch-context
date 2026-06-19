---
schemaVersion: archcontext.adr/v1
id: adr.0029.notification-providers
title: Notification Providers
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.contracts
  - package.notifications
  - package.control-plane
supersedes:
  - adr.0022.no-slack-in-mvp
---

# Context

MVP kept Slack out of scope and left only a notification port. Sprint 3 introduces Slack, generic webhook, and email because teams need review completion signals outside GitHub Checks, but the local-first privacy boundary cannot change.

# Decision

Add `NotificationPublisher` as a provider-neutral port. Providers may emit only Check-level metadata: PR URL, result, risk level, commit SHA, runtime version, and timestamp. Notification configuration is opt-in and provider-specific secrets are referenced by handle, not stored in event payloads.

# Consequences

- GitHub Checks remain the default notification surface.
- Slack, webhook, and email providers are allowed only through the minimal `NotificationEvent` contract.
- Code, diffs, findings, architecture model bodies, and review detail stay out of all notification payloads.
- Retry, idempotency, and dead-letter behavior are part of the provider layer, not review generation.
