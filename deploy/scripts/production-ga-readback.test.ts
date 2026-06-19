import { describe, expect, test } from "bun:test";
import { buildReadbackConfig, preflightReadback, runExternalReadback } from "./production-ga-readback.mjs";

describe("production GA external readback script", () => {
  test("preflight blocks production when endpoint and external evidence are missing", () => {
    const config = buildReadbackConfig({}, ["--environment", "production", "--json"]);
    const result = preflightReadback(config);
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("missing ARCHCONTEXT_PRODUCTION_BASE_URL or ARCHCONTEXT_READBACK_BASE_URL");
    expect(result.blockers.some((blocker) => blocker.includes("GPT App Directory"))).toBe(true);
    expect(result.blockers.some((blocker) => blocker.includes("provider delivery"))).toBe(true);
  });

  test("staging readback can verify endpoint responses and writes redacted HAR", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      const body = url.endsWith("/chatgpt/directory")
        ? JSON.stringify({ slug: "archcontext", repositoryContent: "local-runtime-only" })
        : url.endsWith("/privacy")
          ? "ArchContext privacy policy"
          : JSON.stringify({ issuer: "https://archcontext.example" });
      return new Response(body, { status: 200, headers: { "content-type": "application/json", "set-cookie": "session=secret" } });
    };
    const config = buildReadbackConfig({}, [
      "--environment",
      "staging",
      "--base-url",
      "https://archcontext.example",
      "--capture",
      "artifacts/test/staging-redacted.har.json"
    ]);
    const result = await runExternalReadback(config, fetchImpl);
    expect(result.status).toBe("verified");
    expect(result.checks.map((check: any) => check.id)).toEqual(["privacy", "chatgpt-directory-metadata", "oauth-discovery"]);
    expect(seen).toHaveLength(3);
  });
});
