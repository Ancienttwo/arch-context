import { describe, expect, test } from "bun:test";
import {
  Context7ExternalDocumentationAdapter,
  assertSafeOutboundText,
  buildContext7Query,
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
