---
schemaVersion: archcontext.adr/v1
id: adr.0021.first-party-skills-sop-only
title: First-party Skills as SOP Only
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - skills.archcontext-develop
supersedes: []
---

# Context

Skills are useful for agent workflow but hard to test as business logic containers.

# Decision

First-party skills describe when to call tools and how to interpret gates. Core behavior lives in runtime packages.

# Consequences

- Skills remain thin.
- Contract tests exercise runtime logic, not prompt prose.
