# AL7 Context Compiler Ledger-First Readback

Date: 2026-06-26
Branch: `codex/architecture-ledger-al7-context-compiler`

## Scope

Completed AL7-11: `context-compiler` consumes Architecture Book ledger query results before requesting CodeGraph facts.

Implemented behavior:

- `compileTaskContext` accepts an optional `ArchitectureContextLedgerPort`.
- The compiler queries the ledger first with the task text and context budget.
- Book subjects are converted into bounded `NormalizedCodeContext` symbols, edges and observed evidence without source bodies.
- CodeGraph is called only for the missing symbol slots after ledger results are counted.
- Checkpoint-style changed paths are synced only inside that missing-slot fallback.
- If ledger results fill the symbol budget, CodeGraph `ensureReady` and `buildTaskContext` are not called.
- Daemon `context`, `prepare`, `checkpoint` and `completeTask` pass a runtime ledger-backed port into the compiler.
- CLI embedded runtime fallback keeps the previous non-running daemon behavior and does not attempt ledger reads before daemon startup.
- Compiled context extensions now expose ledger digest, ledger query digest, result count and `codeFactsMode`.
- Remote Windows Node 24 readback widened the daemon restart persistence test timeout after the hosted runner completed the same assertions just past Bun's default 5s test budget.

Out of scope for this slice:

- AL7-12 explain mode.
- AL7-13 FTS fallback for prose and ADR summaries.
- AL7-14 cold/warm benchmark gates.
- AL7-15 broader privacy assertion sweep.
- Changing ledger mutation authority or MCP/CLI Book command shape.

## P1 Map

Components involved:

- `packages/core/context-compiler/src/index.ts`
  - Owns task context composition, budget enforcement and practice guidance input.
- `packages/core/application/src/index.ts`
  - Passes the optional ledger reader through `prepareTask` and `checkpointTask`.
- `packages/local-runtime/runtime-daemon/src/index.ts`
  - Adapts runtime ledger readback into the core ledger reader port.
- `packages/core/architecture-ledger/src/index.ts`
  - Owns Book query ranking, budget readback and graph digest semantics.
- `packages/local-runtime/local-store-sqlite`
  - Owns event replay and operational ledger state.

Authoritative inputs:

- Architecture ledger readback: daemon-owned `architectureLedgerReadback`.
- Code facts fallback: `CodeFactsPort.ensureReady` and `CodeFactsPort.buildTaskContext`.
- Model readback: `ArchitectureLedgerReadModelStore` through `validateModel`.

Explicitly not authoritative:

- Generated Markdown/diagram projections.
- Raw source bodies or raw diffs.
- MCP resource payloads as mutation inputs.

## P2 Trace

Runtime path:

```text
archctx prepare/context
  -> ArchctxDaemon.context | prepare | checkpoint | completeTask
  -> architectureLedgerContextPort(root).queryForTask(task, budget)
  -> architectureLedgerReadback(root)
  -> localStore.replayArchitectureLedger(scope)
  -> queryArchitectureLedgerBook(state, events, task, budget)
  -> compileTaskContext converts Book subjects to NormalizedCodeContext
  -> missingSlots = maxItems - ledgerSymbols.length
  -> CodeFactsPort.ensureReady or sync(changedPaths) only when missingSlots > 0
  -> merge ledger context first, CodeGraph fallback second
  -> practice guidance and pressure use the merged context
```

Error and fallback behavior:

- No ledger port preserves the previous CodeGraph-first behavior for non-daemon unit callers.
- Non-running embedded CLI runtime does not provide a ledger port; started daemon and RPC paths do.
- Empty ledger results still permit CodeGraph fallback for the full budget.
- Ledger-filled budgets do not touch CodeGraph.
- Context output stores selectors, summaries and digests only; it does not add source bodies.

## P3 Decision

The chosen boundary is a small core port instead of importing daemon/local-store dependencies into `context-compiler`.

Invariant preserved:

- The daemon remains the only runtime owner that can read operational ledger state and replay events.
- ChangeSet and daemon-owned append remain the mutation path.
- CodeGraph remains the source for missing observed code facts, not for already-known ledger architecture subjects.

Tradeoff:

- Context compilation now has one more optional input, but non-daemon callers keep the old contract.
- The first 10x pressure will be benchmark latency and relevance quality, not correctness of the routing boundary; AL7-14 remains open for that.

## Verification

```text
bun test packages/core/context-compiler/test/context-compiler.test.ts --timeout 90000
bun test packages/core/application/test/control-loop.test.ts --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger-authoritative runtime read surfaces" --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "checkpoint coalesces|runtime jobs enqueue|ledger-authoritative runtime read surfaces" --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "daemon restart restores persisted repository sessions" --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000
bun test packages/surfaces/mcp-local/test/mcp-local.test.ts --timeout 120000
bun test packages/surfaces/cli/test/cli.test.ts -t "CLI delegates init and context" --timeout 90000
bun test packages/surfaces/cli/test/cli.test.ts --timeout 240000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
bun test --timeout 90000
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-context-verify-state-XXXXXX) bun run verify
```

Focused assertions:

- Ledger query runs before CodeGraph.
- CodeGraph `sync(changedPaths)` and `maxSymbols` equal the missing budget after ledger hits.
- CodeGraph is not called when ledger fills the context budget.
- Runtime context carries `architecture-book` resource and ledger digest metadata.
- Runtime context keeps the model resource and model digest when ledger-authoritative YAML projection drifts.
- MCP prepare tests resolve resource-summary payloads when ledger metadata pushes the response past inline budget.
- CLI embedded context fallback remains compatible before daemon startup.
