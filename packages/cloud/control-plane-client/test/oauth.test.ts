import { describe, expect, test } from "bun:test";
import {
  buildGitHubHeaders,
  createPkceAuthorizationRequest,
  describeEntitlementScope,
  isOfflineEntitlementActive,
  validateAccessTokenClaims
} from "../src/index";

describe("control-plane client auth", () => {
  test("creates OAuth 2.1 PKCE request", () => {
    const request = createPkceAuthorizationRequest({
      issuer: "https://api.archcontext.dev",
      clientId: "archctx",
      redirectUri: "http://127.0.0.1/callback",
      scopes: ["account:read", "device:write"],
      verifier: "fixed-verifier"
    });
    expect(request.authorizationUrl).toContain("code_challenge_method=S256");
    expect(request.authorizationUrl).toContain("scope=account%3Aread+device%3Awrite");
  });

  test("validates audience, scope, expiry, and refuses SaaS token forwarding to GitHub", () => {
    expect(() =>
      validateAccessTokenClaims({ aud: "archcontext", scope: "account:read device:write", exp: 100 }, {
        audience: "archcontext",
        requiredScopes: ["device:write"],
        nowEpochSeconds: 1
      })
    ).not.toThrow();
    expect(() => validateAccessTokenClaims({ aud: "other", scope: "account:read", exp: 100 }, { audience: "archcontext", requiredScopes: [], nowEpochSeconds: 1 })).toThrow("audience");
    expect(() => buildGitHubHeaders({ githubToken: "gh", archcontextAccessToken: "arch" })).toThrow("must not be forwarded");
  });

  test("handles annual offline entitlement as user-level private access", () => {
    const entitlement = {
      accountId: "acct_42",
      plan: "pro" as const,
      billingInterval: "annual" as const,
      privateRepositoryScope: "user-all-private-repositories" as const,
      offlineUntil: "2026-06-26T00:00:00Z"
    };
    expect(isOfflineEntitlementActive(entitlement, "2026-06-20T00:00:00Z")).toBe(true);
    expect(isOfflineEntitlementActive(entitlement, "2026-06-27T00:00:00Z")).toBe(false);
    expect(describeEntitlementScope(entitlement)).toContain("all private repositories");
  });
});
