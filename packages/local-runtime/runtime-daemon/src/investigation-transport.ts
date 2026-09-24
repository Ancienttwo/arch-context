import { spawn } from "node:child_process";
import {
  InvestigationRunnerFailure,
  investigationFailureShape,
  type CommandInvestigationRunnerTransport,
  type CommandInvestigationRunnerTransportInput,
  type CommandInvestigationRunnerTransportResult
} from "@archcontext/core/agent-orchestrator";

export interface NodeInvestigationTransportOptions {
  timeoutMs?: number;
  cwd?: string;
}

/**
 * Exact variable names the investigation child may inherit: process basics (PATH/HOME, locale,
 * temp dir, terminal, the Windows equivalents), outbound proxy/CA settings the model call may need,
 * and the Claude Code / Anthropic model-provider configuration. Anything not listed here — the
 * daemon's GitHub publish PAT (`ARCHCONTEXT_GH_ISSUES_TOKEN`), `GH_TOKEN`/`GITHUB_TOKEN`, daemon
 * control tokens, cloud credentials, unrelated secrets — is dropped (issue #161).
 */
export const INVESTIGATION_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "DO_NOT_TRACK",
  // Claude Code privacy/behavior opt-outs: not credentials, and dropping them would silently
  // re-enable telemetry, error reporting, and non-essential model calls in the investigator.
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DISABLE_AUTOUPDATER",
  "DISABLE_BUG_COMMAND",
  "DISABLE_COST_WARNINGS",
  "DISABLE_NON_ESSENTIAL_MODEL_CALLS",
  "CLAUDE_CONFIG_DIR"
] as const;

/**
 * Model-provider configuration and auth for the `claude` runner. `ANTHROPIC_*` covers
 * `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`;
 * `CLAUDE_CODE_*` covers `CLAUDE_CODE_OAUTH_TOKEN` and the Bedrock/Vertex switches. These are the
 * only credential-bearing variables forwarded by default, because they are the runner's own
 * model-provider auth. Names containing `ADMIN` (e.g. `ANTHROPIC_ADMIN_KEY`, an organization admin
 * credential, not inference auth) are excluded even under these prefixes.
 */
export const INVESTIGATION_ENV_ALLOWED_PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_"] as const;
export const INVESTIGATION_ENV_EXCLUDED_SUBSTRINGS = ["ADMIN"] as const;

/**
 * Cloud credentials and config forwarded only when the runner is explicitly configured to reach
 * the model through that cloud (`CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX`); otherwise
 * they are unrelated secrets and stay in the daemon.
 */
export const INVESTIGATION_ENV_PROVIDER_CONDITIONAL: readonly { switchVar: string; names: readonly string[]; prefixes: readonly string[] }[] = [
  {
    switchVar: "CLAUDE_CODE_USE_BEDROCK",
    names: [
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_CONFIG_FILE",
      "AWS_SHARED_CREDENTIALS_FILE",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      "AWS_CONTAINER_AUTHORIZATION_TOKEN"
    ],
    prefixes: []
  },
  {
    switchVar: "CLAUDE_CODE_USE_VERTEX",
    names: ["CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "CLOUDSDK_CONFIG"],
    prefixes: ["VERTEX_REGION_CLAUDE_"]
  }
];

/**
 * Builds the investigation child's environment from an explicit allowlist instead of inheriting
 * the daemon's `process.env`. Contrast `runGh` in github-issue-executor.ts, which builds its child
 * env from exactly PATH/HOME/GH_TOKEN: the investigator is the process an audited repository can
 * prompt-inject, so it must never hold the publish credential (ADR-0042).
 */
export function investigationChildEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  const allowed = new Set<string>(INVESTIGATION_ENV_ALLOWLIST);
  const prefixes: string[] = [...INVESTIGATION_ENV_ALLOWED_PREFIXES];
  for (const conditional of INVESTIGATION_ENV_PROVIDER_CONDITIONAL) {
    if (!isTruthyEnv(source[conditional.switchVar])) continue;
    for (const name of conditional.names) allowed.add(name);
    prefixes.push(...conditional.prefixes);
  }
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowed.has(name)) {
      env[name] = value;
      continue;
    }
    const prefixMatch = prefixes.some((prefix) => name.startsWith(prefix));
    const excluded = INVESTIGATION_ENV_EXCLUDED_SUBSTRINGS.some((substring) => name.toUpperCase().includes(substring));
    if (prefixMatch && !excluded) env[name] = value;
  }
  return env;
}

function isTruthyEnv(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Real (non-fake) investigation transport: spawns the runner command (e.g. `claude --print
 * --output-format json`) with no shell, feeds it the runner stdin, and unwraps the Claude Code
 * `--output-format json` envelope into the shape `createCommandInvestigationRunner` expects.
 *
 * Safety properties:
 * - No shell is used (`spawn(command, args)`), so stdin content can never be interpreted as shell syntax.
 * - The child env is `investigationChildEnv(process.env)`, never the daemon's full environment, so
 *   the GitHub publish PAT and other unrelated credentials are not visible to the investigator.
 * - `maxOutputBytes` and the timeout are hard transport-level failures (reject the promise); a
 *   malformed/unexpected envelope is a soft failure (resolve with a non-zero exit code) so the
 *   caller's normal fallback-report path handles it without an uncaught rejection.
 * - The child process's `cwd` is bound to the target repository root (per-call `input.cwd`, falling
 *   back to the construction-time `options.cwd`), so path-relative behavior (CLAUDE.md discovery,
 *   file reads) resolves against the audited repository rather than whatever directory the daemon
 *   process happened to start in.
 */
export function createNodeInvestigationTransport(
  options: NodeInvestigationTransportOptions = {}
): CommandInvestigationRunnerTransport {
  return (input) => runNodeInvestigationTransport(input, options);
}

function runNodeInvestigationTransport(
  input: CommandInvestigationRunnerTransportInput,
  options: NodeInvestigationTransportOptions
): Promise<CommandInvestigationRunnerTransportResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.command, input.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: input.cwd ?? options.cwd,
      env: investigationChildEnv(process.env)
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (input.signal) input.signal.removeEventListener("abort", onAbort);
    };

    const settleResolve = (result: CommandInvestigationRunnerTransportResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(result);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
      rejectPromise(error);
    };

    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    };
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        settleReject(new Error("agent-investigation-timeout"));
      }, options.timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (input.maxOutputBytes !== undefined && Buffer.byteLength(stdout, "utf8") > input.maxOutputBytes) {
        settleReject(new InvestigationRunnerFailure(
          "agent-investigation-output-too-large",
          "transport-output-too-large",
          investigationFailureShape({ stdout })
        ));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      settleReject(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("exit", (code) => {
      settleResolve(unwrapClaudeCodeEnvelope(code ?? 1, stdout, stderr));
    });

    child.stdin?.end(input.stdin);
  });
}

/**
 * `claude --print --output-format json` prints one JSON envelope of the shape
 * `{ type: "result", subtype: "success", is_error: boolean, result: string, ... }`, where
 * `result` is the final assistant message text. The audit prompt instructs the agent to make
 * that final message nothing but the InvestigationReportV1 JSON, so `result` is itself a JSON
 * string we parse a second time.
 *
 * Any unexpected shape (non-zero exit, non-JSON envelope, is_error, non-JSON result) is reported
 * back as a non-zero exit with the best available diagnostic text so the caller's existing
 * fallback-report path (in `runInvestigationWithRetry`) takes over — this function never throws.
 * Each failure branch also stamps a privacy-safe `reasonCode` + `shape` (lengths/boundary chars/
 * fence heuristic only, never the content) onto the result so that path can tell the branches
 * apart instead of seeing an undifferentiated non-zero exit.
 */
function unwrapClaudeCodeEnvelope(exitCode: number, stdout: string, stderr: string): CommandInvestigationRunnerTransportResult {
  if (exitCode !== 0) {
    return { exitCode, stdout, stderr, reasonCode: "transport-process-exit-nonzero", shape: investigationFailureShape({ stdout }) };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { exitCode: 1, stdout, stderr, reasonCode: "transport-envelope-not-json", shape: investigationFailureShape({ stdout }) };
  }
  if (!isPlainObject(envelope)) {
    return { exitCode: 1, stdout, stderr, reasonCode: "transport-envelope-not-json", shape: investigationFailureShape({ stdout }) };
  }
  if (envelope.is_error === true) {
    const result = String(envelope.result ?? "");
    return {
      exitCode: 1,
      stdout: result,
      stderr,
      reasonCode: "transport-envelope-is-error",
      shape: investigationFailureShape({ stdout, result })
    };
  }
  if (typeof envelope.result !== "string") {
    return { exitCode: 1, stdout, stderr, reasonCode: "transport-result-not-string", shape: investigationFailureShape({ stdout }) };
  }
  try {
    const report = JSON.parse(envelope.result);
    return { exitCode: 0, stdout: JSON.stringify({ report }) };
  } catch {
    return {
      exitCode: 1,
      stdout: envelope.result,
      stderr,
      reasonCode: "transport-result-not-json",
      shape: investigationFailureShape({ stdout, result: envelope.result })
    };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
