---
schemaVersion: archcontext.adr/v1
id: adr.0015.github-app-without-contents-permission
title: GitHub App without Contents Permission
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.github-app
supersedes: []
---

# Context

The GitHub App should coordinate review proof without reading repository contents.

# Decision

Default MVP GitHub App permissions exclude Contents. It handles installation, repository selection metadata, PR events, challenges, and check runs.

# Consequences

- Review runs locally.
- SaaS cannot become a code proxy by accident.
