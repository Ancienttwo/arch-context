import { createHash, randomBytes } from "node:crypto";

export interface OAuthPkceRequest {
  authorizationUrl: string;
  codeVerifier: string;
  codeChallenge: string;
  scopes: string[];
}

export interface AccessTokenClaims {
  aud: string;
  scope: string;
  exp: number;
}

export interface OfflineEntitlement {
  accountId: string;
  plan: "free" | "pro";
  billingInterval: "none" | "monthly" | "annual";
  privateRepositoryScope: "public-only" | "user-all-private-repositories";
  offlineUntil?: string;
}

export function createPkceAuthorizationRequest(input: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  verifier?: string;
}): OAuthPkceRequest {
  const codeVerifier = input.verifier ?? randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const url = new URL("/oauth/authorize", input.issuer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("scope", input.scopes.join(" "));
  if (input.state) url.searchParams.set("state", input.state);
  return { authorizationUrl: url.toString(), codeVerifier, codeChallenge, scopes: input.scopes };
}

export function validateAccessTokenClaims(claims: AccessTokenClaims, input: { audience: string; requiredScopes: string[]; nowEpochSeconds: number }): void {
  if (claims.aud !== input.audience) throw new Error("Invalid token audience");
  if (claims.exp <= input.nowEpochSeconds) throw new Error("Access token expired");
  const scopes = new Set(claims.scope.split(/\s+/).filter(Boolean));
  for (const scope of input.requiredScopes) {
    if (!scopes.has(scope)) throw new Error(`Missing token scope: ${scope}`);
  }
}

export function buildGitHubHeaders(input: { githubToken: string; archcontextAccessToken?: string }) {
  if (input.archcontextAccessToken) throw new Error("ArchContext SaaS token must not be forwarded to GitHub");
  return { authorization: `Bearer ${input.githubToken}`, accept: "application/vnd.github+json" };
}

export class KeychainTokenStore {
  private readonly refreshTokenRefs = new Map<string, string>();

  saveRefreshToken(accountId: string, refreshToken: string): string {
    const ref = `keychain://archcontext/${accountId}`;
    this.refreshTokenRefs.set(ref, refreshToken);
    return ref;
  }

  readRefreshToken(ref: string): string | undefined {
    return this.refreshTokenRefs.get(ref);
  }

  clear(ref: string): void {
    this.refreshTokenRefs.delete(ref);
  }
}

export function createShortAccessToken(accountId: string, nowEpochSeconds: number, ttlSeconds = 900) {
  return {
    token: `access_${accountId}_${nowEpochSeconds}`,
    claims: {
      aud: "archcontext",
      scope: "account:read device:write entitlement:read",
      exp: nowEpochSeconds + ttlSeconds
    }
  };
}

export function isOfflineEntitlementActive(entitlement: OfflineEntitlement, now: string): boolean {
  if (entitlement.plan !== "pro") return false;
  if (entitlement.privateRepositoryScope !== "user-all-private-repositories") return false;
  return Boolean(entitlement.offlineUntil && entitlement.offlineUntil > now);
}

export function describeEntitlementScope(entitlement: OfflineEntitlement): string {
  if (entitlement.plan !== "pro") return "public repositories only";
  return `${entitlement.billingInterval} personal Pro covers all private repositories the user can access`;
}
