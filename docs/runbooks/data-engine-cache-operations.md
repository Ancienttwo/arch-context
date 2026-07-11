# Data Engine Cache Operations

> Scope: Explorer projection cache, dependency index, pins, and metadata-only
> operational metrics introduced by DE5.

## Authority rule

`.archcontext/` remains Git-visible product authority. Verified ledger events and
snapshots remain the runtime history boundary. Explorer cache rows, dependency rows,
pins, and metric aggregates are disposable: cache deletion cannot change any graph,
evidence, event, snapshot, or Git authority digest.

Do not edit `runtime.sqlite`, WAL/SHM files, cache rows, pins, or metrics with SQL.
Do not use cache contents to repair or invent authority. Use daemon-owned reads and
rebuild from the selected Git/ledger authority path.

## Policy

The default policy applies per storage repository/workspace scope:

| Limit | Default |
|---|---:|
| Entries | 128 |
| Serialized projection bytes | 64 MiB |
| Maximum age | 7 days |
| Concurrent pinned digests | 8 |
| Pin TTL | 15 minutes |

Every save runs retention. Startup removes dependency orphans, expires old pins, and
reapplies the same deterministic policy. Unexpired delta base/head pins are skipped;
all other candidates sort by invalid/expired status, least recent access, creation
time, and projection digest.

## Signals

`explorer_runtime_metrics` contains aggregate numeric samples only:

- `feed-lag` / `change-feed`
- `replay-tail-length` / `anchored-replay`
- `plan-rows-read` / `bounded-read-plan`
- `compile-time-ms` / `projection-compile`
- `cache-hit`, `cache-miss`, `cache-eviction`, `cache-rebuild`

Reason codes are allow-listed. Source bodies, raw diffs, prompt/completion bodies,
full CodeGraph output, secrets, arbitrary labels, and user content are forbidden.

## Diagnosis

1. Run `archctx status --json`, `archctx doctor --json`, and `archctx paths --json`.
2. Run `bun run readback:de5:data-engine` to verify the stored acceptance artifact.
3. A high `cache-miss` plus `cache-rebuild` rate with stable authority digests points
   to count/byte/age pressure. A high `feed-lag` points to daemon consumption delay.
4. A large `replay-tail-length` points to missing/rejected snapshot anchors. Run the
   architecture-ledger integrity/readback flow; do not compensate by pinning cache.
5. If a corrupt cache row fails integrity validation, stop the daemon and remove the
   local runtime state only through the documented local-state recovery workflow.

## Recovery verification

```bash
bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
bun run record:de5:data-engine
bun run readback:de5:data-engine
bun run verify
```

Expected properties:

- Restart cleanup is idempotent and leaves no dependency orphan.
- Unexpired delta bases remain readable; expired pins are cleared.
- Unpinned rows return within per-scope entry/byte limits.
- Clearing the projection cache produces a miss/rebuild, never a changed authority
  digest.
- All metrics remain numeric and use only the documented name/reason vocabulary.
