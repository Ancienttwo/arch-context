import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  assertCredentialStoreRef,
  assertDevicePrivateKeyCredentialRef,
  assertNoDevicePrivateKeyMaterial,
  buildGitHubHeaders,
  createPkceAuthorizationRequest,
  DevicePrivateKeyStore,
  devicePrivateKeyRef,
  describeEntitlementScope,
  InMemoryCredentialSecretStore,
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

  test("stores Device Private Keys behind credential-store refs and signs without exposing PEM", () => {
    const credentials = new InMemoryCredentialSecretStore();
    const store = new DevicePrivateKeyStore(credentials);
    const keyPair = generateKeyPairSync("ed25519");
    const provisioned = store.provisionDevicePrivateKey({
      accountId: "acct_42",
      publicKeyId: "key_device_0001",
      createdAt: "2026-06-20T10:00:00Z",
      keyPair
    });

    expect(provisioned.reference).toEqual({
      schemaVersion: "archcontext.device-key-credential-ref/v1",
      accountId: "acct_42",
      publicKeyId: "key_device_0001",
      publicKeyFingerprint: provisioned.reference.publicKeyFingerprint,
      keyRef: "keychain://archcontext/device/acct_42/key_device_0001",
      createdAt: "2026-06-20T10:00:00Z"
    });
    expect(provisioned.reference.publicKeyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(provisioned.reference)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(provisioned.reference)).not.toContain("BEGIN PUBLIC KEY");
    expect(() => assertNoDevicePrivateKeyMaterial(provisioned.reference)).not.toThrow();

    const payload = "canonical-attestation-payload";
    const signature = store.signWithDevicePrivateKey({ keyRef: provisioned.reference.keyRef, payload });
    expect(verify(null, Buffer.from(payload, "utf8"), provisioned.publicKey, Buffer.from(signature, "base64"))).toBe(true);

    expect(credentials.readSecret(provisioned.reference.keyRef)).toContain("BEGIN PRIVATE KEY");
    store.removeDevicePrivateKey(provisioned.reference.keyRef);
    expect(() => store.readPrivateKey(provisioned.reference.keyRef)).toThrow("device-private-key-not-found");
  });

  test("rejects repository, file, and ordinary config paths for Device Private Key refs", () => {
    expect(devicePrivateKeyRef({ accountId: "acct_42", publicKeyId: "key_device_0001" })).toBe("keychain://archcontext/device/acct_42/key_device_0001");
    expect(() => assertCredentialStoreRef("file:///Users/chris/Projects/arch-context/.archcontext/device.pem")).toThrow("credential-store-ref-required");
    expect(() => assertDevicePrivateKeyCredentialRef("./.archcontext/device-key.pem")).toThrow("credential-store-ref-required");
    expect(() => assertDevicePrivateKeyCredentialRef("config://archcontext/device/key_device_0001")).toThrow("credential-store-ref-required");
    expect(() => assertNoDevicePrivateKeyMaterial({ keyPath: "/Users/chris/Projects/arch-context/.archcontext/device-key.pem" })).toThrow("device-private-key-file-ref-forbidden");
    expect(() => assertNoDevicePrivateKeyMaterial({ keyPem: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----" })).toThrow("device-private-key-material-forbidden");
  });
});
