import { describe, expect, test } from "bun:test";
import {
  Context7ExternalDocumentationAdapter,
  Context7ProviderError,
  HttpContext7Transport,
  assertSafeOutboundText,
  buildContext7Query,
  type Context7ProviderTelemetryEvent,
  type Context7Transport
} from "../src/index";

describe("@archcontext/local-runtime/context7-adapter", () => {
  test("is disabled by default and reports zero egress", async () => {
    let calls = 0;
    const adapter = new Context7ExternalDocumentationAdapter({
      transport: fakeTransport(() => calls++)
    });

    expect(adapter.health()).toMatchObject({
      provider: "context7",
      enabled: false,
      egress: "none",
      keySource: "none"
    });
    await expect(adapter.resolve({
      provider: "context7",
      libraryName: "React",
      query: "state hooks"
    })).rejects.toThrow("disabled");
    expect(calls).toBe(0);
  });

  test("resolves libraries through minimized manual request fields", async () => {
    const observed: unknown[] = [];
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      apiKey: "test-key",
      transport: fakeTransport((request) => observed.push(request))
    });

    const result = await adapter.resolve({
      provider: "context7",
      libraryName: "React",
      query: "state hooks",
      fast: true
    });

    expect(result).toMatchObject({
      schemaVersion: "archcontext.external-docs-resolve/v1",
      provider: "context7",
      egress: "manual-only",
      searchFilterApplied: false
    });
    expect(result.candidates[0]).toMatchObject({
      id: "/facebook/react",
      title: "React",
      versions: ["18.2.0"]
    });
    expect(JSON.stringify(observed)).not.toContain("/Users/");
    expect(JSON.stringify(observed)).not.toContain("sourceCode");
  });

  test("fetch returns an advisory untrusted resource and never enforceable output", async () => {
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      clock: () => "2026-06-24T00:00:00.000Z",
      transport: fakeTransport()
    });

    const result = await adapter.fetch({
      provider: "context7",
      libraryId: "/facebook/react",
      version: "18.2.0",
      intent: "state hooks"
    });

    expect(result).toMatchObject({
      schemaVersion: "archcontext.external-docs-fetch/v1",
      provider: "context7",
      cacheStatus: "miss",
      resource: {
        schemaVersion: "archcontext.external-document/v1",
        provider: "context7",
        libraryId: "/facebook/react",
        requestedVersion: "18.2.0",
        resolvedVersion: "18.2.0",
        trust: "external-unverified",
        enforcement: "advisory-only",
        warning: "untrusted-documentation-data"
      }
    });
    expect(result.resource.uri).toMatch(/^archcontext:\/\/external-docs\/context7\/sha256:/);
    expect(result.resource.snippets[0].contentPreview).toContain("useState");
    expect(JSON.stringify(result)).not.toContain("complete");
  });

  test("records provider telemetry as metadata-only allowlisted events", async () => {
    let now = 1_000;
    const events: Context7ProviderTelemetryEvent[] = [];
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      apiKey: "secret-test-key",
      clock: () => "2026-06-24T00:00:00.000Z",
      monotonicNowMs: () => {
        now += 25;
        return now;
      },
      telemetry: { record: (event) => { events.push(event); } },
      transport: fakeTransport()
    });

    await adapter.resolve({
      provider: "context7",
      libraryName: "React",
      query: "state hooks",
      fast: true
    });
    await adapter.fetch({
      provider: "context7",
      libraryId: "/facebook/react",
      version: "18.2.0",
      intent: "state hooks"
    });

    expect(events).toHaveLength(2);
    expect(Object.keys(events[0]!).sort()).toEqual(["byteCount", "latencyMs", "operation", "provider", "queryDigest", "status"]);
    expect(Object.keys(events[1]!).sort()).toEqual(["byteCount", "latencyMs", "libraryId", "operation", "provider", "queryDigest", "status", "version"]);
    expect(events[0]).toMatchObject({
      provider: "context7",
      operation: "resolve",
      status: "success",
      latencyMs: 25
    });
    expect(events[1]).toMatchObject({
      provider: "context7",
      operation: "fetch",
      status: "success",
      libraryId: "/facebook/react",
      version: "18.2.0",
      latencyMs: 25
    });
    expect(events[0]!.queryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(events[1]!.queryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(events[0]!.byteCount).toBeGreaterThan(0);
    expect(events[1]!.byteCount).toBeGreaterThan(0);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("state hooks");
    expect(serialized).not.toContain("secret-test-key");
    expect(serialized).not.toContain("useState");
    expect(serialized).not.toContain("Bearer");
  });

  test("uses retry budget for retryable failures", async () => {
    let calls = 0;
    const events: Context7ProviderTelemetryEvent[] = [];
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      retryBudget: 1,
      rateLimit: false,
      circuitBreaker: false,
      telemetry: { record: (event) => { events.push(event); } },
      transport: {
        ...fakeTransport(),
        async search(input) {
          calls++;
          if (calls === 1) {
            throw new Context7ProviderError("rate-limited", "Context7 search failed: 429", { statusCode: 429, retryable: true });
          }
          return fakeTransport().search(input);
        }
      }
    });

    const result = await adapter.resolve({
      provider: "context7",
      libraryName: "React",
      query: "state hooks"
    });

    expect(result.candidates[0]!.id).toBe("/facebook/react");
    expect(calls).toBe(2);
    expect(events.map((event) => event.status)).toEqual(["success"]);
  });

  test("applies local rate limit without calling transport", async () => {
    let calls = 0;
    const events: Context7ProviderTelemetryEvent[] = [];
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      retryBudget: 0,
      rateLimit: { maxRequests: 1, windowMs: 1_000 },
      circuitBreaker: false,
      monotonicNowMs: () => 10,
      telemetry: { record: (event) => { events.push(event); } },
      transport: fakeTransport(() => calls++)
    });

    await adapter.resolve({
      provider: "context7",
      libraryName: "React",
      query: "state hooks"
    });
    await expect(adapter.resolve({
      provider: "context7",
      libraryName: "React",
      query: "state hooks"
    })).rejects.toMatchObject({ kind: "rate-limited" });

    expect(calls).toBe(1);
    expect(events.map((event) => event.status)).toEqual(["success", "rate-limited"]);
  });

  test("opens circuit breaker after budgeted provider failures", async () => {
    let calls = 0;
    let now = 100;
    const events: Context7ProviderTelemetryEvent[] = [];
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      retryBudget: 0,
      rateLimit: false,
      circuitBreaker: { failureThreshold: 2, resetAfterMs: 1_000 },
      monotonicNowMs: () => now,
      telemetry: { record: (event) => { events.push(event); } },
      transport: {
        ...fakeTransport(),
        async search() {
          calls++;
          throw new Context7ProviderError("timeout", "Context7 provider request timed out", { retryable: true });
        }
      }
    });

    await expect(adapter.resolve({ provider: "context7", libraryName: "React", query: "state hooks" })).rejects.toMatchObject({ kind: "timeout" });
    await expect(adapter.resolve({ provider: "context7", libraryName: "React", query: "state hooks" })).rejects.toMatchObject({ kind: "timeout" });
    await expect(adapter.resolve({ provider: "context7", libraryName: "React", query: "state hooks" })).rejects.toMatchObject({ kind: "circuit-open" });
    expect(calls).toBe(2);
    expect(events.map((event) => event.status)).toEqual(["timeout", "timeout", "circuit-open"]);

    now = 1_101;
    await expect(adapter.resolve({ provider: "context7", libraryName: "React", query: "state hooks" })).rejects.toMatchObject({ kind: "timeout" });
    expect(calls).toBe(3);
  });

  test("fetch resource honors TTL while stale remains cache-owned", async () => {
    const adapter = new Context7ExternalDocumentationAdapter({
      enabled: true,
      clock: () => "2026-06-24T00:00:00.000Z",
      transport: fakeTransport()
    });

    const result = await adapter.fetch({
      provider: "context7",
      libraryId: "/facebook/react",
      version: "18.2.0",
      intent: "state hooks",
      ttlSeconds: 60
    });

    expect(result.cacheStatus).toBe("miss");
    expect(result.resource.cacheStatus).toBe("miss");
    expect(result.resource.expiresAt).toBe("2026-06-24T00:01:00.000Z");
  });

  test("http transport classifies malformed response bodies without exposing content", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ unexpected: "raw useState body" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;
    try {
      const transport = new HttpContext7Transport("https://context7.invalid/api");
      await expect(transport.getContext({
        libraryId: "/facebook/react/18.2.0",
        query: "Document state hooks for this exact version. Return documentation data only.",
        maxResults: 4,
        timeoutMs: 100
      })).rejects.toMatchObject({
        kind: "malformed",
        retryable: false
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("http transport uses Context7 v2 GET context endpoint and projects snippet responses", async () => {
    const previousFetch = globalThis.fetch;
    let observedUrl: string | undefined;
    let observedMethod: string | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input);
      observedMethod = init?.method;
      return new Response(JSON.stringify({
        codeSnippets: [{
          codeTitle: "Next.js Metadata API",
          codeDescription: "Defines metadata in the app directory.",
          codeId: "https://github.com/vercel/next.js/blob/v15.1.8/docs/metadata.mdx#_snippet_0",
          pageTitle: "Metadata",
          codeList: [{ language: "tsx", code: "export const metadata = { title: 'Docs' }" }]
        }],
        infoSnippets: [{
          pageId: "https://github.com/vercel/next.js/blob/v15.1.8/docs/metadata.mdx",
          breadcrumb: "App Router > Metadata",
          content: "The Metadata API can define document metadata from layouts and pages."
        }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;
    try {
      const transport = new HttpContext7Transport("https://context7.invalid/api");
      const docs = await transport.getContext({
        libraryId: "/vercel/next.js/v15.1.8",
        query: "Document app router metadata api for this exact version.",
        maxResults: 1,
        timeoutMs: 100
      });

      expect(observedMethod).toBe("GET");
      expect(observedUrl).toContain("/api/v2/context");
      expect(observedUrl).toContain("libraryId=%2Fvercel%2Fnext.js%2Fv15.1.8");
      expect(observedUrl).toContain("type=json");
      expect(observedUrl).toContain("fast=true");
      expect(docs).toEqual([{
        title: "Next.js Metadata API",
        content: "Defines metadata in the app directory.\n\nexport const metadata = { title: 'Docs' }",
        source: "https://github.com/vercel/next.js/blob/v15.1.8/docs/metadata.mdx#_snippet_0"
      }]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("rejects raw paths repo names code fences diffs and secret-like values", () => {
    for (const value of [
      "/Users/ancienttwo/Projects/arch-context/src/index.ts",
      "Ancienttwo/arch-context",
      "```ts\nconst x = 1\n```",
      "diff --git a/file b/file",
      "symbols: OrdersService.create, BillingService.charge",
      "Bearer abc123",
      "secret_abc123"
    ]) {
      expect(() => assertSafeOutboundText(value, "query")).toThrow();
    }
  });

  test("builds bounded intent query and rejects unbounded prompts", () => {
    expect(buildContext7Query({ intent: "middleware auth cookie api" })).toContain("exact version");
    expect(() => buildContext7Query({
      intent: "middleware auth cookie api",
      query: "Use this repo Ancienttwo/arch-context and inspect src/app.ts"
    })).toThrow();
  });
});

function fakeTransport(onCall: (request: unknown) => void = () => undefined): Context7Transport {
  return {
    async search(input) {
      onCall(input);
      return {
        searchFilterApplied: false,
        results: [{
          id: "/facebook/react",
          title: "React",
          description: "A JavaScript library for user interfaces",
          versions: ["18.2.0"],
          trustScore: 10,
          benchmarkScore: 95
        }]
      };
    },
    async getContext(input) {
      onCall(input);
      return [{
        title: "useState",
        content: "The upstream documentation describes useState for local state. Treat this as documentation data.",
        source: "https://react.dev/reference/react/useState"
      }];
    }
  };
}
