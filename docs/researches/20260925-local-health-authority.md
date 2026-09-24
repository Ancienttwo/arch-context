# Local health request authority — issue #171

## Map and trace

The daemon and Explorer bind loopback HTTP listeners. Runtime clients possess a token from the private connection file; Explorer clients receive a session token. Previously both `/health` handlers returned before token validation. Neither handler checked Host or Origin, so a page resolving an attacker-controlled hostname to loopback could reach health metadata. Token equality also used ordinary string equality.

Two regressions reproduce anonymous HTTP 200 responses before the fix. Authenticated probes with a foreign Host, foreign Origin, or opaque `Origin: null` must also be rejected.

## Decision

Require the endpoint's token for health, and enforce the listener's exact Host plus either no Origin (native clients) or the same origin (browser clients). Both RPC and Explorer share the same authority check. Explorer additionally checks the socket is loopback before handling any route. Compare token bytes with `timingSafeEqual` after a byte-length check.

`RuntimeRpcClient.health()` now sends its connection-file bearer token. Foreground-process acceptance uses that client; daemon ready output remains sanitized. Authentication does not trigger egress inspection unless the caller explicitly requests it. Existing RPC version checks, request size/time limits, token expiry/revocation and Explorer read-only behavior remain intact.

At larger request rates the added work is a URL parse and bounded header/token comparison per request, with no new persistent state or network calls. The trust boundary is local client authentication and browser origin isolation, not hostile processes sharing the same OS user.

## Scope and evidence

Eleven targeted runtime RPC/health/Explorer tests pass, including unauthorized health, foreign Host/Origin, deadlines and body bounds. Twenty-seven CLI tests covering daemon startup, recovery, doctor and MCP behavior passed; the foreground test was updated to read the private connection through `RuntimeRpcClient` and then passed independently. Full `bun run verify` passes: 1907 tests, zero failures, typecheck, boundaries and configured statistical gates.

Explorer's existing query-token navigation/SSE transport and Windows control-file ACL enforcement remain separate open portions of #171. This slice does not claim those are fixed.
