# AL7 Book Retrieval Verification

Date: 2026-06-26

## Scope

This closes AL7-01 through AL7-08 for the architecture ledger sprint.

Implemented behavior:

- Pure Book query helpers over ledger current state for entities, relations and constraints.
- Graph-neighborhood reads through SQLite indexed current tables and a recursive CTE.
- Temporal Book refs for `empty`, `current`, event id, `event:<id>`, `commit:<sha>`, `timestamp:<iso>` and `snapshot:<id>`.
- Architecture diff between two Book refs with stable change reason codes and evidence link fields.
- Deterministic retrieval ranking across task relevance, graph distance, recency, declared importance and evidence strength.
- Deterministic item/byte budgets with explicit truncation reason codes.
- Runtime freshness metadata with repository, worktree, read authority, HEAD SHA, worktree digest, graph digest, projection digest and ledger cursor.
- `archctx book status/query/show/neighbors/timeline/diff/evidence/recommendations/export` JSON envelopes.

Out of scope for this slice:

- AL7-09 and AL7-10 MCP resource exposure.
- AL7-11 context compiler consumption of ledger queries.
- AL7-12 explain mode.
- AL7-13 FTS fallback.
- AL7-14 warm/cold benchmark.
- Full AL7 privacy audit beyond metadata-only fixture assertions.

## P1 Map

The read boundary remains local-first and daemon-owned.

`@archcontext/core/architecture-ledger` owns pure Book projections, ranking, timeline, diff, evidence lookup, recommendation lookup and deterministic budget accounting. Ranking derives task relevance from subject text, graph distance from the current graph, recency from ledger events, and importance/evidence strength from bounded metadata. It does not open SQLite, read YAML, call Git or mutate ledger state.

`@archcontext/local-runtime/local-store-sqlite` owns the indexed neighborhood read model. It reads materialized current graph tables scoped by repository/worktree identity and returns a bounded graph slice; it does not append events or edit `.archcontext/`.

`@archcontext/local-runtime/runtime-daemon` owns Book RPC orchestration, freshness construction, ledger replay, temporal ref resolution and export formatting. It uses the existing ledger readback and replay APIs rather than bypassing authority through direct CLI SQLite reads.

`@archcontext/surfaces/cli` owns only argument parsing and stable command envelopes for `archctx book ...`.

## P2 Traced Paths

Query path:

```text
archctx book query --task "architecture context" --max-items 2
  -> runBookCommand
  -> RuntimeDaemonClient.book({ command: "query" })
  -> ArchctxDaemon.book
  -> architectureLedgerReadback
  -> queryArchitectureLedgerBook
  -> freshness + budgeted JSON envelope
```

Neighborhood path:

```text
archctx book neighbors capability.architecture-context --depth 1
  -> ArchctxDaemon.book
  -> localStore.readArchitectureLedgerNeighborhood
  -> recursive CTE over architecture_entities_current and architecture_relations_current
  -> queryArchitectureLedgerBookNeighbors
  -> nodes/relations/constraints with deterministic distances and budgets
```

Temporal diff path:

```text
archctx book diff --from empty --to snapshot:<snapshotId>
  -> architectureBookResolveRef
  -> localStore.replayArchitectureLedger({ snapshotId })
  -> replayArchitectureLedgerEvents
  -> diffArchitectureLedgerBookStates
  -> added/removed/changed summary, reason codes and evidence link fields
```

Evidence path:

```text
archctx book evidence product.review-app
  -> replay architecture events
  -> scan evidence items and evidence bindings by selector/subject/target id
  -> return selectors, summaries, digests and metadata
```

## P3 Decision

The smallest coherent change is a read-only Book surface over the existing ledger. The CLI does not gain write authority, and the store does not introduce a second database or new table family.

The recursive CTE lives in `local-store-sqlite` because AL7-02 asks for indexed graph-neighborhood reads; doing this only in the core in-memory helper would pass small tests but would not exercise the intended SQL read model.

Temporal refs are resolved in the daemon because commit, timestamp and snapshot resolution require replay scope and store access. Core diff stays pure and only compares two graph states.

At 10x graph size, the first pressure point will be ranking quality and benchmarked latency, not mutation safety. This slice therefore preserves deterministic budgets and exposes reason codes, while leaving AL7-14 benchmarking as a separate acceptance gate.

## Verification

Focused verification passed:

```bash
bun run typecheck
bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 90000
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 90000
bun test packages/surfaces/cli/test/cli.test.ts -t "Book" --timeout 120000
bun test packages/surfaces/cli/test/cli.test.ts --timeout 120000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
bun test --timeout 90000
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-book-retrieval-verify-state-XXXXXX) bun run verify
```

The CLI Book fixture asserts:

- status includes freshness, graph digest, ledger cursor and counts
- query returns `capability.architecture-context` under an item budget
- show returns subject summary
- neighbors returns the requested node
- timeline returns affected subjects
- diff works for `empty`, `current`, `commit:<headSha>`, `timestamp:<iso>` and `snapshot:<snapshotId>`
- diff change records include `evidenceIds` and `evidenceBindingIds`
- evidence output omits raw README/source text
- recommendations and markdown export use stable envelopes

Readback:

- Full test suite passed: 777 tests, 0 failures.
- Root verify passed with isolated runtime state, including packaged CLI smoke, privacy/readback gates, acceptance ledgers, sprint-status check and representative eval.
