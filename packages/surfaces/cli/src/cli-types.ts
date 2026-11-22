import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon, createStartedProductionDaemon, type RuntimeDaemonClient, type RuntimeDeps } from "@archcontext/local-runtime/runtime-daemon";

export const PROJECTION_PUBLISH_VALUE_FLAGS = ["--base", "--base-sha", "--branch", "--interval", "--publisher", "--publisher-command", "--remote"] as const;
export const PROJECTION_PUBLISH_BOOLEAN_FLAGS = ["--accept-observed-major-change", "--follow"] as const;
export const PROJECTION_PUBLISH_STATUS_VALUE_FLAGS = ["--base", "--remote"] as const;
export const PROJECTION_VERIFY_PR_VALUE_FLAGS = ["--base"] as const;
export const PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS = 300;
export const PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS = 30;

export interface CliRuntimeDeps extends RuntimeDeps {
  runtimeClient?: RuntimeDaemonClient;
  /** Source of `plan --body -` and `resolve --paths-from -`; defaults to the process stdin. */
  readStdin?: () => string | Promise<string>;
}

export interface CliRuntimeHandle {
  client: RuntimeDaemonClient;
  close(): Promise<void>;
}

export type AgentHost = "codex" | "claude" | "generic";

/**
 * A command with no injected runtime double runs on the production composition root: real adapters
 * and the wall clock. Only an injected double selects the embedded composition, whose clock is
 * frozen at the epoch for deterministic tests, so a product command never stamps 1970 into Git.
 */
export async function createCliRuntime(cwd: string, deps: CliRuntimeDeps): Promise<CliRuntimeHandle> {
  if (deps.runtimeClient) return { client: deps.runtimeClient, close: async () => undefined };
  const {
    runtimeClient: _runtimeClient,
    readStdin: _readStdin,
    localStorePath,
    maxRepoSessions,
    ...injected
  } = deps;
  const daemon = Object.keys(injected).length === 0
    ? await createStartedProductionDaemon({ root: cwd, localStorePath, maxRepoSessions })
    : await createStartedDaemon({ localStorePath: localStorePath ?? defaultLocalStorePath(cwd), maxRepoSessions, ...injected });
  return { client: daemon, close: () => daemon.stop() };
}
