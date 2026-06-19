---
schemaVersion: archcontext.adr/v1
id: adr.0032.browser-architecture-explorer
title: Browser Architecture Explorer
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - package.runtime-daemon
  - package.explorer-ui
  - package.cli
supersedes: []
---

# Context

ArchContext already exports architecture projections, but users still need a local interactive way to inspect nodes, relations, verification state, pressure, interventions, evidence selectors, and multi-repo landscape edges during agent work. That surface must not become a second writer or a SaaS relay.

# Decision

Ship the Architecture Explorer as an opt-in browser surface served only from the local runtime daemon on `127.0.0.1`. The browser receives a read-only Explorer Projection and can only request local read views with a short-lived token. It cannot submit ChangeSets, update the model, call SaaS, or send source bodies outside the machine.

# Consequences

- Explorer improves inspection without weakening the ChangeSet-only write invariant.
- Loopback binding, token revocation, method filtering, and egress tests are part of the runtime contract.
- Multi-repo landscape is displayed as local derived state; Git/worktree remains the collaboration and sync boundary.
- Production readiness still requires external packet-capture/readback work outside this repo-local sprint.
