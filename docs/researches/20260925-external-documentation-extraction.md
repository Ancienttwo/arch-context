# External documentation service extraction — issue #164

Baseline: integrated extraction batch `5adf469d`. This is a move-only slice; full verification and hosted CI are tracked in the PR.

## P1 — ownership

`external-documentation.ts` owns Context7 status/resolve/pin/fetch/purge, cache resource reads, prepare augmentation and their exclusive lockfile/version/context helpers. Public DTOs are re-exported through the daemon entrypoint. The facade constructs one provider object and passes the same object to the service; egress reporting reads that original provider. There is no second provider authority or runtime import back into the facade.

## P2 — trace and write boundary

Manual resolve/fetch retain their explicit network flag and exact pinned version requirements. Cache keys and TTL handling are unchanged. Resource reads remain content-digest scoped and never fetch. Prepare augmentation remains advisory under the existing provider health/mode gate, exact package version match and budget calculation.

Approved pins still call the daemon's writer/recovery guard, read lock bytes and expected hash inside that guard, and use the existing symlink-resistant writer. Preview, private mode, optimistic concurrency and exception mapping are unchanged. Provider failure behavior and defaults are preserved.

## P3 — tradeoff

The service receives session, writer, clock, provider and cache ports; it does not own daemon lifecycle or transactional authority. At 10x usage, provider latency, cache storage and package-version scanning retain their current costs. This extraction claims maintainability improvement only.

## Verification

Normalized parity holds for all moved command/resource/augmentation method bodies, DTOs, constants, private helpers and nine existing tests. Those tests plus Context7 readback fixture checks pass (16 tests, 113 assertions); MCP and S6 readback fixture checks pass (20 tests, 163 assertions). Typecheck and package boundaries pass. The component/exclusion and dependency relations were applied through ChangeSet with valid model readback.

S6's purge source guard now also reads the extracted service. Running the actual S6 readback before and after extraction produces identical evidence and failures. `context7PurgeCommandImplemented` remains true. The pre-existing `centralHook.hookReadmeCentralFirst` failure and its aggregate `centralHookComplete` failure remain; no passing S6 release readback is claimed. Historical readback drift remains in #171.
