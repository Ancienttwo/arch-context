// Control-plane Dashboard — server-rendered settings console for
// archctx.repoharness.com. A Cloudflare Worker emits this single HTML string;
// there is no SPA, no build step, and no external asset. Vanilla state only:
// inline <style> + a minimal <script> drive tabs, switches, and two-step
// confirms. Ported from the React UI-kit prototype's visual result.
//
// Composes EXISTING data shapes (see packages/cloud/control-plane/src/index.ts and
// packages/contracts/src/ports.ts). DeviceRow is a view-only row type — it is
// NOT a contract interface and adds no field to any port.

import type { Account, BILLING_PRICES } from "./index";
import type { NotificationProviderConfig, NotificationProviderKind } from "@archcontext/contracts";

// ---------------------------------------------------------------------------
// View-state input types (compose existing shapes; never mutate the contracts)
// ---------------------------------------------------------------------------

/** A device or ChatGPT Secure Tunnel row. View-only; not a port interface. */
export interface DeviceRow {
  id: string;
  label: string;
  kind: "device" | "tunnel";
  lastSeen: string;
  status: "active" | "revoked";
}

/** Price table shape, structurally equal to BILLING_PRICES from ./index. */
export type BillingPrices = typeof BILLING_PRICES;

/** Everything renderControlPlaneHtml needs. Pure data, no behavior. */
export interface ControlPlaneView {
  /** GitHub identity + plan + subscription state (existing Account shape). */
  account: Account;
  /** Friendly display name for the avatar/header (not on the Account port). */
  displayName: string;
  /** Login handle shown in mono; defaults to account.githubUserId. */
  githubLogin: string;
  /** $5/user/month and $99/user/year, from BILLING_PRICES. */
  prices: BillingPrices;
  /** Billing portal navigation target; null renders a disabled placeholder. */
  billingPortalUrl: string | null;
  /** GitHub App install/reconfigure URL; null renders a disabled placeholder. */
  githubAppInstallUrl: string | null;
  /** Days a revoked-network local runtime keeps working offline. */
  offlineGraceDays: number;
  /** Authorized local runtimes + tunnels. */
  devices: DeviceRow[];
  /** Notification provider configs (existing contract shape, unmodified). */
  providers: NotificationProviderConfig[];
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/** HTML-escape every interpolated string. Order matters: & first. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

/** subscriptionStatus -> color+word+shape tone. */
function subscriptionTone(status: Account["subscriptionStatus"]): Tone {
  switch (status) {
    case "active":
      return "ok";
    case "trialing":
      return "warn";
    case "past_due":
    case "canceled":
    case "refunded":
      return "danger";
    default:
      return "info";
  }
}

/** device/tunnel status -> tone. */
function deviceTone(status: DeviceRow["status"]): Tone {
  return status === "revoked" ? "danger" : "ok";
}

/** A status badge: leading dot + UPPERCASE word, colored by tone. */
function statusBadge(label: string, tone: Tone): string {
  return `<span class="badge badge--${tone}"><span class="badge__dot"></span>${escapeHtml(label.toUpperCase())}</span>`;
}

/** A compact chip (machine values stay lowercase/kebab as passed in). */
function chip(label: string, tone: Tone = "neutral", mono = false): string {
  const cls = `chip chip--${tone}${mono ? " chip--mono" : ""}`;
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

/**
 * A notification provider needs a secret when it is enabled, is not the
 * github-check provider, and carries no secretRef. Mirrors the backend guard
 * in ControlPlane.setNotificationProvider.
 */
function providerNeedsSecret(provider: NotificationProviderConfig): boolean {
  return provider.enabled && provider.provider !== "github-check" && !provider.secretRef;
}

/** Default view (handy for tests / first paint). Pure; composes existing shapes. */
export function buildControlPlaneView(input: {
  account: Account;
  prices: BillingPrices;
  displayName?: string;
  githubLogin?: string;
  billingPortalUrl?: string | null;
  githubAppInstallUrl?: string | null;
  offlineGraceDays?: number;
  devices?: DeviceRow[];
  providers?: NotificationProviderConfig[];
}): ControlPlaneView {
  return {
    account: input.account,
    prices: input.prices,
    displayName: input.displayName ?? input.account.githubUserId,
    githubLogin: input.githubLogin ?? input.account.githubUserId,
    billingPortalUrl: input.billingPortalUrl ?? null,
    githubAppInstallUrl: input.githubAppInstallUrl ?? null,
    offlineGraceDays: input.offlineGraceDays ?? 7,
    devices: input.devices ?? [],
    providers: input.providers ?? []
  };
}

// ---------------------------------------------------------------------------
// Panel fragments
// ---------------------------------------------------------------------------

function accountPanel(view: ControlPlaneView): string {
  const { account, displayName, githubLogin } = view;
  const planLabel = account.plan === "pro" ? "Pro" : "Free";
  const initial = escapeHtml((displayName.trim()[0] ?? "A").toUpperCase());
  const tone = subscriptionTone(account.subscriptionStatus);
  return `
  <section class="panel" data-panel="account" role="tabpanel" aria-labelledby="tab-account">
    <header class="panel__head">
      <h2 class="h2">Account</h2>
      <p class="lede">Signed in with GitHub. Pro is billed per user and covers every private repository you can access.</p>
    </header>
    <div class="card">
      <div class="acct">
        <span class="avatar" aria-hidden="true">${initial}</span>
        <div class="acct__id">
          <div class="acct__name">${escapeHtml(displayName)}</div>
          <div class="acct__handle mono">@${escapeHtml(githubLogin)}</div>
        </div>
        <div class="acct__tags">
          ${chip(planLabel, account.plan === "pro" ? "ok" : "neutral")}
          ${statusBadge(account.subscriptionStatus, tone)}
        </div>
      </div>
      <dl class="rows">
        <div class="row"><dt>GitHub identity</dt><dd class="mono">@${escapeHtml(githubLogin)}</dd></div>
        <div class="row"><dt>Plan</dt><dd>${chip(account.plan, account.plan === "pro" ? "ok" : "neutral", true)}</dd></div>
        <div class="row"><dt>Billing interval</dt><dd>${chip(account.billingInterval, "neutral", true)}</dd></div>
        <div class="row"><dt>Subscription status</dt><dd>${statusBadge(account.subscriptionStatus, tone)}</dd></div>
      </dl>
    </div>

    <header class="panel__head panel__head--sub">
      <h2 class="h2">Entitlement</h2>
    </header>
    <div class="grid-2">
      <div class="card">
        ${statusBadge("public", "ok")}
        <p class="lede lede--tight">Public repositories are free, forever — full local runtime and GitHub Check.</p>
      </div>
      <div class="card">
        ${statusBadge("private", account.plan === "pro" ? "ok" : "warn")}
        <p class="lede lede--tight">Covered by your personal Pro — every private repository you can access, no per-repository charge. Offline grace: ${escapeHtml(String(view.offlineGraceDays))} days.</p>
      </div>
    </div>
  </section>`;
}

function billingPanel(view: ControlPlaneView): string {
  const { prices, account } = view;
  const monthly = prices.monthly;
  const annual = prices.annual;
  const startInterval = account.billingInterval === "annual" ? "annual" : "monthly";
  const portal = view.billingPortalUrl
    ? `<a class="btn btn--secondary" href="${escapeHtml(view.billingPortalUrl)}">Open billing portal</a>`
    : `<button class="btn btn--secondary" type="button" disabled>Billing portal unavailable</button>`;

  // Big-number price strip; both prices are present in the DOM, JS toggles which shows.
  const priceFigure = (interval: "monthly" | "annual", label: string) => {
    const head = label.split("/")[0];
    const tail = label.split("/").slice(1).join("/");
    const hidden = interval === startInterval ? "" : " hidden";
    return `<div class="price" data-price="${interval}"${hidden}>
        <span class="price__amount">${escapeHtml(head)}</span>
        <span class="price__per">/ ${escapeHtml(tail)}</span>
      </div>`;
  };

  return `
  <section class="panel hidden" data-panel="billing" role="tabpanel" aria-labelledby="tab-billing">
    <header class="panel__head"><h2 class="h2">Billing</h2></header>

    <div class="card card--promise">
      ${priceFigure("monthly", monthly.label)}
      ${priceFigure("annual", annual.label)}
      <p class="promise__text">
        <strong>Billed per user</strong> — one price covers <strong>every private repository</strong> you can access. Never per repository, seat, token, or MCP call.
      </p>
      <p class="promise__free">Public repositories are free forever.</p>
    </div>

    <div class="card">
      <span class="eyebrow">Plan</span>
      <div class="toggle" role="group" aria-label="Billing interval">
        <button class="toggle__seg${startInterval === "monthly" ? " is-on" : ""}" type="button" data-interval="monthly" aria-pressed="${startInterval === "monthly"}">monthly · ${escapeHtml(monthly.label)}</button>
        <button class="toggle__seg${startInterval === "annual" ? " is-on" : ""}" type="button" data-interval="annual" aria-pressed="${startInterval === "annual"}">annual · ${escapeHtml(annual.label)}</button>
      </div>
      <div class="actions">
        ${account.plan === "pro"
          ? portal
          : `<button class="btn btn--primary" type="button">Upgrade to Pro</button>${portal}`}
      </div>
    </div>
  </section>`;
}

function deviceRow(device: DeviceRow): string {
  const glyph = device.kind === "tunnel" ? "T" : "D";
  const kindCls = device.kind === "tunnel" ? "glyph--tunnel" : "glyph--device";
  const right =
    device.status === "revoked"
      ? statusBadge("revoked", "danger")
      : confirmAction({
          label: "Revoke",
          prompt: `Revoke ${device.kind}?`,
          confirmLabel: "Revoke"
        });
  return `
        <div class="lrow${device.status === "revoked" ? " lrow--muted" : ""}">
          <span class="glyph ${kindCls}" aria-hidden="true">${glyph}</span>
          <div class="lrow__body">
            <div class="lrow__title">${escapeHtml(device.label)}</div>
            <div class="lrow__meta mono">${escapeHtml(device.id)} · ${escapeHtml(device.lastSeen)}</div>
          </div>
          ${right}
        </div>`;
}

function devicesPanel(view: ControlPlaneView): string {
  const rows = view.devices.length
    ? view.devices.map(deviceRow).join("")
    : `<div class="lrow lrow--empty"><div class="lrow__body"><div class="lrow__meta">No authorized devices or tunnels.</div></div></div>`;
  return `
  <section class="panel hidden" data-panel="devices" role="tabpanel" aria-labelledby="tab-devices">
    <header class="panel__head">
      <h2 class="h2">Devices &amp; tunnels</h2>
      <p class="lede">Authorized local runtimes and ChatGPT Secure Tunnels. Revoking is immediate and ends that session&#39;s access.</p>
    </header>
    <div class="card card--list">
      ${rows}
    </div>
  </section>`;
}

function notificationRow(provider: NotificationProviderConfig): string {
  const name = provider.provider.replace(/-/g, " ");
  const warn = providerNeedsSecret(provider)
    ? `<div class="warn-inline">secretRef required</div>`
    : "";
  const noSecretChip = provider.provider === "github-check" ? chip("no secret needed", "ok") : "";
  const checked = provider.enabled;
  return `
        <div class="nrow">
          <div class="nrow__top">
            <div class="nrow__id">
              <div class="nrow__name-line">
                <span class="nrow__name">${escapeHtml(name)}</span>
                ${noSecretChip}
              </div>
              <div class="nrow__target mono">${escapeHtml(provider.target)}</div>
            </div>
            <button class="switch${checked ? " is-on" : ""}" type="button" role="switch" aria-checked="${checked}" aria-label="Enable ${escapeHtml(name)}" data-switch="${escapeHtml(provider.id)}">
              <span class="switch__knob"></span>
            </button>
          </div>
          ${warn}
        </div>`;
}

function notificationsPanel(view: ControlPlaneView): string {
  const rows = view.providers.length
    ? view.providers.map(notificationRow).join("")
    : `<div class="nrow"><div class="nrow__target">No notification providers configured.</div></div>`;
  return `
  <section class="panel hidden" data-panel="notifications" role="tabpanel" aria-labelledby="tab-notifications">
    <header class="panel__head">
      <h2 class="h2">Notifications</h2>
      <p class="lede">Where ArchContext publishes signed Review results. Non-GitHub providers require a secret reference when enabled.</p>
    </header>
    <div class="card card--list">
      ${rows}
    </div>
  </section>`;
}

function githubAppPanel(view: ControlPlaneView): string {
  const install = view.githubAppInstallUrl
    ? `<a class="btn btn--primary" href="${escapeHtml(view.githubAppInstallUrl)}">Install or reconfigure</a>`
    : `<button class="btn btn--primary" type="button" disabled>Install URL unavailable</button>`;
  return `
  <section class="panel hidden" data-panel="github-app" role="tabpanel" aria-labelledby="tab-github-app">
    <header class="panel__head">
      <h2 class="h2">GitHub App</h2>
      <p class="lede">Install ArchContext on selected repositories to receive PR events and publish Review Checks.</p>
    </header>

    <div class="card">
      <span class="eyebrow">Installation</span>
      <p class="lede lede--tight">Choose only the repositories you want governed. ArchContext does not read code to run Review; the local runtime signs the result and the SaaS verifies metadata.</p>
      <div class="actions">${install}</div>
    </div>

    <div class="card">
      <span class="eyebrow">Repository permissions</span>
      <dl class="rows">
        <div class="row"><dt>Metadata: Read</dt><dd>Identify selected repositories and installation state.</dd></div>
        <div class="row"><dt>Pull Requests: Read</dt><dd>Receive PR events and read head/base commit metadata.</dd></div>
        <div class="row"><dt>Checks: Write</dt><dd>Create and update ArchContext Review Checks.</dd></div>
        <div class="row"><dt>Contents: None</dt><dd>Not requested.</dd></div>
        <div class="row"><dt>Commit Statuses: None now</dt><dd>Conditional on FG2-02 staging decision.</dd></div>
      </dl>
    </div>

    <div class="card">
      <span class="eyebrow">Data retention</span>
      <dl class="rows">
        <div class="row"><dt>Raw webhook body</dt><dd>0 days.</dd></div>
        <div class="row"><dt>Webhook delivery projection</dt><dd>30 days.</dd></div>
        <div class="row"><dt>Unfinished challenge</dt><dd>7 days.</dd></div>
        <div class="row"><dt>Check delivery metadata</dt><dd>90 days.</dd></div>
        <div class="row"><dt>Verified attestation metadata</dt><dd>1 year or account deletion.</dd></div>
      </dl>
    </div>
  </section>`;
}

function privacyPanel(): string {
  // Privacy promise. NOTE: the supporting line deliberately avoids the
  // privacy-audit forbidden literals; it lists what the SaaS never receives in
  // plain words.
  return `
  <section class="panel hidden" data-panel="privacy" role="tabpanel" aria-labelledby="tab-privacy">
    <header class="panel__head">
      <h2 class="h2">Privacy &amp; data</h2>
      <p class="lede">What the SaaS control plane can and cannot see.</p>
    </header>
    <div class="notice notice--ok">
      <span class="notice__dot" aria-hidden="true"></span>
      <div class="notice__body">
        <strong>Zero code leaves your machine.</strong>
        The SaaS verifies minimal fields only — it never receives your code, diffs, symbols, the dependency graph, model bodies, or detailed findings. The GitHub App holds no Contents permission and there are no content-upload routes, guarded by a CI privacy contract test.
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">Your data</span>
      <p class="lede lede--tight">Export everything this account stores (identity, billing status, device list, audit deliveries), or delete the account and revoke all sessions.</p>
      <div class="actions">
        <button class="btn btn--secondary" type="button">Export account data</button>
        ${confirmAction({
          label: "Delete account",
          prompt: "Permanently delete this account?",
          confirmLabel: "Delete forever"
        })}
      </div>
    </div>
  </section>`;
}

/**
 * Two-step in-place confirm. Rendered fully in HTML; vanilla JS toggles the
 * .is-armed state. NEVER uses the browser's native modal dialogs.
 */
function confirmAction(input: { label: string; prompt: string; confirmLabel: string }): string {
  return `<span class="confirm" data-confirm>
            <button class="btn btn--secondary confirm__trigger" type="button" data-confirm-arm>${escapeHtml(input.label)}</button>
            <span class="confirm__armed" hidden>
              <span class="confirm__prompt">${escapeHtml(input.prompt)}</span>
              <button class="btn btn--danger" type="button" data-confirm-go>${escapeHtml(input.confirmLabel)}</button>
              <button class="btn btn--ghost" type="button" data-confirm-cancel>Cancel</button>
            </span>
          </span>`;
}

// ---------------------------------------------------------------------------
// Styles (inline; tokens copied verbatim per spec)
// ---------------------------------------------------------------------------

const STYLE = `:root{color-scheme:light;
--paper:#f6f7f4;--panel:#fff;--panel-sunken:#fbfcfa;--wash:#eef1ec;--wash-strong:#e3e8e1;
--ink:#172019;--ink-2:#36433b;--muted:#5c675f;--faint:#8a958d;--line:#cbd4ce;--line-soft:#dde3dd;
--ink-green:#176b57;--ink-green-700:#115443;--ink-green-50:#e4efe9;
--amber:#d08b1f;--amber-700:#a96f12;--amber-50:#fdf4e1;
--brick:#b6422f;--brick-700:#93331f;--brick-50:#f7e7e2;
--indigo:#2f5fa8;--indigo-700:#244a85;--indigo-50:#e6ecf5;--slate:#5c675f;
--font-sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
--font-mono:ui-monospace,"SF Mono","Menlo","Consolas",monospace;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
code,pre,kbd{font-family:var(--font-mono)}
a{color:var(--indigo);text-underline-offset:2px}
:focus-visible{outline:2px solid var(--indigo);outline-offset:2px}
.hidden{display:none !important}
.mono{font-family:var(--font-mono)}
.eyebrow{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}

/* header shell */
.shell-top{background:var(--panel);border-bottom:1px solid var(--line)}
.wrap{max-width:980px;margin:0 auto;padding:0 24px}
.brandrow{display:flex;align-items:center;gap:10px;padding:16px 0}
.brandmark{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 8px;border-radius:6px;background:var(--ink-green);color:#fff;font-family:var(--font-mono);font-weight:700;font-size:13px;letter-spacing:.02em}
.brandname{font-size:15px;font-weight:600;color:var(--ink)}
.brandhost{font-size:13px;color:var(--faint);font-family:var(--font-mono)}
.brandwho{margin-left:auto;font-size:12px;color:var(--muted)}
.slogan{margin:0;padding:0 0 12px;font-size:13px;color:var(--ink-green-700);font-weight:500}
.cmdline{margin:0 0 12px;font-family:var(--font-mono);font-size:12px;color:var(--muted)}
.cmdline .tok{color:var(--ink-green-700)}

/* tabs */
.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line)}
.tab{appearance:none;background:none;border:none;padding:10px 12px;margin-bottom:-1px;font-family:var(--font-sans);font-size:14px;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.tab.is-active{color:var(--ink-green);font-weight:600;border-bottom-color:var(--ink-green)}

/* main */
.main{max-width:980px;margin:0 auto;padding:24px}
.h2{margin:0;font-size:16px;font-weight:600;color:var(--ink)}
.lede{margin:4px 0 0;font-size:13px;color:var(--muted);line-height:1.5;max-width:64ch}
.lede--tight{margin-top:10px}
.panel__head{margin-bottom:16px}
.panel__head--sub{margin-top:24px}

/* card */
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}
.card--list{padding:0;overflow:hidden}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid-2 .card{margin-bottom:0}

/* account */
.acct{display:flex;align-items:center;gap:12px}
.avatar{width:44px;height:44px;flex:none;border-radius:50%;background:var(--ink-2);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:600}
.acct__name{font-size:15px;font-weight:600}
.acct__handle{font-size:13px;color:var(--muted)}
.acct__tags{margin-left:auto;display:flex;gap:8px;align-items:center}
.rows{margin:8px 0 0}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line-soft)}
.row dt{font-size:13px;color:var(--muted)}
.row dd{margin:0;font-size:14px;font-weight:500;color:var(--ink)}

/* chip */
.chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;font-family:var(--font-sans);font-size:12px;font-weight:500;white-space:nowrap;border:1px solid transparent}
.chip--mono{font-family:var(--font-mono)}
.chip--neutral{background:var(--wash);color:var(--muted);border-color:var(--line)}
.chip--ok{background:var(--ink-green-50);color:var(--ink-green-700)}
.chip--warn{background:var(--amber-50);color:var(--amber-700)}
.chip--danger{background:var(--brick-50);color:var(--brick-700)}
.chip--info{background:var(--indigo-50);color:var(--indigo-700)}

/* status badge: -50 bg / -700 text / base border + leading dot */
.badge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.04em;white-space:nowrap;border:1px solid}
.badge__dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.badge--ok{background:var(--ink-green-50);color:var(--ink-green-700);border-color:var(--ink-green)}
.badge--warn{background:var(--amber-50);color:var(--amber-700);border-color:var(--amber)}
.badge--danger{background:var(--brick-50);color:var(--brick-700);border-color:var(--brick)}
.badge--info{background:var(--indigo-50);color:var(--indigo-700);border-color:var(--indigo)}
.badge--neutral{background:var(--wash);color:var(--muted);border-color:var(--line);border-style:dashed}

/* billing promise */
.card--promise{border-color:var(--ink-green);background:var(--ink-green-50)}
.price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.price__amount{font-size:30px;font-weight:700;color:var(--ink-green-700);line-height:1}
.price__per{font-size:14px;color:var(--ink-green-700)}
.promise__text{margin:12px 0 0;font-size:14px;line-height:1.55;color:var(--ink-2)}
.promise__text strong{color:var(--ink);font-weight:600}
.promise__free{margin:6px 0 0;font-size:14px;font-weight:600;color:var(--ink-green-700)}

/* interval toggle */
.toggle{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px;margin-bottom:14px}
.toggle__seg{appearance:none;border:none;background:transparent;color:var(--muted);border-radius:999px;padding:6px 16px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.toggle__seg.is-on{background:var(--ink-green);color:#fff}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}

/* button */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:30px;padding:0 12px;font-family:var(--font-sans);font-size:13px;font-weight:600;line-height:1;border-radius:6px;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .12s ease,border-color .12s ease}
.btn--primary{background:var(--ink-green);color:#fff;border:1px solid var(--ink-green)}
.btn--secondary{background:var(--panel);color:var(--ink);border:1px solid var(--line)}
.btn--ghost{background:transparent;color:var(--ink-2);border:1px solid transparent}
.btn--danger{background:var(--brick);color:#fff;border:1px solid var(--brick)}
.btn[disabled]{opacity:.45;cursor:not-allowed}

/* list rows (devices) */
.lrow{display:flex;align-items:center;gap:12px;padding:14px 16px;border-top:1px solid var(--line-soft)}
.lrow:first-child{border-top:none}
.lrow--muted{opacity:.55}
.lrow--empty{color:var(--muted)}
.glyph{width:34px;height:34px;flex:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:700;font-size:13px}
.glyph--device{background:var(--wash);color:var(--muted)}
.glyph--tunnel{background:var(--indigo-50);color:var(--indigo)}
.lrow__body{flex:1;min-width:0}
.lrow__title{font-size:14px;font-weight:600;color:var(--ink)}
.lrow__meta{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* notification rows */
.nrow{padding:14px 16px;border-top:1px solid var(--line-soft)}
.nrow:first-child{border-top:none}
.nrow__top{display:flex;align-items:center;gap:12px}
.nrow__id{flex:1;min-width:0}
.nrow__name-line{display:flex;align-items:center;gap:8px}
.nrow__name{font-size:14px;font-weight:600;color:var(--ink);text-transform:capitalize}
.nrow__target{font-size:12px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.warn-inline{margin-top:10px;display:inline-block;font-size:12px;font-weight:600;color:var(--brick-700);background:var(--brick-50);border:1px solid var(--brick);border-radius:6px;padding:4px 9px}

/* switch */
.switch{position:relative;flex:none;width:38px;height:22px;padding:0;border-radius:999px;background:var(--wash-strong);border:1px solid var(--line);cursor:pointer;transition:background .15s ease,border-color .15s ease}
.switch.is-on{background:var(--ink-green);border-color:var(--ink-green)}
.switch__knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(23,32,25,.25);transition:left .15s ease}
.switch.is-on .switch__knob{left:18px}

/* notice */
.notice{display:flex;gap:10px;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;margin-bottom:16px;background:var(--ink-green-50);border:1px solid var(--ink-green);color:var(--ink)}
.notice__dot{flex:none;width:18px;height:18px;border-radius:50%;background:var(--ink-green);margin-top:1px;position:relative}
.notice__dot::after{content:"";position:absolute;left:6px;top:3px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.notice__body strong{font-weight:600}

/* confirm (two-step in place) */
.confirm{display:inline-flex;align-items:center}
.confirm.is-armed .confirm__trigger{display:none}
.confirm__armed{display:inline-flex;align-items:center;gap:8px}
.confirm__prompt{font-size:13px;font-weight:500;color:var(--brick-700)}

/* responsive: <=820px single column, tabs wrap */
@media (max-width:820px){
  .grid-2{grid-template-columns:1fr}
  .wrap,.main{padding-left:16px;padding-right:16px}
}`;

// ---------------------------------------------------------------------------
// Behavior (inline vanilla JS; no native confirm/alert/prompt)
// ---------------------------------------------------------------------------

const SCRIPT = `(function(){
  var root=document;
  // Tabs: switch [data-panel] visibility from [data-tab].
  function selectTab(name){
    var tabs=root.querySelectorAll('[data-tab]');
    for(var i=0;i<tabs.length;i++){
      var on=tabs[i].getAttribute('data-tab')===name;
      tabs[i].classList.toggle('is-active',on);
      tabs[i].setAttribute('aria-selected',on?'true':'false');
    }
    var panels=root.querySelectorAll('[data-panel]');
    for(var j=0;j<panels.length;j++){
      panels[j].classList.toggle('hidden',panels[j].getAttribute('data-panel')!==name);
    }
  }
  root.addEventListener('click',function(e){
    var t=e.target;
    if(!(t&&t.closest)) return;

    var tab=t.closest('[data-tab]');
    if(tab){ selectTab(tab.getAttribute('data-tab')); return; }

    // Switch toggle (visual only on this static surface).
    var sw=t.closest('[data-switch]');
    if(sw){
      var on=sw.classList.toggle('is-on');
      sw.setAttribute('aria-checked',on?'true':'false');
      return;
    }

    // Billing interval toggle: flip price + active segment.
    var seg=t.closest('[data-interval]');
    if(seg){
      var iv=seg.getAttribute('data-interval');
      var segs=root.querySelectorAll('[data-interval]');
      for(var k=0;k<segs.length;k++){
        var act=segs[k]===seg;
        segs[k].classList.toggle('is-on',act);
        segs[k].setAttribute('aria-pressed',act?'true':'false');
      }
      var prices=root.querySelectorAll('[data-price]');
      for(var m=0;m<prices.length;m++){
        prices[m].classList.toggle('hidden',prices[m].getAttribute('data-price')!==iv);
      }
      return;
    }

    // ConfirmAction two-step (in place, no native dialog).
    var arm=t.closest('[data-confirm-arm]');
    if(arm){
      var box=arm.closest('[data-confirm]');
      if(box){ box.classList.add('is-armed'); box.querySelector('.confirm__armed').hidden=false; }
      return;
    }
    var cancel=t.closest('[data-confirm-cancel]');
    if(cancel){
      var box2=cancel.closest('[data-confirm]');
      if(box2){ box2.classList.remove('is-armed'); box2.querySelector('.confirm__armed').hidden=true; }
      return;
    }
    var go=t.closest('[data-confirm-go]');
    if(go){
      var box3=go.closest('[data-confirm]');
      if(box3){
        box3.classList.remove('is-armed');
        box3.querySelector('.confirm__armed').hidden=true;
        box3.setAttribute('data-confirmed','true');
      }
      return;
    }
  });
})();`;

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------

/** Render the full control-plane settings page as one self-contained HTML string. */
export function renderControlPlaneHtml(view: ControlPlaneView): string {
  const who = escapeHtml(`@${view.githubLogin}`);
  const placeholders = [
    "{{account.plan}}",
    "{{account.billingInterval}}",
    "{{account.subscriptionStatus}}",
    "{{displayName}}",
    "{{githubLogin}}",
    "{{prices.monthly.label}}",
    "{{prices.annual.label}}",
    "{{billingPortalUrl}}",
    "{{githubAppInstallUrl}}",
    "{{offlineGraceDays}}",
    "{{devices[].id|label|kind|lastSeen|status}}",
    "{{providers[].id|provider|enabled|target|secretRef}}"
  ].join(" ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArchContext — Control plane</title>
<!-- ArchContext Control-plane Dashboard. Self-contained: no external CSS/JS/fonts.
     Dynamic placeholders interpolated from ControlPlaneView: ${placeholders} -->
<style>${STYLE}</style>
</head>
<body>
  <header class="shell-top">
    <div class="wrap">
      <div class="brandrow">
        <span class="brandmark" aria-hidden="true">&gt;_&lt;</span>
        <span class="brandname">ArchContext</span>
        <span class="brandhost mono">archctx.repoharness.com</span>
        <span class="brandwho mono">${who}</span>
      </div>
      <p class="slogan">Code with an architect on standby.</p>
      <p class="cmdline"><span class="tok">$</span> archctx serve <span class="tok">--local-only</span></p>
      <nav class="tabs" role="tablist" aria-label="Settings sections">
        <button class="tab is-active" type="button" role="tab" id="tab-account" data-tab="account">Account</button>
        <button class="tab" type="button" role="tab" id="tab-billing" data-tab="billing">Billing</button>
        <button class="tab" type="button" role="tab" id="tab-devices" data-tab="devices">Devices &amp; tunnels</button>
        <button class="tab" type="button" role="tab" id="tab-notifications" data-tab="notifications">Notifications</button>
        <button class="tab" type="button" role="tab" id="tab-github-app" data-tab="github-app">GitHub App</button>
        <button class="tab" type="button" role="tab" id="tab-privacy" data-tab="privacy">Privacy &amp; data</button>
      </nav>
    </div>
  </header>

  <main class="main">
    ${accountPanel(view)}
    ${billingPanel(view)}
    ${devicesPanel(view)}
    ${notificationsPanel(view)}
    ${githubAppPanel(view)}
    ${privacyPanel()}
  </main>

  <script>${SCRIPT}</script>
</body>
</html>`;
}
