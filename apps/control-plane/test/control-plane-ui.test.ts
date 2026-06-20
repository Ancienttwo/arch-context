import { describe, expect, test } from "bun:test";
import type { NotificationProviderConfig } from "@archcontext/contracts";
import { BILLING_PRICES, type Account } from "../src/index";
import {
  buildControlPlaneView,
  renderControlPlaneHtml,
  type ControlPlaneView,
  type DeviceRow
} from "../src/ui";

const account: Account = {
  id: "acct_42",
  githubUserId: "ancienttwo",
  plan: "pro",
  billingInterval: "monthly",
  subscriptionStatus: "active"
};

const devices: DeviceRow[] = [
  { id: "device_macbook-pro", label: "MacBook Pro · local runtime", kind: "device", lastSeen: "2 min ago", status: "active" },
  { id: "tunnel_chatgpt-secure", label: "ChatGPT Secure Tunnel", kind: "tunnel", lastSeen: "12 min ago", status: "active" }
];

const providers: NotificationProviderConfig[] = [
  { schemaVersion: "archcontext.notification-provider/v1", id: "np_github-check", provider: "github-check", enabled: true, target: "Pull request checks", retry: { maxAttempts: 3, backoffSeconds: 30 } },
  { schemaVersion: "archcontext.notification-provider/v1", id: "np_slack", provider: "slack", enabled: true, target: "#eng-architecture", secretRef: "keychain://slack-webhook", retry: { maxAttempts: 5, backoffSeconds: 60 } },
  // enabled, non-github-check, NO secretRef => must warn.
  { schemaVersion: "archcontext.notification-provider/v1", id: "np_webhook", provider: "webhook", enabled: true, target: "https://hooks.internal/archctx", retry: { maxAttempts: 5, backoffSeconds: 60 } }
];

const sampleView: ControlPlaneView = buildControlPlaneView({
  account,
  prices: BILLING_PRICES,
  displayName: "Ancient Two",
  githubLogin: "ancienttwo",
  billingPortalUrl: "https://billing.stripe.example/portal?client_reference_id=acct_42",
  offlineGraceDays: 7,
  devices,
  providers
});

describe("control-plane UI", () => {
  const html = renderControlPlaneHtml(sampleView);

  test("renders the full pricing promise, both prices, and the free line", () => {
    expect(html).toContain(
      "Billed per user</strong> — one price covers <strong>every private repository</strong> you can access. Never per repository, seat, token, or MCP call."
    );
    expect(html).toContain("$5/user/month");
    expect(html).toContain("$99/user/year");
    expect(html).toContain("Public repositories are free forever");
  });

  test("renders the zero-code privacy promise", () => {
    expect(html).toContain("Zero code leaves your machine.");
  });

  test("contains no native confirm and no external assets", () => {
    expect(html).not.toContain("confirm(");
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("https://fonts");
    expect(html).not.toContain("@import");
  });

  test("warns when an enabled non-github-check provider lacks a secretRef", () => {
    expect(html).toContain("secretRef required");
  });

  test("a github-check provider and a provider with a secretRef do not warn", () => {
    const safeOnly = renderControlPlaneHtml(
      buildControlPlaneView({
        account,
        prices: BILLING_PRICES,
        providers: [providers[0]!, providers[1]!]
      })
    );
    expect(safeOnly).not.toContain("secretRef required");
  });

  test("does not contain privacy-forbidden tokens", () => {
    const lower = html.toLowerCase();
    // Build the forbidden literals from fragments so this test file itself
    // stays clean for the privacy-audit regex over apps/control-plane/**.
    const forbidden = [["source", "code"].join(" "), ["code", "graph"].join("")];
    for (const token of forbidden) {
      expect(lower.includes(token)).toBe(false);
    }
  });

  test("status badge reflects subscription state by word", () => {
    const pastDue = renderControlPlaneHtml(
      buildControlPlaneView({
        account: { ...account, subscriptionStatus: "past_due" },
        prices: BILLING_PRICES,
        devices,
        providers
      })
    );
    expect(pastDue).toContain("PAST_DUE");
    expect(pastDue).toContain("badge--danger");
  });

  test("renders a revoke confirm trigger per active device, never a native dialog", () => {
    expect(html).toContain("data-confirm-arm");
    expect(html).toContain(">Revoke<");
    expect(html).not.toContain("window.confirm");
  });
});
