# Architecture Ledger AL6 Output Validation Verification

Date: 2026-06-26

## Scope

This artifact covers AL6-07, AL6-08 and the malformed-output side of AL6-EG4: typed `InvestigationReport/v1` findings, typed proposed deltas, and runtime validation of report references against the bounded investigation context.

It does not cover concrete Claude/Codex adapters, prompt-injection and tool-escape tests, output-to-ChangeSet promotion, timeout/retry fallback, provider metadata recording, or CLI commands. Those remain AL6-09 and later.

## Verified Changes

- `packages/contracts/src/ledger.ts`
  - `InvestigationReportV1.findings[]` now requires `proposedDelta: ArchitectureCandidateChangeV1`.
  - `proposedDeltaDigest` is required and must match the proposed delta digest at runtime.
- `schemas/runtime/investigation-report.schema.json`
  - Findings now require non-empty `evidenceBindingIds`, `unknowns`, `falsifier`, `confidence`, `proposedDelta`, and `proposedDeltaDigest`.
  - The schema embeds the same candidate-change shape used by the AL5 architecture delta pipeline.
- `packages/contracts/fixtures/valid/investigation-report.json`
  - Valid fixture now includes a typed proposed delta.
- `packages/contracts/fixtures/invalid/investigation-report-missing-proposed-delta.json`
  - Negative fixture proves digest-only output is no longer valid.
- `packages/core/agent-orchestrator/src/index.ts`
  - Added `validateInvestigationReport`.
  - `runInvestigationThroughPort` now rejects invalid runner output before returning it to callers.
  - Validation rejects direct mutation, job mismatch, malformed finding structure, missing proposed deltas, unknown evidence bindings, unknown proposed-delta targets, unknown proposed-delta parents, unverifiable proposed-delta evidence IDs and proposed-delta digest mismatch.

## Acceptance Mapping

| Sprint item | Evidence |
|---|---|
| AL6-07 | `InvestigationReport/v1` findings require finding ID, hypothesis, evidence references, unknowns, falsifier, typed proposed delta and confidence. |
| AL6-08 | `validateInvestigationReport` validates report shape and rejects context-unverifiable evidence and entity references before returning runner output. |
| AL6-EG4 | Stale completion remains rejected by the runtime job path, and malformed/hallucinated report output now fails with stable `investigation-report-invalid: <reason-codes>` values. |

## Verified Runtime Path

```text
InvestigationRunnerPort.runInvestigation
  -> InvestigationReport/v1 output
  -> validateInvestigationReport
  -> job/direct-mutation checks
  -> bounded context evidence binding and ledger target reference checks
  -> report returned only when valid
```

The side effect is intentionally limited: validation returns or rejects a typed proposal. It does not mutate ledger, YAML, docs or ChangeSets.

## Verification Commands

```bash
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000
bun test packages/contracts/test/contracts.test.ts --timeout 90000
bun test --timeout 90000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
```

All commands passed locally on 2026-06-26.
