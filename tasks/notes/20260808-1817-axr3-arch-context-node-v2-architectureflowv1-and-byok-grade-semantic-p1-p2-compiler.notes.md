# Implementation Notes: axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler

> **Status**: Active
> **Plan**: plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md
> **Contract**: tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md
> **Review**: tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md
> **Last Updated**: 2026-08-08 19:32
> **Lifecycle**: notes

## Design Decisions

- `archcontext.node/v2` is an atomic cutover. Product loaders reject v1 and validate the structured
  entrypoint/source/sink shape before casting.
- `ArchitectureFlowV1` owns participant references, ordered steps, success/error outcomes and
  terminal labels. CodeGraph owns only exact source-symbol to sink-symbol bindings; it cannot
  create labels, order, branches or terminal semantics.
- Semantic compilation has three states: `proven`, `not-applicable`, `unprovable`. Only `proven`
  emits Mermaid. Missing, ambiguous, unmatched or truncated evidence emits no degraded diagram.
- Raw import graphs remain diagnostic measurements and no longer affect semantic entity output or
  its proof digest.
- Mermaid skill remains an external agent review dependency. Runtime does not read `SKILL.md`;
  exact dev dependency `@mermaid-js/mermaid-cli@11.16.0` is the automated parse/render authority.
- The hook pilot documents the verified `1eaf6301` behavior (journal + architecture helper cascade),
  not the future ArchContext provider. Claiming the future provider against the current source would
  be a false semantic binding.

## Deviations From Plan Or Spec

- The fidelity fixture directory is named `repo-harness-semantic-pilot`, not `semantic-pilot`.
- Flow YAML is consumed by the strict Git-visible model loader used for projection. Operational
  SQLite ledger state remains non-authoritative under ADR-0040 and does not gain a new flow graph
  entity in AXR3; node v2 import/project is migrated atomically.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Keep node v1/v2 dual reader | Rejected | Would preserve two semantic authorities with no bounded migration window. |
| Infer P1/P2 from paths or top-five symbols | Rejected | Can prove neither business participants nor branch outcomes. |
| Make the current hook pilot claim an ArchContext provider call | Rejected | `processArchitectureCascade()` only runs current queue/context helpers at repo-harness `1eaf6301`. |
| Exact selector per declared sink | Accepted | Smallest proof boundary that is deterministic and fail-closed. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Pilot readback: `bun scripts/architecture-projection-axr3-semantic-pilot-readback.ts --out-dir <temp> --human-review-minutes 4`
- Pinned consumer: `Ancienttwo/repo-harness@1eaf63019aadd2129376987957170d8310b35c3f`
- Runtime evidence: CodeGraph `1.5.0`; Mermaid CLI `11.16.0`; 221 nonblank declaration LOC.
- Selector coverage:
  - `capability.runtime-harness.hook-adapters`: P1 proven, P2 proven, 2/2 selectors, 0 unbound,
    proof `sha256:6560fecde03d8a99f3acda973eaf5ba25f5ce434e8276f93889c8df5f6c088e4`.
  - `capability.verification.codegraph-readiness`: P1 proven, P2 proven, 3/3 selectors, 0 unbound,
    proof `sha256:aca0e357a416097849bbc400dfd49f9f213034f2424306aec931b1219e4918c5`.
- Mermaid Architecture review: 4 minutes across two P1 flowcharts and two P2 sequence diagrams;
  all four rendered as SVG and PNG, labels remained semantic and readable, P1 used distinct
  component/datastore/external-system contrast, P2 displayed `autonumber`, success `alt`, error
  `else`, and explicit terminal notes. No path or source symbol leaked into the diagrams.
- Focused verification: 222 pass, 0 fail across contracts, semantic compiler, entity integration,
  CodeGraph adapter and architecture ledger; `bun run typecheck` passed.
- Independent Claude review: first pass raised one false P1 because it overlooked the unchanged
  existing `parent` schema property; direct `jq` readback disproved it. Its valid dangling-parent P2
  was fixed. Second pass had no P1 and requested explicit diagnostic-code coverage; duplicate
  participant, missing relation, missing terminal participant and flow/capability mismatch tests were added.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
