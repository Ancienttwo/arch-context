import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon, type RuntimeDaemonClient, type RuntimeDeps } from "@archcontext/local-runtime/runtime-daemon";

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
  disableRpcDiscovery?: boolean;
}

export interface CliRuntimeHandle {
  client: RuntimeDaemonClient;
  close(): Promise<void>;
}

export type AgentHost = "codex" | "claude" | "generic";

export async function createCliRuntime(cwd: string, deps: CliRuntimeDeps): Promise<CliRuntimeHandle> {
  if (deps.runtimeClient) return { client: deps.runtimeClient, close: async () => undefined };
  const {
    runtimeClient: _runtimeClient,
    disableRpcDiscovery: _disableRpcDiscovery,
    ...runtimeDeps
  } = deps;
  const daemon = await createStartedDaemon({
    localStorePath: defaultLocalStorePath(cwd),
    ...runtimeDeps
  });
  return { client: daemon, close: () => daemon.stop() };
}
