# Practice Assets S2 Matching Gate

Date: 2026-06-24

## Scope

S2 connects the governed static Practice Catalog to the real local context path.
It adds typed practice matches, deterministic practice reranking, pressure
evidence details, and daemon-resolved `context` / `prepare` practice guidance.

This slice does not implement checkpoint deltas, repo opt-in complete
enforcement, waivers, Context7 resources, or dynamic documentation.

## Architecture Map

- Contracts: `packages/contracts/src/practices.ts`
- Runtime schemas: `schemas/runtime/practice-match.schema.json`, `schemas/runtime/practice-guidance.schema.json`, `schemas/runtime/task-context.schema.json`
- Pressure evidence: `packages/core/pressure-engine/src/index.ts`
- Matching engine: `packages/core/practice-engine/src/index.ts`
- Context integration: `packages/core/context-compiler/src/index.ts`
- Prepare integration: `packages/core/application/src/index.ts`
- Daemon context path: `packages/local-runtime/runtime-daemon/src/index.ts`
- Surfaces: `packages/surfaces/cli/src/main.ts`, `packages/surfaces/mcp-local/src/index.ts`
- Eval data: `evals/practices/structural-positive.jsonl`, `evals/practices/benign-negative.jsonl`

## Traced Path

```text
archctx context --task <task>
  -> CLI thin adapter
  -> RuntimeDaemonClient.context
  -> ArchctxDaemon.context
  -> compileTaskContext
  -> CodeFactsPort.ensureReady / buildTaskContext
  -> loadPracticeCatalog
  -> detectArchitecturePressure
  -> matchPracticesForTask
  -> CompiledTaskContext.practiceGuidance

archctx prepare --task <task>
  -> same compileTaskContext result
  -> prepareTask reuses context.extensions.pressureSignals
  -> posture/intervention are based on the same compiled pressure digest
```

## Readback

Focused verification:

```text
bun run typecheck: pass
bun run verify:practices: 10 pass, 0 fail; catalog validate/list pass
bun test packages/core/pressure-engine packages/core/practice-engine: 8 pass, 0 fail
bun test packages/core/context-compiler packages/core/application packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local: 52 pass, 0 fail
bun evals/run.ts --check: PASS
bun run verify: 575 pass, 0 fail, 3423 expect() calls
```

Representative eval readback:

```text
Unjustified Compatibility Recall: 88.2% >= 85.0%
Architecture Drift Precision: 100.0% >= 90.0%
Context Constraint Recall: 100.0% >= 95.0%
Context irrelevant ratio: 4.4% <= 20.0%
Chinese Jieba Retrieval Gate: 100.0% context, 100.0% constraint, 0.0% irrelevant
Practice Top-3 recall: 96.7% >= 90.0%
Practice benign negatives: 0.0% / 0
Target/migration separation invariant: 20/20
Datasets: practices=30 positive / 30 negative
```

## Boundary Notes

- `PressureSignal.evidence` and `evidenceKind` remain for compatibility; new
  `evidenceDetails` carries typed evidence.
- Heuristic-only pressure cannot produce high severity or non-advisory practice
  guidance.
- `context` no longer returns a placeholder low/empty payload; it calls the same
  compiler as `prepare`.
- Practice matching uses normalized CodeFacts symbols, edges, and evidence only;
  it does not read CodeGraph internals.
- Scope filtering is intentionally lightweight in S2: path and negative-path
  filters are active, while full repository kind/language/framework profile
  precedence remains deferred.
