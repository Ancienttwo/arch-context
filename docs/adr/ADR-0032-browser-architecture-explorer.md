---
schemaVersion: archcontext.adr/v1
id: adr.0032.browser-architecture-explorer
title: Browser Architecture Explorer
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - component.architecture-context.local-runtime.runtime-daemon
  - module.architecture-context.surfaces
  - component.architecture-context.surfaces.cli
supersedes: []
---

> Approval source: Sprint 4 CD4 record, first committed in `aa3d5b98`, [docs/approvals/archctx-sprint-4-cd4.md @ 04b4c108](https://github.com/Ancienttwo/arch-context/blob/04b4c1084d78f7c2fa805f4cebd64a84bee84924/docs/approvals/archctx-sprint-4-cd4.md). Removed from `docs/approvals/` by [#442](https://github.com/Ancienttwo/arch-context/issues/442).

# Context

ArchContext already exports architecture projections, but users still need a local interactive way to inspect nodes, relations, verification state, pressure, interventions, evidence selectors, and multi-repo landscape edges during agent work. That surface must not become a second writer or a SaaS relay.

# Decision

Ship the Architecture Explorer as an opt-in browser surface served only from the local runtime daemon on `127.0.0.1`. The browser receives a read-only Explorer Projection and can only request local read views with a short-lived token. It cannot submit ChangeSets, update the model, call SaaS, or send source bodies outside the machine.

# Consequences

- Explorer improves inspection without weakening the ChangeSet-only write invariant.
- Loopback binding, token revocation, method filtering, and egress tests are part of the runtime contract.
- Multi-repo landscape is displayed as local derived state; Git/worktree remains the collaboration and sync boundary.
- Production readiness still requires external packet-capture/readback work outside this repo-local sprint.
