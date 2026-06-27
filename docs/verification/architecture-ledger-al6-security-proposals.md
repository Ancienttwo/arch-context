# Architecture Ledger AL6 Security Proposal Verification

Date: 2026-06-26

## Scope

This artifact covers AL6-09 and AL6-10: repository/model-output untrusted handling, prompt-injection and tool-escape regression tests, and the rule that agent investigation output can only become an advisory proposal until deterministic validation and ChangeSet review approve a mutation path.

It does not cover concrete Claude/Codex adapters, provider timeout/retry metadata, agent CLI commands, or AL7 retrieval surfaces. Those remain later AL6/AL7 items.

## Verified Changes

- `packages/core/agent-orchestrator/src/index.ts`
  - Added `InvestigationReportProposalPlan` and `planInvestigationReportProposal`.
  - Validated reports become proposal records with `authority: advisory-only`, `directMutationAllowed: false`, `requiredNextStep: deterministic-validation`, and forbidden ledger/YAML/docs/ChangeSet/tool/command actions.
  - Untrusted payload guards reject raw source, raw diff, prompt, completion, tool-call, command and write-field payloads in investigation context/report data.
- `packages/core/changeset-engine/src/index.ts`
  - `planArchitectureCandidateChangeSet` now rejects candidate deltas carrying agent report/proposal provenance before ChangeSet planning.
  - This keeps agent output outside the ChangeSet mutation path until a deterministic pipeline re-validates and re-emits candidate deltas without advisory provenance.
- `packages/core/agent-orchestrator/test/agent-orchestrator.test.ts`
  - Covers advisory-only proposal planning.
  - Covers prompt-injection text remaining inert behind `inputDigest`.
  - Covers tool-escape rejection through `validateInvestigationReport`, `runInvestigationThroughPort`, and `planInvestigationReportProposal`.
- `packages/core/changeset-engine/test/changeset-engine.test.ts`
  - Covers direct rejection of agent/proposal provenance before ChangeSet promotion.
- `docs/security/threat-model-v1.md`
  - Adds repository prompt-injection/model-output tool escape as an explicit threat and invariant.

## Acceptance Mapping

| Sprint item | Evidence |
|---|---|
| AL6-09 | Repository text is not copied into proposal plans, model output tool escapes fail with `tool-escape-forbidden`, and raw source/diff/prompt/completion payloads remain forbidden. |
| AL6-10 | Agent output is represented as an advisory proposal with `requiredNextStep: deterministic-validation`; ChangeSet planning rejects agent/proposal provenance before any draft is created. |
| AL6-EG3 | Direct mutation remains disallowed at job, report, proposal and ChangeSet-planning boundaries. |
| AL6-EG4 | Malformed/untrusted outputs fail with stable reason codes, now including `raw-report-payload-forbidden` and `tool-escape-forbidden`. |

## Verified Runtime Path

```text
InvestigationRunnerPort.runInvestigation
  -> untrusted InvestigationReport/v1 output
  -> validateInvestigationReport
  -> raw payload/tool escape/direct mutation/reference checks
  -> planInvestigationReportProposal
  -> advisory-only proposal with typed proposed deltas and digests
  -> deterministic validation required before ChangeSet promotion
```

The ChangeSet side is intentionally narrower:

```text
ArchitectureCandidateDelta/v1
  -> planArchitectureCandidateChangeSet
  -> reject agent/proposal provenance before accepted candidate planning
  -> deterministic candidate deltas without advisory provenance continue through existing policy evaluation
```

## Verification Commands

```bash
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000
bun test packages/core/changeset-engine/test/changeset-engine.test.ts --timeout 90000
bun test --timeout 90000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
```

All commands passed locally on 2026-06-26.
