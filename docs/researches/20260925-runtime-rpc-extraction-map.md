# Runtime RPC extraction map — issue #164

Inspected baseline: PR #202 head `52fa3f3`, now merged as `e376b5b`. This is an implementation map, not acceptance evidence.

## Map

`runtime-daemon/src/index.ts` contains the public `RuntimeDaemonClient` interface, `ArchctxDaemon`, the HTTP client and server. The interface describes 59 methods. CLI and MCP import the facade path `@archcontext/local-runtime/runtime-daemon`; that public path must remain stable.

The first extraction boundary is transport. Move the wire types and connection/options contracts to `rpc-protocol.ts`, the HTTP client/timeout/error handling to `rpc-client.ts`, and the server/lifecycle/auth/body limits/dispatch to `rpc-server.ts`. Keep composition and connection-file factories in the facade until their ownership is separated. Re-export the public API from the original entrypoint.

## Trace and constraints

A client wrapper encodes positional arguments, selects a timeout, and sends JSON to the HTTP server. The server checks loopback authority, RPC version, token, and request size, then its switch decodes the tuple and calls the daemon handler. Developer-review routes have stricter raw-data decoders; these cannot be replaced with unchecked generic casts. Health is a GET route and shutdown is transport lifecycle, not one of the 59 domain methods.

The server should depend on a structural target contract, not import a concrete daemon value. New transport modules must not import runtime values back from `index.ts`, which would create a composition cycle. Preserve parameter defaults, wire ordering, synchronous/async return contracts, timeout selection and raw developer-review responses.

## Delivery slices

1. Move-only transport extraction and matching tests; no feature-service redesign in the same diff.
2. Introduce the single typed method table and derive both client and server dispatch. The table must cover parameter tuples, timeout class, wire response kind, encoding and decoding; merely checking method names leaves the duplication intact.
3. Extract individual feature services with explicit daemon context, then deduplicate helpers and declare new component nodes through ChangeSet.

#164 stays open until adding a method needs one table entry and its handler, feature logic leaves the facade, and public consumers retain their API.

## Verification

Run typecheck and package-boundary audit after extraction; run the existing RPC, health/version/auth, developer-review raw-response and refactor dispatch tests. Every shipping extraction also requires the full suite per the issue. Module moves change no write authority or persisted format. At higher traffic the same transport/daemon work remains the limiting factor; this is maintainability work, not a throughput claim.

## Implemented first slice

The client and public protocol declarations are now separate modules; the facade re-exports them and still owns server dispatch. The moved modules reference feature DTOs through erased type-only imports, without a runtime import back to the facade. The client timeout, cancellation and keep-alive race tests moved alongside the client and import it directly.

The self-model declares an RPC client/protocol component and a facade-to-client relation; the facade footprint excludes the two moved files. These changes were applied through daemon ChangeSet and model validation passed. The one-table dispatcher and feature service extraction remain open work for #164.

Verification for this slice: all 15 moved declarations have exact AST declaration-text parity with the baseline; 12 RPC integration/transport tests pass. Full `bun run verify` passes with 1917 tests and zero failures, including typecheck and package-boundary checks.
