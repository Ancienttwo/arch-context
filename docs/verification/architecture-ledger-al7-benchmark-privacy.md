# AL7 Book Benchmark And Privacy Readback

Date: 2026-06-26

## Scope

This closes AL7-14, AL7-15 and AL7-EG1 through AL7-EG4 for the architecture ledger sprint.

## P1 Map

The Book read path remains daemon-owned. Core architecture-ledger helpers own deterministic query, neighborhood, timeline, diff, evidence and recommendation shaping. Runtime daemon owns ledger replay, freshness and provenance envelopes. CLI forwards Book commands to the daemon. MCP exposes fixed read-only Book resources that also call the same daemon Book RPC.

Out of scope: AL8 scheduler policy, documentation projection placement and SQLite authority promotion.

## P2 Traced Path

```text
AL7 readback fixture
  -> core Book query/diff/evidence/recommendations over small/medium/large YAML import plans
  -> runtime daemon ledger rebuild from Git fixture
  -> archctx book status/export/timeline/diff/recommendations
  -> MCP archcontext://book/* resources
  -> semantic digest comparison and privacy scan
```

## P3 Decision

The smallest coherent change is a readback packet plus an explicit Book provenance envelope. The provenance field preserves the existing freshness contract and makes EG2 observable without giving CLI or MCP new write authority. At 10x graph size, ranking latency is the first pressure point; this packet tracks warm query p95 on representative synthetic fixture sizes before AL8 depends on Book output.

## Benchmark

Threshold: warm query p95 <= 300 ms.

| Fixture | Entities | Relations | Constraints | Cold query ms | Warm p95 ms | Gate |
|---|---:|---:|---:|---:|---:|---|
| small | 12 | 11 | 2 | 2.194 | 0.672 | pass |
| medium | 120 | 119 | 12 | 2.19 | 1.977 | pass |
| large | 360 | 359 | 36 | 8.389 | 7.08 | pass |

## Runtime Equivalence

| CLI command | MCP resource | Equivalent |
|---|---|---|
| `archctx book status` | `archcontext://book/status` | pass |
| `archctx book export --format json` | `archcontext://book/state` | pass |
| `archctx book timeline --max-items 100` | `archcontext://book/timeline` | pass |
| `archctx book diff --from empty --to current --max-items 100` | `archcontext://book/diff` | pass |
| `archctx book recommendations --max-items 100` | `archcontext://book/recommendations` | pass |

## Privacy

- Raw source sentinel leaked: no
- Forbidden response keys present: no
- Allowed Book evidence surface remains selectors, summaries, digests, freshness, provenance and reason codes.

## Verification

```bash
bun run record:al7:book
bun run readback:al7:book
bun test scripts/architecture-ledger-al7-book-readback.test.ts
bun test packages/surfaces/cli/test/cli.test.ts -t "CLI Book commands" --timeout 120000
bun test packages/surfaces/mcp-local/test/mcp-local.test.ts -t "Book readbacks" --timeout 120000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-benchmark-privacy-verify-state-XXXXXX) bun run verify
bun scripts/architecture-ledger-al7-book-readback.ts inspect --evidence docs/verification/architecture-ledger-al7-book-readback.json --json
```

Readback status: verified
