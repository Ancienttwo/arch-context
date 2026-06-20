import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject
} from "node:crypto";
import { publicKeyFingerprint } from "@archcontext/cloud/attestation";

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

export interface CredentialSecretStore {
  saveSecret(ref: string, value: string): void;
  readSecret(ref: string): string | undefined;
  clear(ref: string): void;
}

export interface DeviceKeyCredentialReference {
  schemaVersion: "archcontext.device-key-credential-ref/v1";
  accountId: string;
  publicKeyId: string;
  publicKeyFingerprint: string;
  keyRef: string;
  createdAt: string;
}

export interface ProvisionDevicePrivateKeyResult {
  reference: DeviceKeyCredentialReference;
  publicKey: KeyObject;
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

export class InMemoryCredentialSecretStore implements CredentialSecretStore {
  private readonly secrets = new Map<string, string>();

  saveSecret(ref: string, value: string): void {
    assertCredentialStoreRef(ref);
    this.secrets.set(ref, value);
  }

  readSecret(ref: string): string | undefined {
    assertCredentialStoreRef(ref);
    return this.secrets.get(ref);
  }

  clear(ref: string): void {
    assertCredentialStoreRef(ref);
    this.secrets.delete(ref);
  }
}

export class DevicePrivateKeyStore {
  constructor(private readonly credentials: CredentialSecretStore = new InMemoryCredentialSecretStore()) {}

  provisionDevicePrivateKey(input: {
    accountId: string;
    publicKeyId: string;
    createdAt?: string;
    keyPair?: { publicKey: KeyObject; privateKey: KeyObject };
  }): ProvisionDevicePrivateKeyResult {
    const accountId = requireCredentialSegment(input.accountId, "accountId");
    const publicKeyId = requireCredentialSegment(input.publicKeyId, "publicKeyId");
    const createdAt = input.createdAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("device-private-key-createdAt-invalid");

    const keyPair = input.keyPair ?? generateKeyPairSync("ed25519");
    if (keyPair.publicKey.type !== "public") throw new Error("device-private-key-public-key-required");
    if (keyPair.privateKey.type !== "private") throw new Error("device-private-key-private-key-required");
    const fingerprint = publicKeyFingerprint(keyPair.publicKey);
    const keyRef = devicePrivateKeyRef({ accountId, publicKeyId });
    const privateKeyPem = keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    this.credentials.saveSecret(keyRef, privateKeyPem);
    return {
      reference: {
        schemaVersion: "archcontext.device-key-credential-ref/v1",
        accountId,
        publicKeyId,
        publicKeyFingerprint: fingerprint,
        keyRef,
        createdAt
      },
      publicKey: keyPair.publicKey
    };
  }

  readPrivateKey(keyRef: string): KeyObject {
    assertDevicePrivateKeyCredentialRef(keyRef);
    const privateKeyPem = this.credentials.readSecret(keyRef);
    if (!privateKeyPem) throw new Error("device-private-key-not-found");
    return createPrivateKey(privateKeyPem);
  }

  signWithDevicePrivateKey(input: { keyRef: string; payload: string | Uint8Array }): string {
    const privateKey = this.readPrivateKey(input.keyRef);
    return sign(null, typeof input.payload === "string" ? Buffer.from(input.payload, "utf8") : input.payload, privateKey).toString("base64");
  }

  removeDevicePrivateKey(keyRef: string): void {
    assertDevicePrivateKeyCredentialRef(keyRef);
    this.credentials.clear(keyRef);
  }
}

export function devicePrivateKeyRef(input: { accountId: string; publicKeyId: string }): string {
  const accountId = requireCredentialSegment(input.accountId, "accountId");
  const publicKeyId = requireCredentialSegment(input.publicKeyId, "publicKeyId");
  return `keychain://archcontext/device/${accountId}/${publicKeyId}`;
}

export function assertCredentialStoreRef(ref: string): void {
  if (!/^keychain:\/\/archcontext\/[A-Za-z0-9._/-]+$/.test(ref)) throw new Error("credential-store-ref-required");
}

export function assertDevicePrivateKeyCredentialRef(ref: string): void {
  assertCredentialStoreRef(ref);
  if (!/^keychain:\/\/archcontext\/device\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(ref)) {
    throw new Error("device-private-key-ref-required");
  }
}

export function assertNoDevicePrivateKeyMaterial(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized) return;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) throw new Error("device-private-key-material-forbidden");
  if (/(^|["'\s])(?:file:\/\/|\/|\.\/|\.\.\/|~\/)[^"'\s]*(?:private|device|key)[^"'\s]*/i.test(serialized)) {
    throw new Error("device-private-key-file-ref-forbidden");
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

function requireCredentialSegment(value: string, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`device-private-key-${field}-invalid`);
  return value;
}
