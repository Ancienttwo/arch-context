# Explorer server extraction — issue #164

Status: targeted verification complete; full verification and hosted CI pending. Baseline: #216 head `38159512a743c49d5a4cccf2bb7ab007b34daf6d`.

## P1 — ownership

Explorer HTTP routing, SSE connections, session token state, timers, start/stop/revoke/status and invalidation delivery move into `explorer-server.ts`. The service owns its single session. The daemon retains projection compilation, delta readback, SQLite cache, ledger readback, feed drain and all mutation ownership; it supplies projection/delta callbacks and forwards invalidation notifications.

## P2 — trace

Start still closes the prior session, creates a token, binds loopback and schedules expiry against the same session identity. Requests retain the existing loopback and Host/Origin gate, GET-only gate, token comparison, route parsing and projection callback order. Expiry only affects the current session; stop clears timers, ends SSE clients and waits for server close before daemon shutdown releases storage ownership. Projection-digest deduplication and authority root matching move with their SSE delivery code.

## P3 — move boundary

The context has only running guard, clock and the two projection callbacks. All moved method/helper bodies retain normalized parity apart from context qualification and service visibility. Public DTOs are re-exported; all 34 runtime exports and the RPC table remain unchanged. Query-token transport is deliberately the existing behavior and stays unresolved in #171; this slice does not claim to harden it. At 10x clients, existing open SSE connection and projection compilation costs remain unchanged.

## Verification

The three existing HTTP/SSE/expiry/malformed-model tests move unchanged to the owning server test file. Shared bounded-projection and unavailable-facts tests stay at their daemon projection boundary. Together with the frontend runtime-script suite, targeted verification passes seven tests and 150 assertions. Source parity covers lifecycle, session identity, invalidation delivery, HTTP/auth/query helpers, CSP and DTOs. Typecheck, package boundaries and runtime export parity pass.

The service component, facade exclusion and callback/delegation relations were applied through daemon ChangeSet; model validation reports no errors. Full verification and hosted matrix results will be recorded in the PR once complete.
