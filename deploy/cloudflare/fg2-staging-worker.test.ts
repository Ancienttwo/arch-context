import { createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "bun:test";
import worker from "./fg2-staging-worker";

const webhookSecret = "test-webhook-secret";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

const env = {
  ARCHCONTEXT_ENV: "staging",
  GITHUB_API_BASE_URL: "https://api.github.test",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY_PEM: privateKeyPem,
  GITHUB_WEBHOOK_SECRET: webhookSecret,
  FG2_STAGING_REPOSITORY: "Ancienttwo/arch-context"
};

describe("fg2 staging Cloudflare Worker", () => {
  test("reports health without exposing secret material", async () => {
    const response = await worker.fetch(new Request("https://worker.example/health"), env);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      service: "archcontext-fg2-staging",
      webhookPath: "/v1/github/webhooks"
    });
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
  });

  test("rejects invalid GitHub webhook signatures before projection", async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/github/webhooks", {
      method: "POST",
      body: "{}",
      headers: {
        "x-github-delivery": "delivery-invalid",
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000"
      }
    }), env);
    expect(response.status).toBe(401);
  });

  test("creates and updates a check for a signed pull_request event without code-content API calls", async () => {
    const calls: { method: string; path: string; body?: unknown; authorization?: string | null }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined,
        authorization: init?.headers instanceof Headers ? init.headers.get("authorization") : (init?.headers as Record<string, string> | undefined)?.authorization
      });
      if (url.pathname === "/app/installations/123/access_tokens") {
        return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
      }
      if (url.pathname === "/repositories/987/pulls/42") {
        return new Response(JSON.stringify({
          head: { sha: "def456def456def456def456def456def456def4" },
          base: { sha: "abc123abc123abc123abc123abc123abc123abcd" }
        }), {
          status: 200,
          headers: { "x-github-request-id": "pull-head-req" }
        });
      }
      if (url.pathname === "/repositories/987/check-runs") {
        return new Response(JSON.stringify({ id: 456, html_url: "https://github.test/checks/456" }), {
          status: 201,
          headers: { "x-github-request-id": "create-req" }
        });
      }
      if (url.pathname === "/repositories/987/check-runs/456") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "x-github-request-id": "update-req" }
        });
      }
      return new Response(JSON.stringify({ message: "unexpected" }), { status: 404 });
    }) as typeof fetch;

    try {
      const rawBody = JSON.stringify({
        action: "opened",
        installation: { id: 123 },
        repository: {
          id: 987,
          name: "arch-context",
          full_name: "Ancienttwo/arch-context",
          owner: { login: "Ancienttwo" },
          private: true
        },
        pull_request: {
          number: 42,
          head: { sha: "abc123abc123abc123abc123abc123abc123abcd" }
        }
      });
      const response = await worker.fetch(new Request("https://worker.example/v1/github/webhooks", {
        method: "POST",
        body: rawBody,
        headers: {
          "x-github-delivery": "delivery-pr",
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(rawBody)
        }
      }), env);

      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body.status).toBe("check_updated");
      expect(body.headSha).toBe("def456def456def456def456def456def456def4");
      expect(body.rawBodyRetained).toBe(false);
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /app/installations/123/access_tokens",
        "GET /repositories/987/pulls/42",
        "POST /repositories/987/check-runs",
        "PATCH /repositories/987/check-runs/456"
      ]);
      expect(calls.find((call) => call.path === "/repositories/987/check-runs")?.body).toMatchObject({
        head_sha: "def456def456def456def456def456def456def4"
      });
      expect(calls.some((call) => /\/files|\/contents|\/git\/blobs|\/git\/trees|\.(diff|patch)$/.test(call.path))).toBe(false);
      expect(JSON.stringify(calls)).not.toContain("diff");
      expect(JSON.stringify(calls)).not.toContain("patch");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stops before pull metadata and Check updates when installation access is revoked", async () => {
    const calls: { method: string; path: string }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({ method: init?.method ?? "GET", path: url.pathname });
      if (url.pathname === "/app/installations/123/access_tokens") {
        return new Response(JSON.stringify({ message: "installation suspended" }), { status: 403 });
      }
      return new Response(JSON.stringify({ message: "unexpected downstream call" }), { status: 500 });
    }) as typeof fetch;

    try {
      const rawBody = JSON.stringify({
        action: "opened",
        installation: { id: 123 },
        repository: {
          id: 987,
          name: "arch-context",
          full_name: "Ancienttwo/arch-context",
          owner: { login: "Ancienttwo" },
          private: true
        },
        pull_request: {
          number: 42,
          head: { sha: "abc123abc123abc123abc123abc123abc123abcd" }
        }
      });

      await expect(worker.fetch(new Request("https://worker.example/v1/github/webhooks", {
        method: "POST",
        body: rawBody,
        headers: {
          "x-github-delivery": "delivery-revoked",
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(rawBody)
        }
      }), env)).rejects.toThrow("github-installation-token-failed: 403");

      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /app/installations/123/access_tokens"
      ]);
      expect(calls.some((call) => /\/pulls\/42|\/check-runs/.test(call.path))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function sign(rawBody: string): string {
  return `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}
