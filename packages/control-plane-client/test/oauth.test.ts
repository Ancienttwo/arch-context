import { describe, expect, test } from "bun:test";
import { buildGitHubHeaders, createPkceAuthorizationRequest, validateAccessTokenClaims } from "../src/index";

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
});
