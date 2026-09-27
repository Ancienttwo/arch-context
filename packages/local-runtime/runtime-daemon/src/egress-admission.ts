/** A process-wide deny control; it never grants feature consent or publish authority. */
export const LOCAL_EGRESS_MODE_ENV = "ARCHCONTEXT_EGRESS_MODE";
export type LocalEgressMode = "configured" | "local-only";
export const LOCAL_EGRESS_CHANNELS = ["context7", "agent-audit", "github-issue-publishing", "npm-update-check", "codegraph-telemetry"] as const;
export type LocalEgressChannel = typeof LOCAL_EGRESS_CHANNELS[number];
type EgressEnvironment = Record<string, string | undefined>;

export class LocalEgressPolicyError extends Error {}

export function localEgressMode(env: EgressEnvironment = process.env): LocalEgressMode {
  const mode = env[LOCAL_EGRESS_MODE_ENV];
  if (mode === undefined || mode === "configured") return "configured";
  if (mode === "local-only") return mode;
  throw new LocalEgressPolicyError(`egress-policy-invalid: ${LOCAL_EGRESS_MODE_ENV} must be configured or local-only`);
}

export function localEgressAdmission(channel: LocalEgressChannel, env: EgressEnvironment = process.env) {
  if (!LOCAL_EGRESS_CHANNELS.includes(channel)) throw new LocalEgressPolicyError("egress-channel-invalid");
  const mode = localEgressMode(env);
  return { channel, mode, allowed: mode === "configured", reason: mode === "local-only" ? "local-only-policy" : "feature-authorization-required" };
}

export function assertLocalEgressAllowed(channel: LocalEgressChannel, env: EgressEnvironment = process.env): void {
  const decision = localEgressAdmission(channel, env);
  if (!decision.allowed) throw new LocalEgressPolicyError(`egress-denied: ${channel} blocked by ${LOCAL_EGRESS_MODE_ENV}=local-only`);
}

/** Every real non-local fetch/spawn crosses this boundary after its domain authorization. */
export function withLocalEgress<T>(channel: LocalEgressChannel, operation: () => T, env: EgressEnvironment = process.env): T {
  assertLocalEgressAllowed(channel, env);
  return operation();
}
