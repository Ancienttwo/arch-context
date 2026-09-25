# RPC server extraction boundary — issue #164

Baseline: `6f9aa67` (main after PR #204 and #205). This slice extracts the server and its shared boundary helpers; it does not complete the single method table or feature-service work in #164.

## Ownership and trace

`ArchctxRuntimeRpcServer` owns HTTP lifecycle, loopback authority checks, bearer authentication, RPC-version handling, bounded body reads, dispatch and idle shutdown. Its constructor now takes a structural subset of `ArchctxDaemon`, imported only as a type. The HTTP client and public method contract live in `rpc-client.ts` and `rpc-protocol.ts`.

An accepted POST increments the in-flight counter before reading its body. Dispatch turns a ChangeSet recovery refusal into a typed precondition envelope. Developer-review calls use strict decoders and wrap raw domain responses; ordinary methods return their existing envelope. Preserve this order, including shutdown scheduling after the response and the idle activity recheck.

## Extracted dependency closure

- `rpc-server.ts`: server class, server options, idle timeout policy, request size/deadline constants, version-header helpers and bounded body reader.
- Daemon control files: connection-file paths/readers, stale-control recovery, private-mode check, lock acquisition and process liveness. Both facade factories and server lifecycle consume these functions; extract one shared implementation instead of importing runtime values back from the facade.
- Developer-review boundary codecs: the strict record/string/literal decoders are shared with the on-disk run manifest decoder. Move their complete dependency closure while retaining the daemon's manifest-validation call.
- Loopback HTTP helpers: `isLoopbackRemote` and `writeJson` have both RPC and Explorer consumers. Keep one implementation.
- ChangeSet recovery error: the daemon throws it and the transport uses `instanceof`. Retain one class identity and its existing public export when moving it out of the facade.

The server's target is a structural contract for RPC handlers and the lifecycle/health methods it actually calls. DTO references remain erased type imports during this move; no new transport module imports runtime values from `index.ts`. Existing public symbols are re-exported through the facade without exposing internal helpers there.

The lifecycle/health methods are `start`, `stop`, `status`, `hasActiveBackgroundWork`, `compositionReport`, and `egressReport`. The current four developer-review handlers have a different wire envelope from their domain result; three are synchronous on the daemon and the attestation call is awaited. Do not accidentally serialize a promise as a raw result when defining the structural target.

## Existing verification ownership

Ten server-focused cases now live in `runtime-daemon/test/rpc-server.test.ts`: failed-start store ownership cleanup; loopback/version/token/single-lock behavior; explicit egress health reads; bounded uploads and deadlines; in-flight uploads preventing idle exit; client disconnect cleanup; stale/insecure control files; idle deadline reset; active audit abort controllers; and disabled idle exit. Shared fixture functions are extracted once into `runtime-test-fixtures.ts`. The queued-job integration case remains with the daemon suite.

Developer-review RPC cases cover start/sign/cleanup/recovery plus caller-selected roots and malformed manifests. The untrusted worktree-digest profile case proves validation happens before plan/apply state changes. Preserve these integration cases even if pure transport tests move to a separate file; their filesystem, store and daemon authority is intentional.

The later method-table cutover must preserve client-side defaults, not just parameter types: for example `sync` sends `[]`, `context` sends `12`, `prepare` sends `12_288` and `12`, and job/audit list wrappers send `{}`. A generic argument forwarder would silently change the wire payload even when the daemon's default makes the visible result look identical.

## Constraints and verification

Keep this slice move-only. Preserve synchronous developer-review methods, positional ordering, defaults, timeout policy, exception identity, lock cleanup and privacy guards. Do not introduce a generic unchecked dispatcher while extracting files. The later typed method table must own argument tuples, timeout class, wire response kind and encoding/decoding together.

All 45 moved production declarations match the baseline, allowing only visibility/import changes and the structural constructor annotation. The ten moved test bodies and thirteen moved helper declarations retain exact text apart from export visibility. Twenty RPC client/server and daemon integration tests pass, as do typecheck and the package-boundary audit. The new component footprint and relations were applied through daemon ChangeSet; model validation reports no errors.

The facade retains the same 34 runtime exports. Full `bun run verify` passes with 1922 tests and zero failures, including all configured verification checks.

This extraction changes neither persisted formats nor write authority. At higher request volume the same body limits and daemon work remain the limiting factors; it makes no throughput claim. Feature-service extraction, the method table, helper deduplication across packages, and #165 remain open work.
