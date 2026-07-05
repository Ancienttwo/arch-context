import { spawn } from "node:child_process";
import type {
  CommandInvestigationRunnerTransport,
  CommandInvestigationRunnerTransportInput,
  CommandInvestigationRunnerTransportResult
} from "@archcontext/core/agent-orchestrator";

export interface NodeInvestigationTransportOptions {
  timeoutMs?: number;
  cwd?: string;
}

/**
 * Real (non-fake) investigation transport: spawns the runner command (e.g. `claude --print
 * --output-format json`) with no shell, feeds it the runner stdin, and unwraps the Claude Code
 * `--output-format json` envelope into the shape `createCommandInvestigationRunner` expects.
 *
 * Safety properties:
 * - No shell is used (`spawn(command, args)`), so stdin content can never be interpreted as shell syntax.
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
      cwd: input.cwd ?? options.cwd
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
        settleReject(new Error("agent-investigation-output-too-large"));
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
 */
function unwrapClaudeCodeEnvelope(exitCode: number, stdout: string, stderr: string): CommandInvestigationRunnerTransportResult {
  if (exitCode !== 0) return { exitCode, stdout, stderr };
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { exitCode: 1, stdout, stderr };
  }
  if (!isPlainObject(envelope)) return { exitCode: 1, stdout, stderr };
  if (envelope.is_error === true) {
    return { exitCode: 1, stdout: String(envelope.result ?? ""), stderr };
  }
  if (typeof envelope.result !== "string") return { exitCode: 1, stdout, stderr };
  try {
    const report = JSON.parse(envelope.result);
    return { exitCode: 0, stdout: JSON.stringify({ report }) };
  } catch {
    return { exitCode: 1, stdout: envelope.result, stderr };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
