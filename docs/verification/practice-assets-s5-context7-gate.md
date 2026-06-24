# Practice Assets S5 Context7 Gate

## P1 Map

The S5 slice adds a privacy-bounded external documentation surface around
Context7 without changing the deterministic practice engine.

- Contract boundary: `packages/contracts/src/external-docs.ts` and
  `schemas/runtime/external-document-resource.schema.json`.
- Runtime boundary: `ExternalDocumentationPort` is consumed only by
  `packages/local-runtime/runtime-daemon/src/index.ts`.
- Adapter boundary: `packages/local-runtime/context7-adapter/src/index.ts`
  owns Context7 REST transport, outbound validation, and advisory resource
  projection.
- Persistence boundary: `packages/local-runtime/local-store-sqlite/src/index.ts`
  owns `external_docs_cache`.
- User surface: `packages/surfaces/cli/src/main.ts` owns
  `archctx docs status|resolve|pin|fetch|purge`.
- MCP surface: `packages/surfaces/mcp-local/src/index.ts` exposes read-only
  `resources/list` and `resources/read` for daemon-owned external-docs URIs.
- Verification surface:
  `scripts/practice-context7-readback.ts` and
  `docs/verification/practice-context7-readback.json`.

Out of scope for this slice: live Context7 provider readback with a real API
key, and turning external docs into enforceable practice constraints.

## P2 Trace

The concrete path is:

1. `archctx docs status` opens the local daemon and reports provider health with
   default `enabled=false`, `egress=none`, and `defaultPrepareEgress=none`.
2. `archctx docs resolve --allow-network --library React --query "state hooks"`
   calls `ExternalDocumentationPort.resolve` through the manual provider path.
   Without `--allow-network`, daemon returns a schema error before provider
   access.
3. `archctx docs pin --library-id /facebook/react --version 18.2.0 --approved`
   writes `.archcontext/integrations/context7.lock.yaml`.
4. `archctx docs fetch --library-id /facebook/react --intent "state hooks"
   --allow-network` resolves the pinned version, builds a bounded query, checks
   SQLite by provider/library/version/query digest, calls the provider only on
   cache miss, stores the advisory resource, and returns a local
   `archcontext://external-docs/context7/<digest>` URI.
   The Context7 adapter wraps the provider call with a bounded timeout, retry
   budget, local rate limit, and circuit breaker. Telemetry records only
   provider, operation, query digest, status, latency, byte count, library ID,
   and version.
5. A second fetch with the same exact library/version/query returns
   `cacheStatus=fresh` and does not call the provider.
6. `McpLocalServer.resources/list` projects cached daemon resources as
   `archcontext://external-docs/context7/<digest>` entries, and
   `resources/read` calls `RuntimeDaemonClient.readResource(root, uri)`. The
   daemon validates the URI shape and reads by provider/content digest from
   SQLite; unsupported URIs and cache misses return schema errors rather than
   network access. No generic HTTP/fetch MCP tool is added.
7. `prepare` keeps default egress at zero. When a caller explicitly configures
   the provider in `prepare-unknowns` mode, the daemon first requires compiled
   context to expose dependency/version pressure, then confirms a pinned Context7
   library ID and an exact package version from `package-lock.json` or
   `package.json`; fuzzy versions such as `^18.2.0` do not trigger provider
   access.
8. A matching `prepare` appends only an advisory `external-docs` resource and
   an untrusted unknown to task context. It does not write constraints,
   realConstraints, or practiceGuidance resources.
9. `complete` runs after the fetch/prepare path without increasing provider
   call count.
10. The failure matrix reruns the same task against disabled, no-key,
    no-network, 429, timeout, and malformed provider shapes. Disabled short
    circuits before fetch; the other cases fail during provider fetch and fall
    back to the static Local Core result.

The pressure points were cache ownership and provider failure shape. The daemon
writes cache records using the daemon-computed sanitized query digest rather
than trusting a provider returned digest, while the adapter classifies
429/timeout/malformed/transport failures before they reach runtime fallback.

## P3 Decision

The design keeps external documentation outside Local Core authority. Context7
can add bounded reference material for a pinned library/version, but the local
daemon still owns cache keys, trust labels, exact-version discovery, and command
approval. At 10x scale, the first failure point would be uncontrolled provider
calls during hard gates, so this slice restricts automatic calls to explicit
`prepare-unknowns` mode and verifies zero checkpoint/complete provider
references.

The smallest coherent change was a port plus one adapter, one cache table, and
manual CLI commands plus one daemon-level prepare augmentation. Provider
resilience stays in the adapter instead of widening `ExternalDocumentationPort`,
which preserves the existing repo pattern: contracts first, daemon-owned state,
thin CLI, and executable evidence.

## Evidence

- `bun test scripts/practice-context7-readback.test.ts`
- `bun run record:s5:context7`
- `bun run readback:s5:context7`
- `bun test packages/local-runtime/context7-adapter/test/context7-adapter.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts scripts/practice-context7-readback.test.ts --timeout 20000`
- `bun test packages/local-runtime/context7-adapter/test/context7-adapter.test.ts packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts`
- `bun test packages/contracts/test/contracts.test.ts`
- `bun run typecheck`

Observed readbacks:

- Context7 adapter tests pass request minimization, DLP rejection, advisory
  resource checks, metadata-only telemetry, retry budget, local rate limit,
  circuit breaker, TTL projection, and malformed response classification.
- Runtime daemon test proves manual pin/fetch cache replay and no provider calls
  from complete; prepare-unknowns uses pinned exact versions, cache replay, and
  stale cache fallback when provider fetch fails after TTL expiry. The failure
  matrix proves disabled/no-key/no-network/429/timeout/malformed cases keep
  practice IDs, constraints, real constraints, posture, pressure, and complete
  output unchanged with zero external-docs resources added.
- MCP tests prove external-docs resources list/read through daemon cache and
  loopback RPC, while unsupported external URIs are not fetched.
- CLI test proves docs commands require explicit approval and `--allow-network`.
- S5 readback evidence proves default egress zero, allowlisted outbound fields,
  metadata-only provider telemetry, DLP interception, exact-version cache
  replay, prepare-unknowns advisory-only resource insertion, provider failure
  fallback, full provider failure matrix invariance, MCP read-only external
  resource access, no generic HTTP tool, and zero hard-gate provider references.
