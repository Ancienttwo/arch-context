import { createHmac, type KeyObject } from "node:crypto";
import {
  verifyLocalAttestation,
  type LocalAttestation,
  type OrgRunnerIdentity,
  type ReviewChallenge
} from "../../../packages/attestation/src/index";
import { digestJson } from "../../../packages/contracts/src/index";

export const CONTROL_PLANE_ROUTES = [
  "GET /oauth/github/start",
  "POST /oauth/github/callback",
  "POST /device/authorize",
  "POST /device/complete",
  "GET /entitlements/:repository",
  "POST /github/webhook",
  "POST /stripe/webhook",
  "POST /attestations/verify",
  "POST /org-runners",
  "POST /org-runners/:runner/revoke",
  "GET /mcp/metadata"
] as const;

export const WORKER_LIMITS = {
  maxBodyBytes: 64 * 1024,
  cpuMs: 30_000,
  requestTimeoutMs: 15_000,
  rateLimitPerMinute: 120
} as const;

export interface Account {
  id: string;
  githubUserId: string;
  plan: "free" | "pro";
  billingInterval: "none" | "monthly" | "annual";
  subscriptionStatus: "active" | "trialing" | "past_due" | "canceled" | "refunded";
}

export const BILLING_PRICES = {
  monthly: { priceUsd: 5, label: "$5/user/month" },
  annual: { priceUsd: 99, label: "$99/user/year" }
} as const;

export class ControlPlane {
  readonly accounts = new Map<string, Account>();
  readonly webhookDeliveries = new Set<string>();
  readonly revokedDevices = new Set<string>();
  readonly orgRunners = new Map<string, OrgRunnerIdentity>();

  loginWithGitHub(githubUserId: string): Account {
    const id = `acct_${githubUserId}`;
    const account = this.accounts.get(id) ?? { id, githubUserId, plan: "free", billingInterval: "none" as const, subscriptionStatus: "active" as const };
    this.accounts.set(id, account);
    return account;
  }

  startDeviceAuthorization(accountId: string) {
    return { deviceCode: `device_${accountId}`, userCode: "ARCH-CTX", verificationUri: "https://api.archcontext.dev/device" };
  }

  completeDeviceAuthorization(deviceCode: string) {
    return { accessToken: `access_${deviceCode}`, refreshTokenRef: `keychain://${deviceCode}`, expiresIn: 900 };
  }

  setSubscription(accountId: string, status: Account["subscriptionStatus"], plan: Account["plan"], billingInterval: Account["billingInterval"] = plan === "pro" ? "monthly" : "none"): Account {
    const account = this.accounts.get(accountId) ?? { id: accountId, githubUserId: accountId, plan: "free", billingInterval: "none" as const, subscriptionStatus: "active" as const };
    const updated = { ...account, status, subscriptionStatus: status, plan, billingInterval: plan === "free" ? "none" : billingInterval };
    this.accounts.set(accountId, updated);
    return updated;
  }

  entitlement(input: { accountId?: string; repositoryVisibility: "public" | "private"; offlineUntil?: string; now?: string }) {
    if (input.repositoryVisibility === "public") {
      return { allowed: true, reason: "public-repository-free", privateRepositoryScope: "public-only" };
    }
    const account = input.accountId ? this.accounts.get(input.accountId) : undefined;
    if (account?.plan === "pro" && ["active", "trialing"].includes(account.subscriptionStatus)) {
      return {
        allowed: true,
        reason: "user-level-pro-private-entitlement",
        billingInterval: account.billingInterval,
        privateRepositoryScope: "user-all-private-repositories"
      };
    }
    if (input.offlineUntil && input.now && input.offlineUntil > input.now) return { allowed: true, reason: "offline-grace-period" };
    return { allowed: false, reason: "pro-required-for-private-repository" };
  }

  signEntitlementToken(payload: object, secret: string): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  verifyEntitlementToken(token: string, secret: string): boolean {
    const [body, sig] = token.split(".");
    if (!body || !sig) return false;
    return createHmac("sha256", secret).update(body).digest("base64url") === sig;
  }

  stripeCheckout(accountId: string, billingInterval: "monthly" | "annual" = "monthly") {
    const price = BILLING_PRICES[billingInterval];
    return {
      url: `https://billing.stripe.example/checkout?client_reference_id=${accountId}&interval=${billingInterval}`,
      priceUsd: price.priceUsd,
      billingInterval,
      label: price.label
    };
  }

  stripePortal(accountId: string) {
    return { url: `https://billing.stripe.example/portal?client_reference_id=${accountId}` };
  }

  switchBillingInterval(accountId: string, billingInterval: "monthly" | "annual") {
    const account = this.accounts.get(accountId);
    if (!account || account.plan !== "pro") throw new Error("pro-subscription-required");
    return {
      accountId,
      billingInterval,
      proration: "stripe-managed",
      portal: this.stripePortal(accountId).url
    };
  }

  mapStripeEvent(event: { id: string; type: string; accountId: string; billingInterval?: "monthly" | "annual" }) {
    this.assertWebhookIdempotent("stripe", event.id);
    if (event.type === "customer.subscription.deleted") return this.setSubscription(event.accountId, "canceled", "free", "none");
    if (event.type === "invoice.payment_failed") return this.setSubscription(event.accountId, "past_due", "pro", event.billingInterval ?? "monthly");
    if (event.type === "charge.refunded") return this.setSubscription(event.accountId, "refunded", "free", "none");
    return this.setSubscription(event.accountId, "active", "pro", event.billingInterval ?? "monthly");
  }

  registerOrgRunner(identity: OrgRunnerIdentity): OrgRunnerIdentity {
    if (identity.installationId < 1) throw new Error("installation-required");
    this.orgRunners.set(identity.runnerId, identity);
    return identity;
  }

  revokeOrgRunner(runnerId: string, revokedAt: string): OrgRunnerIdentity {
    const current = this.orgRunners.get(runnerId);
    if (!current) throw new Error("runner-not-found");
    const revoked = { ...current, status: "revoked" as const, revokedAt };
    this.orgRunners.set(runnerId, revoked);
    return revoked;
  }

  verifyOrgRunnerAttestation(input: {
    challenge: ReviewChallenge;
    attestation: LocalAttestation;
    publicKey: KeyObject;
    now: string;
    expectedInstallationId: number;
    expectedHeadSha: string;
  }) {
    const runner = this.orgRunners.get(input.attestation.device.deviceId);
    return verifyLocalAttestation({
      challenge: input.challenge,
      attestation: input.attestation,
      publicKey: input.publicKey,
      now: input.now,
      expectedRepository: input.challenge.repository,
      expectedHeadSha: input.expectedHeadSha,
      expectedTrustLevel: "organization",
      orgRunner: runner,
      expectedInstallationId: input.expectedInstallationId
    });
  }

  assertWebhookIdempotent(provider: string, deliveryId: string): void {
    const key = `${provider}:${deliveryId}`;
    if (this.webhookDeliveries.has(key)) throw new Error("duplicate-webhook-delivery");
    this.webhookDeliveries.add(key);
  }

  revokeDevice(deviceId: string): void {
    this.revokedDevices.add(deviceId);
  }

  buildQueueMessage(input: { kind: string; id: string; accountId?: string }) {
    return input;
  }

  redactLog(value: string): string {
    return value.replace(/(access|refresh|secret|token)_[a-zA-Z0-9_-]+/g, "[REDACTED]");
  }

  retentionCutoff(now: string, days = 90): string {
    return new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
  }

  costAlert(input: { monthlyRevenueUsd: number; projectedCostUsd: number }) {
    return { alert: input.projectedCostUsd > input.monthlyRevenueUsd * 0.1 };
  }

  exportAccount(accountId: string) {
    return {
      account: this.accounts.get(accountId),
      revokedDevices: [...this.revokedDevices],
      orgRunners: [...this.orgRunners.values()].filter((runner) => runner.runnerId.includes(accountId)),
      deliveries: [...this.webhookDeliveries].filter((delivery) => delivery.includes(accountId) || !delivery.includes(":"))
    };
  }

  deleteAccount(accountId: string): void {
    this.accounts.delete(accountId);
    for (const device of [...this.revokedDevices]) {
      if (device.includes(accountId)) this.revokedDevices.delete(device);
    }
  }
}

export function routeDigest(): string {
  return digestJson([...CONTROL_PLANE_ROUTES]);
}

export function assertNoUploadRoutes(routes: readonly string[] = CONTROL_PLANE_ROUTES): void {
  const forbidden = /(upload|index|detail|embedding|blob|proxy)/i;
  for (const route of routes) {
    if (forbidden.test(route)) throw new Error(`Forbidden route: ${route}`);
  }
}
