# AL7 MCP Book Resources Verification

Date: 2026-06-26

## Scope

This closes AL7-09 and AL7-10 for the architecture ledger sprint.

Implemented behavior:

- `archcontext://book/status` exposes Book freshness, drift, counts and supported commands as a read-only MCP resource.
- `archcontext://book/state` exposes the current metadata-only Book state through the daemon Book export path.
- `archcontext://book/timeline` exposes recent Book timeline events with freshness metadata.
- `archcontext://book/diff` exposes the default `empty` to `current` Book diff with deterministic readback.
- `archcontext://book/recommendations` exposes Book recommendations with freshness metadata.
- The local MCP tool surface remains the same six workflow tools: prepare, practices, checkpoint, plan update, apply update and complete task.
- Remote Windows Node 25 verification hardening keeps daemon start readiness, Developer Review cleanup and SQLite deletion fixtures from failing on transient hosted-runner file locks.

Out of scope for this slice:

- AL7-11 context compiler consumption of ledger queries.
- AL7-12 explain mode.
- AL7-13 FTS fallback.
- AL7-14 latency benchmark.
- AL7-15 full privacy audit beyond the metadata-only MCP resource fixture assertion.
- AL7-EG2 and AL7-EG4, which require broader all-response provenance and CLI/MCP equivalence coverage.

## P1 Map

The MCP boundary remains read-mostly and local daemon owned.

`@archcontext/surfaces/mcp-local` owns resource discovery and resource reads. It now publishes fixed Book resource URIs alongside existing budget-overflow resources and daemon-cached external documentation resources. It still does not own ledger mutation authority.

`@archcontext/local-runtime/runtime-daemon` remains the Book source of truth. MCP resource reads map URI to `RuntimeDaemonClient.book(root, input)` and return the daemon JSON envelope. The MCP layer does not reimplement Book ranking, diffing, freshness construction or temporal logic.

`archcontext_plan_update` and `archcontext_apply_update` remain the only MCP write-oriented workflow tools. No query-specific MCP tools were added for status, state, timeline, diff or recommendations.

## P2 Traced Path

Resource list path:

```text
resources/list
  -> McpLocalServer.listResources(root)
  -> fixed archcontext://book/* resource definitions
  -> existing local budget resources
  -> existing daemon Context7 cache resource discovery
```

Resource read path:

```text
resources/read archcontext://book/diff
  -> McpLocalServer.readResource(uri, root)
  -> architectureBookResourceInput(uri)
  -> RuntimeDaemonClient.book(root, { command: "diff", fromRef: "empty", toRef: "current", maxItems: 100 })
  -> ArchctxDaemon.book
  -> architectureLedgerReadback + replayArchitectureLedger
  -> diffArchitectureLedgerBookStates
  -> daemon JSON envelope returned as MCP resource content
```

Mutation path:

```text
archcontext_plan_update / archcontext_apply_update
  -> existing ChangeSet preview/apply workflow
  -> daemon-owned write path
```

No Book resource read crosses into ChangeSet apply or direct SQLite mutation.

## P3 Decision

The smallest coherent change is fixed MCP resources over the Book RPC. This satisfies LLM consumption without expanding the MCP tool list into one tool per query.

The URI mapping stays in `mcp-local` because MCP owns resource naming. The Book semantics stay in `runtime-daemon` because freshness, authority mode, replay scope and temporal refs are daemon concerns.

At 10x graph size, the first pressure point is resource payload size for `archcontext://book/state` and `archcontext://book/diff`. This slice keeps timeline, diff and recommendations item-bounded at 100 and leaves AL7-14 as the benchmark gate before changing defaults.

## Verification

Focused verification passed:

```bash
bun test packages/surfaces/mcp-local/test/mcp-local.test.ts --timeout 120000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "computes Developer Review digest bundle" --timeout 90000
bun test packages/surfaces/cli/test/cli.test.ts -t "CLI recovers stale daemon control files|CLI rebuild reproduces graph" --timeout 240000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000
bun test packages/surfaces/cli/test/cli.test.ts --timeout 240000
bun test --timeout 90000
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-mcp-resources-verify-state-XXXXXX) bun run verify
```

The MCP fixture asserts:

- the tool surface still equals the existing six workflow tools
- `resources/list` includes `archcontext://book/status`, `state`, `timeline`, `diff` and `recommendations`
- resource reads route through daemon Book RPC and carry `archcontext.book-freshness/v1`
- a rebuilt ledger fixture produces non-empty timeline and diff readbacks
- Book status resource counts match direct daemon Book status counts
- Book resource payloads do not contain `sourceCode`
- Windows hosted-runner hardening preserves daemon crash recovery behavior while allowing slower Node 25 readiness and file-lock release.

Readback:

- Full test suite passed: 778 tests, 0 failures.
- Root verify passed with isolated runtime state, including packaged CLI smoke, privacy/readback gates, acceptance ledgers, sprint-status check and representative eval.
