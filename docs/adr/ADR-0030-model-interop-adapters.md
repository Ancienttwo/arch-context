---
schemaVersion: archcontext.adr/v1
id: adr.0030.model-interop-adapters
title: Model Interop Adapters
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.adapter-likec4
  - package.adapter-structurizr
  - package.renderer
supersedes: []
---

# Context

ArchContext users may already have LikeC4 or Structurizr assets. Replacing those ecosystems would duplicate mature tooling and risk making the Native ArchContext model a lowest-common-denominator C4 clone.

# Decision

Implement LikeC4 and Structurizr as export-first adapters. Import is allowed only for one-time initialization into Native ArchContext files. Native remains the source of truth for evidence, verification, constraints, interventions, and ChangeSets. The adapters produce deterministic projections suitable for Git review.

# Consequences

- ArchContext does not introduce a new C4 DSL or visual editor.
- Export is deterministic and stable-sorted to minimize review noise.
- Import never overwrites Native evidence, verification, constraint, or intervention fields.
- Fidelity loss is explicit at the adapter boundary instead of hidden in Native model semantics.
