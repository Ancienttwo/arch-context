# Architecture Ledger AL1 Evidence Correctness

Date: 2026-06-25
Branch: `codex/architecture-ledger-al1`
Sprint: `plans/sprints/archctx-architecture-ledger-sprint-checklist.md`

## Scope

AL1 closes the recommendation evidence correctness gap identified by the
architecture-ledger research report. It does not add SQLite ledger tables,
automatic hooks, subagent orchestration, or a new authority mode.

## P1 Map

The recommendation path is:

1. `packages/core/practice-engine/src/index.ts` ranks practice assets from
   retrieval hits, pressure signals, structural predicates, and typed evidence
   bindings.
2. `packages/contracts/src/ports.ts` owns the context evidence binding contract
   carried by `NormalizedCodeContext.evidence[*].practiceBindings`.
3. `packages/contracts/src/ports.ts` also allows observed evidence to declare
   `polarity`, `coverage`, and `supports` so absence probes cannot rely on
   summary text.
4. `packages/core/architecture-domain/src/index.ts` now owns the shared parser
   for layer and boundary direction violation subjects.
5. `packages/core/practice-engine/src/check-registry.ts` applies deterministic
   complete-stage checks only after repo opt-in policy selects a registered
   checker.
6. `evals/run.ts` gates representative recommendation recall, evidence-bound
   non-advisory precision, no-label structural recall, hard-gate false
   positives, and evidence-shuffle contamination.

Authoritative verification artifacts:

- `docs/verification/m6-representative-eval-report.md`
- `packages/core/practice-engine/test/practice-engine.test.ts`
- `packages/core/architecture-domain/test/domain.test.ts`

## P2 Trace

Concrete trace for a declared layer violation:

1. Input source of truth is `NormalizedCodeContext`: symbols, import edges, and
   typed `practiceBindings`.
2. `matchPracticesForTask` scopes candidate assets, builds retrieval candidates,
   and calls `scoreAsset`.
3. `scoreAsset` calls structural predicate matchers. For
   `declared-layer-violation-observed`, `explicitImportPredicate` accepts only
   subjects parsed by `parseArchitectureDirectionViolationSubject` with a
   `source->target` direction.
4. Complete `practiceBindings` require `practiceId`, `provenance`, and
   `coverage`. Only `coverage.level: complete` can provide direct authority;
   partial or unknown coverage remains non-authoritative.
5. For absence predicates, `typedAbsenceProbeEvidence` accepts only evidence
   with `polarity: absence`, complete coverage, recommendation support, and a
   complete practice binding. Partial probes fall back to heuristic
   `unproven-absence`.
6. `dependencyDirectionViolationSubjects` in `check-registry.ts` accepts only
   non-heuristic, typed, directional violation subjects.
7. The final side effect is a recommendation with evidence explanation, or an
   opt-in deterministic check result. Plain import edges remain generic import
   evidence and do not prove a declared layer violation.

## P3 Decision

The smallest coherent change was to keep the current practice catalog and
matcher architecture, but make evidence authority explicit:

- Exact recommendation authority now comes from typed practice bindings, not
  evidence ID or summary substring matches.
- Absence authority now comes from typed probes with complete coverage; free-text
  absence summaries cannot suppress heuristic safety caps.
- Boundary and layer direction subjects are parsed once in `architecture-domain`
  and reused by recommendation, enforcement, and eval scoring.
- `import-edge-added` remains a generic observed import predicate, separate from
  `cross-boundary-import-added` and `declared-layer-violation-observed`.
- Automatic checkpoint or complete promotion remains policy opt-in only; AL1
  improves evidence correctness but does not enable new promotion behavior.

At 10x dataset size, the first likely pressure point is calibration, not hard
gate safety: the current report shows precision and hard-gate gates passing, but
confidence ECE remains reported rather than blocked.

## Verification

Commands run:

```bash
bun test packages/core/architecture-domain/test/domain.test.ts
bun test packages/core/practice-engine/test/practice-engine.test.ts
bun evals/run.ts --check
bun evals/run.ts
bun run typecheck
node scripts/sprint-status-check.mjs
bun run verify
```

`bun run verify` exited 0. During `verify:practices`, the local CLI printed a
non-fatal `AC_RUNTIME_UNAVAILABLE` diagnostic for an existing user-data
`runtime.sqlite`; the verify chain continued and completed successfully.

Observed gates from `bun evals/run.ts --check`:

- Practice Top-3 recall: 100.0% (threshold >= 92.0%)
- Recommendation precision@3: 100.0% (threshold >= 80.0%)
- Practice no-keyword structural recall: 100.0% (threshold >= 90.0%)
- Practice direct-reference recall: 100.0% (threshold >= 100.0%)
- Practice evidence-shuffle contamination: 0.0% (threshold 0.0%)
- Practice heuristic-only hard-gate rate: 0.0% (threshold 0.0%)
- Practice dynamic-doc hard-gate rate: 0.0% (threshold 0.0%)

Residual reported, not blocked:

- Benign advisory false-positive rate remains a visibility metric. It does not
  promote non-advisory matches and is separate from hard-gate false positives.
- Confidence calibration remains reported for follow-up tuning.
