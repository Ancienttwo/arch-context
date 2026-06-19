---
schemaVersion: archcontext.adr/v1
id: adr.0022.no-slack-in-mvp
title: No Slack in MVP
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.application
supersedes: []
---

# Context

Notification integrations can expand MVP scope without proving the architecture control loop.

# Decision

Slack is out of MVP. Keep a notification port and focus on GitHub Check publishing.

# Consequences

- No Slack bot, slash command, or workspace OAuth in MVP.
- Future providers can attach to the port.
