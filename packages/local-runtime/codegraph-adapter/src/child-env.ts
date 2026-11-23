import { assertLocalEgressAllowed, localEgressMode } from "@archcontext/local-runtime/egress-admission";

export const CODEGRAPH_TELEMETRY_ENV = "DO_NOT_TRACK";
export const CODEGRAPH_TELEMETRY_DISABLED_VALUE = "1";

type MutableEnv = Record<string, string | undefined>;

export function disableCodeGraphTelemetryByDefault(env: MutableEnv = process.env): string {
  localEgressMode(env);
  if (env[CODEGRAPH_TELEMETRY_ENV] !== undefined && env[CODEGRAPH_TELEMETRY_ENV] !== CODEGRAPH_TELEMETRY_DISABLED_VALUE) {
    assertLocalEgressAllowed("codegraph-telemetry", env);
  }
  env[CODEGRAPH_TELEMETRY_ENV] ??= CODEGRAPH_TELEMETRY_DISABLED_VALUE;
  return env[CODEGRAPH_TELEMETRY_ENV] ?? CODEGRAPH_TELEMETRY_DISABLED_VALUE;
}

/**
 * The environment of the CodeGraph `sync` child. CodeGraph runs `git status` in the checkout;
 * without GIT_OPTIONAL_LOCKS=0, git refreshes stale stat data and rewrites .git/index, so archctx
 * would change tracked git state.
 */
export function codeGraphChildEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
}
