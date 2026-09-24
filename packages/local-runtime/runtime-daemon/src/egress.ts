import { CODEGRAPH_TELEMETRY_DISABLED_VALUE, CODEGRAPH_TELEMETRY_ENV } from "@archcontext/local-runtime/codegraph-adapter";
import { CONTEXT7_ENABLED_ENV, CONTEXT7_MODE_ENV, DEFAULT_CONTEXT7_API_BASE } from "@archcontext/local-runtime/context7-adapter";

/**
 * Live configuration the caller resolved from the current repository (the manifest and the
 * user-level audit consent live outside this package). Env-driven integrations are read from `env`.
 */
export interface LiveEgressConfig {
  /** `audit.githubIssues.enabled` in the repository manifest. */
  auditEnabled?: boolean;
  /** User-level audit consent exists for this repository (issue #161). */
  auditUserConsent?: boolean;
  /** Env var holding the audit-approve GitHub PAT; its presence enables gh publishing. */
  githubIssuesTokenEnv?: string;
}

export interface NonLocalEgressChannel {
  channel: "context7" | "agent-audit" | "github-issue-publishing";
  destination: string;
  trigger: string;
  data: string;
  status: "enabled" | "declared-awaiting-user-consent";
}

/**
 * `defaultOutbound` is the product's default policy; `effectiveOutbound` / `nonLocalEgress` are
 * computed from live configuration, so enabling Context7, the agent audit, or gh publishing is
 * reported instead of being hidden behind the "local-only" default (issue #161).
 */
export function effectiveEgressChannels(env: Record<string, string | undefined>, live: LiveEgressConfig): NonLocalEgressChannel[] {
  const channels: NonLocalEgressChannel[] = [];
  if (env[CONTEXT7_ENABLED_ENV] === "1") {
    channels.push({
      channel: "context7",
      destination: DEFAULT_CONTEXT7_API_BASE,
      trigger: env[CONTEXT7_MODE_ENV] === "prepare-unknowns" ? "prepare-unknowns and archctx docs fetch" : "archctx docs fetch (manual)",
      data: "pinned library id, version and a sanitized documentation query",
      status: "enabled"
    });
  }
  if (live.auditEnabled) {
    channels.push({
      channel: "agent-audit",
      destination: "model provider configured for the `claude` runner",
      trigger: "archctx audit run",
      data: "repository content the runner reads plus the ledger context bundle",
      status: live.auditUserConsent ? "enabled" : "declared-awaiting-user-consent"
    });
    const tokenEnv = live.githubIssuesTokenEnv;
    if (tokenEnv && env[tokenEnv]) {
      channels.push({
        channel: "github-issue-publishing",
        destination: "https://api.github.com (via gh)",
        trigger: "archctx audit approve",
        data: "approved advisory issue titles and bodies",
        status: live.auditUserConsent ? "enabled" : "declared-awaiting-user-consent"
      });
    }
  }
  return channels;
}

export function localEgressStatus(env: Record<string, string | undefined> = process.env, live: LiveEgressConfig = {}) {
  const configuredDoNotTrack = env[CODEGRAPH_TELEMETRY_ENV];
  const effectiveDoNotTrack = configuredDoNotTrack ?? CODEGRAPH_TELEMETRY_DISABLED_VALUE;
  const codeGraphTelemetry = effectiveDoNotTrack === CODEGRAPH_TELEMETRY_DISABLED_VALUE ? "disabled" : "not-disabled-by-env";
  const warnings = codeGraphTelemetry === "disabled" ? [] : [`${CODEGRAPH_TELEMETRY_ENV} is ${effectiveDoNotTrack}; CodeGraph telemetry is not disabled by environment`];
  const nonLocalEgress = effectiveEgressChannels(env, live);
  const effectiveOutbound = nonLocalEgress.some((channel) => channel.status === "enabled") ? "non-local" : "local-only";
  return {
    ok: warnings.length === 0,
    defaultOutbound: "local-only",
    effectiveOutbound,
    nonLocalEgress,
    cloudContentUpload: "deny",
    secureMcpTunnel: "disabled-by-default",
    thirdPartyTelemetry: codeGraphTelemetry === "disabled" ? "disabled" : "not-disabled-by-env",
    codeGraph: {
      provider: "codegraph",
      telemetry: codeGraphTelemetry,
      envVar: CODEGRAPH_TELEMETRY_ENV,
      configuredValue: configuredDoNotTrack ?? null,
      effectiveValue: effectiveDoNotTrack,
      source: configuredDoNotTrack === undefined ? "archcontext-default" : "environment"
    },
    warnings
  };
}
