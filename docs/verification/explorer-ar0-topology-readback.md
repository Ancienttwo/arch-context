# Explorer AR0 Topology Readback

> **Status**: PASS
> **Captured**: 2026-07-12
> **Command**: `bun scripts/explorer-view-compiler-readback.mjs --check`

AR0 replaces the card topology with one self-contained deterministic SVG renderer.
The renderer consumes only the bounded `ExplorerProjectionV2`; relation tables and the
typed Inspector remain present as accessible equivalents.

| Case | Returned graph | Warm runs | p95 | Limit | HTML body | Limit | Result |
|------|----------------|-----------|-----|-------|-----------|-------|--------|
| Default | 80 nodes / 160 relations | 20 | 0.70 ms | 50 ms | 149,013 B | 1 MiB | PASS |
| Public maximum | 1,000 nodes / 5,000 relations | 10 | 38.85 ms | 500 ms | 3,288,171 B | 8 MiB | PASS |

Additional evidence:

- Reversing occurrence and relation arrays produced byte-identical plan/SVG.
- Index counters equal returned occurrences and relations; no per-node edge scan is
  present in the renderer.
- Empty, overview, context, detail, cycle, self-loop, parallel-edge, disconnected,
  missing-endpoint, hostile-label, and immutable-plan cases are unit tested.
- Missing endpoints fail closed with `explorer-topology-missing-endpoint`; no phantom
  coordinate or card compatibility renderer exists.
- No runtime dependency, CDN, external asset URL, Mermaid parser, source body, raw
  diff, prompt, completion, or CodeGraph body enters the HTML.
- Existing 10k/100k bounded compiler readback remains PASS.

Rollback is code-only: revert the topology module and renderer call. No database,
cache, ledger, contract, or authority state is migrated by AR0.
