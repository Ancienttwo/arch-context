> **Archived**: 2026-07-12 03:16
> **Related Plan**: plans/archive/plan-20260712-0301-ar0-deterministic-topology-kernel.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260712-0316

# Implementation Notes: ar0-deterministic-topology-kernel

> **Status**: Complete
> **Plan**: plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md
> **Contract**: tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md
> **Review**: tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md
> **Last Updated**: 2026-07-12 03:01
> **Lifecycle**: notes

## Design Decisions

- `ExplorerProjectionV2` is the sole semantic input. The new topology module exports
  only a package-internal render plan and self-contained SVG.
- Overview uses derived-group containers with expanded children; context uses explicit
  verification bands; detail uses incoming/focus/outgoing lanes plus overflow.
- Occurrences/relations already canonical from the compiler stay on the O(N + E)
  indexing/layout path. Noncanonical test inputs are sorted once to retain byte
  determinism, then use the same renderer.
- Missing endpoints throw `explorer-topology-missing-endpoint`; there is no phantom
  coordinate, card renderer, or semantic fallback.
- The old table and Inspector remain accessible equivalents, not compatibility
  semantics; they consume the same V2 projection.

## Deviations From Plan Or Spec

- None recorded.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| OMM Dagre/Marked/CDN | Rejected | External runtime, security, and authority drift |
| New graph package | Rejected | Existing package boundary is sufficient |
| Preserve card renderer | Rejected | Would create the forbidden dual renderer path |
| Hand-written deterministic SVG | Selected | Self-contained, measurable, reversible |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Machine readback: `docs/verification/explorer-ar0-topology-readback.json`
- Human readback: `docs/verification/explorer-ar0-topology-readback.md`
- Focused matrix: 24 pass / 0 fail; `bun run typecheck` PASS;
  `bun run verify:explorer` PASS.
- Final measured renderer: default 80/160 p95 0.70 ms / 149,013 B;
  public maximum 1,000/5,000 p95 38.85 ms / 3,288,171 B.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
