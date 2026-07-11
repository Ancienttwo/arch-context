# Explorer AR2 Inspector and Required History Readback

> **Status**: PASS
> **Captured**: 2026-07-12

AR2 performs one atomic pre-1.0 `ExplorerProjectionV2` cutover. Every subject Inspector
now requires `historyEvents`; there is no optional field, legacy reader, alternate
query, database migration, or event-body persistence path.

## Authority path

```text
bounded verified eventBacklinks in input manifest
  -> canonical eventId deduplication
  -> conflict rejection
  -> subject historyEvents (all)
  -> decisions (title/rationale subset)
  -> backlinks and projection delta evidence
  -> cache/RPC/CLI/HTML pass-through
```

- Identical duplicates merge unique sorted subject IDs.
- Conflicting title/rationale for one event ID fails with
  `conflicting-event-backlink:<eventId>`.
- Event-ID-only backlinks remain visible in History but not Decisions.
- Cross-scope backlinks do not enter returned subject Inspectors.
- Reversed backlink input produces the same manifest/projection digests.

## Cache cutover

- Pre-history view-definition digest:
  `sha256:8f85887437adf0fd1099216d6d28dd6cab7ef361b35072876ee6cefb4dfdb53f`
- Required-history view-definition digest:
  `sha256:5fe7c1dfa525b83e80589a6654be6914f14b2bc4197f3598de5d8497ad76dbcf`

Old cache rows are not rewritten or accepted through compatibility logic. The changed
view-definition digest makes them ordinary disposable manifest misses.

## Inspector parity

The focused HTML surface renders summary, responsibility, constraints, decisions,
complete history, selectors, evidence binding IDs, every typed backlink/relation ID,
authority/evidence cursors, and manifest/projection/graph/view-definition digests.
Hostile title/rationale values are escaped.

Contract, compiler, daemon, local-store, topology fixture, Explorer surface, CLI
pass-through, typecheck, `verify:explorer`, and `privacy-route-audit` all pass. Static
search finds zero optional `historyEvents?` or fallback history paths.
