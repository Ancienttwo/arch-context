# AL9 Documentation Projection Readback

Status: verified

## P1 Map

Contracts define `ProjectionTarget/v1`; model-store YAML owns `.archcontext/projections/targets.json`; renderer produces docs/architecture Markdown and diagram projections; ChangeSet applies bounded `render_projection` files; CLI exposes `archctx docs plan|preview|apply|drift|clean`.

## P2 Trace

The traced path is `.archcontext/model` plus ADR files -> documentation projection source digest -> generated region targets -> ChangeSet preview/apply -> docs/architecture files -> drift readback.

## P3 Decision

Human-authored prose is outside generated markers and preserved. Generated-only diagram paths without ArchContext markers are rejected as ambiguous ownership. Drift separates missing, stale, manual edit and orphaned projections.

## Verification

- Current projection drift clean: true
- Temp repo apply drift clean: true
- Human text preserved: true
- CLI commands ok: true

Failures: none
