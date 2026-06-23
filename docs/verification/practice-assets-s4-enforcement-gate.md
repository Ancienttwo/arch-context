# Practice Assets S4 Enforcement Gate

S4 adds the first opt-in deterministic complete gate for practice assets. The implementation keeps built-in practices advisory by default; complete-stage blocking only happens when `.archcontext/policies/practices.yaml` explicitly promotes a registered deterministic checker.

## P1 Map

- Contracts: `packages/contracts/src/practices.ts`, `schemas/repo/practices/practice-policy.schema.json`, `schemas/repo/practices/practice-waiver.schema.json`, `schemas/runtime/practice-check-result.schema.json`.
- Engine: `packages/core/practice-engine/src/enforcement.ts` loads/validates repo policy and waivers, applies opt-in ceilings, computes check digests, and applies exact-scope waivers.
- Checker registry: `packages/core/practice-engine/src/check-registry.ts` contains registered deterministic complete checks. This slice registers `compatibility-contract-required` and `no-new-cycle`.
- Complete gate: `packages/core/review-engine/src/index.ts` consumes a daemon/core-computed enforcement evaluation, reports `practiceViolations`, `waiversApplied`, `actionsRequired`, and binds catalog/policy/check digests into the review snapshot.
- Runtime entry: `packages/local-runtime/runtime-daemon/src/index.ts` loads repo policy/waivers, recompiles current practice guidance when policy mode is `active`, and passes daemon-owned enforcement data to `completeTaskGate`.
- Surfaces: CLI/MCP only pass task metadata. They cannot pass `practiceViolations`, `practiceEnforcement`, waiver outputs, or practice digest fields.

Out of scope for this slice: dependency-direction/owner/migration/test-evidence checkers. Waiver write governance was completed in the follow-up slice documented in `docs/verification/practice-assets-s4-waiver-governance.md`.

## P2 Trace

Concrete active-policy path:

1. `archctx complete --task-session-id task_enforcement --task "remove import cycle"` calls the runtime daemon.
2. The daemon opens the authoritative repo session, reads current HEAD/worktree/model/code-facts digests, and loads `.archcontext/policies/practices.yaml`.
3. If policy mode is `active`, the daemon recompiles practice guidance from current CodeFacts and the task. It also reads the previous checkpoint baseline for the same task session.
4. `evaluatePracticeEnforcement` selects only repo-opted complete rules, enforces the asset `promotableTo` ceiling, rejects heuristic-only matches as hard gates, runs registered deterministic checks, applies exact unexpired waivers, and computes `checkResultDigest`.
5. `completeTaskGate` runs stale/compatibility/cleanup gates first. If context is stale, practice conclusions are suppressed. Otherwise failed check results become `practiceViolations` and `practice-violation` findings.
6. The review result snapshot binds `practiceCatalogDigest`, `practicePolicyDigest`, and `practiceCheckResultDigest`, so the attested review digest covers the enforcement input/output.

## P3 Decision

The design preserves the existing local product boundary: daemon/core own state and decisions; CLI/MCP remain thin adapters. Complete enforcement is intentionally narrow and machine-check-only. This avoids turning retrieval, task text, Context7, LLM output, or external docs into hard gates. At 10x scale, the first pressure point will be richer baseline storage and more checker-specific fact models; this slice keeps that isolated behind the registry and evaluation contract.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/contracts/test/contracts.test.ts packages/core/practice-engine/test/practice-engine.test.ts packages/core/review-engine/test/review-engine.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts
bun test packages/core/practice-engine/test/practice-engine.test.ts
bun scripts/fg3-adversarial-review-conclusion.ts run --json
bun test scripts/fg3-adversarial-review-conclusion.test.ts
bun run typecheck
bun run verify:practices
git diff --check
bun run verify
```

Observed readbacks:

- Focused S4 matrix across contracts, practice-engine, review-engine, runtime daemon, CLI, and MCP: 174 pass / 0 fail / 977 expects.
- Practice-engine final focused suite: 8 pass / 0 fail / 30 expects.
- FG3 adversarial review conclusion evidence regenerated with the expanded practice attestation denylist; focused readback: 2 pass / 0 fail / 7 expects.
- `bun run typecheck`: pass.
- `bun run verify:practices`: 14 pass / 0 fail / 47 expects plus strict catalog validation.
- `git diff --check`: pass.
- `bun run verify`: 595 pass / 0 fail / 3529 expects; packaged CLI smoke, privacy/security manifests, acceptance ledger, sprint status check, and representative eval all passed.

## Gate Evidence

- S4-EG1: Complete-blocking practice findings come only from `runRegisteredPracticeCheck`; unregistered checks return `not_applicable` and do not block.
- S4-EG2: Heuristic-only matches return `not_applicable` with reason `heuristic-only`; they do not create violations.
- S4-EG3: Repeated evaluation over the same catalog/policy/matches/baseline produces the same `checkResultDigest`.
- S4-EG4: Valid waiver suppresses the exact violation; expired, tampered, and overscoped waivers do not.
- S4-EG5: Policy mode `advisory` returns an empty enforcement result and does not alter old complete gates.
- S4-EG6: Review snapshots include catalog, policy, and check result digests when enforcement runs; no source bodies are added.

## Known Limits

- Only `compatibility-contract-required` and `no-new-cycle` are registered in this slice.
- Waiver write governance, owner registry validation, and CLI `practices waive/waivers` are covered by `docs/verification/practice-assets-s4-waiver-governance.md`.
- Dependency direction, owner-required, migration review/removal, and required-test-evidence checkers remain pending.
