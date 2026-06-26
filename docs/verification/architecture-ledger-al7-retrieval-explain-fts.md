# AL7 Retrieval Explain And FTS Fallback Readback

Date: 2026-06-26
Branch: `codex/architecture-ledger-al7-retrieval-explain-fts`

## Scope

Completed AL7-12 and AL7-13:

- `archctx book query --explain` can report why each selected entity, relation or constraint was returned.
- `archctx book recommendations --explain` can report why each recommendation was selected.
- Architecture Book query can consume metadata-only SQLite FTS matches as fallback signals for architecture prose, ADR/evidence summaries and recommendation explanations.
- The FTS read model stores ids, subjects, titles, summaries, rationale and evidence summaries only; it does not store raw source bodies or raw diffs.

Out of scope:

- AL7-14 cold/warm benchmark gates.
- AL7-15 broader privacy assertion sweep.
- Marking AL7-EG1 through AL7-EG4 complete.
- Changing MCP resources to default to explain output.
- Adding a vector database.

## P1 Map

Components involved:

- `packages/core/architecture-ledger/src/index.ts`
  - Owns Book scoring, deterministic budgets, explanation shapes and fallback-score merge.
- `packages/local-runtime/local-store-sqlite/src/index.ts`
  - Owns the metadata-only SQLite FTS read model and scoped query API.
- `packages/local-runtime/runtime-daemon/src/index.ts`
  - Owns daemon Book readback, freshness and FTS fallback wiring.
- `packages/surfaces/cli/src/main.ts`
  - Owns explicit `--explain` CLI opt-in.

Authoritative state remains the ledger replay/current graph. FTS is a read-side retrieval index only.

## P2 Trace

`archctx book query --task <text> --explain`:

```text
CLI args
  -> daemon.book({ command: "query", task, explain: true })
  -> architectureLedgerReadback(root)
  -> localStore.replayArchitectureLedger(scope)
  -> localStore.queryArchitectureLedgerFts(scope, task)
  -> queryArchitectureLedgerBook(state, events, task, ftsMatches, explain)
  -> lexical score + graph distance + recency + importance + evidence strength + FTS fallback
  -> budgeted Book query envelope with freshness and per-result explanation
```

`archctx book recommendations --open --explain`:

```text
CLI args
  -> daemon.book({ command: "recommendations", openOnly: true, explain: true })
  -> replay ledger events
  -> queryArchitectureLedgerBookRecommendations(events, openOnly, explain)
  -> recommendation envelope with freshness and recommendation explanations
```

Exceptional paths:

- Empty FTS queries return no fallback matches and preserve lexical behavior.
- FTS fallback matches that cannot be mapped to a current Book subject do not create synthetic subjects.
- Default Book resources and non-explain CLI calls preserve the previous compact output.

## P3 Decision

The implementation adds an explicit read model instead of expanding the authoritative ledger schema or adding a vector store.

Invariant preserved:

- Ledger replay/current graph remains the source of truth.
- MCP tool surface stays small.
- Responses expose selectors, summaries, ids, digests and metadata only; no raw source bodies or raw diffs are stored in FTS.

Tradeoff:

- New SQLite migration and read model add storage/index maintenance, but give Book query a deterministic local prose fallback without remote indexing.
- The next 10x pressure is query latency and output quality under larger fixtures, which remains AL7-14.

## Verification

```text
bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 90000
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts -t "architecture ledger appends" --timeout 120000
bun test packages/surfaces/cli/test/cli.test.ts -t "CLI Book commands" --timeout 120000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger-authoritative runtime read surfaces|init, validate, sync, context, and status share|daemon restart restores persisted repository sessions" --timeout 90000
bun test packages/surfaces/mcp-local/test/mcp-local.test.ts -t "Book readbacks" --timeout 120000
bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 120000
bun run typecheck
```

Focused assertions:

- FTS fallback can select a current Book subject when lexical relevance alone would not.
- Entity explanations include reason codes, score signals and fallback matches.
- Recommendation explanations are stable and deterministic.
- SQLite FTS matches are scoped to repository/worktree and can carry subject ids.
- CLI explain output preserves the stable Book success envelope and freshness metadata.
