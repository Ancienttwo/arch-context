# Self-architecture boundary validation

> **Promoted from `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md` on 2026-10-31**: still-valid `appliesTo` reference-error semantics (base gate versus full after-apply validation). `docs/adr/README.md` records the validation but not the reversible-restore exception. Plan/contract/review references are historical; current authority is `packages/contracts/src/ports.ts` and `packages/local-runtime/model-store-yaml`.

## Design Decisions

- PR-2: ADR `appliesTo` integrity lives in `validateAdrAppliesTo` (architecture-domain) and runs in
  both `YamlModelStore.validateModel` and the ledger read-mode `validateModelFiles`.
- PR-2: `ModelValidationResult.referenceErrors` marks the dangling-reference subset of `errors`.
  Base-model gates (ChangeSet before-apply, daemon `apply_update`, ledger projection writes) use
  `baseModelBlockingErrors`, which ignores them, so a change that restores a deleted node is not
  blocked. The after-apply model is validated in full, and `archctx validate` still reports them.
  Only well-formed unknown ids are reference errors; a malformed `appliesTo` still blocks a write.
- PR-2: ADR frontmatter is hand-written YAML, so the check reads only the top-level `appliesTo`
  key with a tolerant extractor (inline or block list, comments, quotes) instead of parsing the
  whole frontmatter with StableYamlParser. Other frontmatter keys can never fail validation.
- PR-2: ADR-0021 (`skills.archcontext-develop`) maps to `capability.architecture-context`. The
  first-party skills are not a component of their own, and the capability is kept as their umbrella
  owner (orchestrator decision) instead of adding a node only to satisfy this reference.

## Deviations From Plan Or Spec

- PR-2 touches `packages/core/changeset-engine/`, which the plan does not name: the before-apply
  model gate lives there.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Enforce appliesTo on before- and after-apply models | Rejected | A hand-deleted referenced node could not be restored through ChangeSet or `ledger project` |
| Non-worsening check on the before-apply model | Not needed | The full after-apply check already rejects any result with a dangling reference |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
