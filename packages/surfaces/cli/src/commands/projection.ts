import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  FailureError,
  errorEnvelope,
  failureEnvelope,
  knownFailure,
  toEnvelope,
  type JsonEnvelope
} from "@archcontext/contracts";
import type { ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import {
  createCommandProjectionPublisher,
  createGhProjectionPublisher,
  createNoneProjectionPublisher,
  createStartedDaemon,
  runDocsAnchorsCommand,
  runProjectionCheckInvocation,
  runProjectionFreshnessCommand,
  runProjectionPublishCommand,
  runProjectionPublishFollow,
  runProjectionPublishStatusCommand,
  runProjectionSliceCommand,
  runProjectionSnapshotCommand,
  runProjectionVerifyPrCommand,
  type ProjectionPublisherPort,
  type RuntimeAgentContextProjectionInput,
  type RuntimeDaemonClient,
  type RuntimeDocsProjectionInput,
  type RuntimeProjectionInvocation
} from "@archcontext/local-runtime/runtime-daemon";
import {
  acceptedArchitectureChange,
  architectureProjectionProfile,
  cliArgumentFailure,
  projectionWriterStrayToken,
  readFlag,
  readRepeatedFlag
} from "../cli-flags";
import {
  PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS,
  PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS,
  PROJECTION_PUBLISH_STATUS_VALUE_FLAGS,
  PROJECTION_PUBLISH_VALUE_FLAGS,
  PROJECTION_VERIFY_PR_VALUE_FLAGS,
  type CliRuntimeDeps
} from "../cli-types";

type ProjectionWriterCliAction = "publish" | "publish-status" | "verify-pr";

interface ProjectionPublishCliInput {
  remote?: string;
  base?: string;
  baseSha?: string;
  branch?: string;
  publisher: ProjectionPublisherPort;
  acceptObservedMajorChange: boolean;
  follow: boolean;
  intervalSeconds: number;
}

export async function runDocsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "status";
  if (["plan", "apply", "adopt", "drift", "clean"].includes(subcommand)) {
    return runArchitectureDocsProjectionCommand(args, cwd, daemon);
  }
  if (!["status", "resolve", "pin", "fetch", "purge"].includes(subcommand)) {
    return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs requires status|resolve|pin|fetch|purge|plan|apply|adopt|drift|clean|anchors");
  }
  if (subcommand === "status") {
    return daemon.docs(cwd, { command: "status", provider: "context7" });
  }
  if (subcommand === "resolve") {
    return daemon.docs(cwd, {
      command: "resolve",
      provider: "context7",
      libraryName: readFlag(args, "--library") ?? args[1],
      query: readFlag(args, "--query"),
      allowNetwork: args.includes("--allow-network")
    });
  }
  if (subcommand === "pin") {
    return daemon.docs(cwd, {
      command: "pin",
      provider: "context7",
      libraryId: readFlag(args, "--library-id") ?? args[1],
      version: readFlag(args, "--version"),
      approved: args.includes("--approved")
    });
  }
  if (subcommand === "fetch") {
    return daemon.docs(cwd, {
      command: "fetch",
      provider: "context7",
      libraryId: readFlag(args, "--library-id") ?? args[1],
      intent: readFlag(args, "--intent") ?? readFlag(args, "--query"),
      query: readFlag(args, "--query"),
      allowNetwork: args.includes("--allow-network"),
      forceRefresh: args.includes("--force-refresh")
    });
  }
  return daemon.docs(cwd, {
    command: "purge",
    provider: "context7",
    libraryId: readFlag(args, "--library-id"),
    all: args.includes("--all")
  });
}

export function runDocsAnchorsCliCommand(args: string[], cwd: string) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") continue;
    if (arg === "--profile" && args[index + 1] !== undefined && !args[index + 1]!.startsWith("--")) {
      index += 1;
      continue;
    }
    return failureEnvelope("docs.anchors", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  }
  let profile: ArchitectureProjectionProfile | undefined;
  try {
    profile = architectureProjectionProfile(args);
  } catch {
    return failureEnvelope("docs.anchors", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  }
  return runDocsAnchorsCommand(cwd, profile ? { profile } : {});
}

async function runArchitectureDocsProjectionCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const action = args[0] ?? "plan";
  try {
    return await daemon.docsProjection(findRepositoryRoot(cwd), {
      action: action as RuntimeDocsProjectionInput["action"],
      profile: architectureProjectionProfile(args),
      acceptedChange: acceptedArchitectureChange(args),
      id: readFlag(args, "--id"),
      taskSessionId: readFlag(args, "--task-session-id"),
      approved: args.includes("--approved"),
      expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest"),
      adoptionPlanId: readFlag(args, "--adoption-plan-id")
    });
  } catch (error) {
    if (error instanceof FailureError) return toEnvelope(`docs.${action}`, error, "cli");
    return errorEnvelope(`docs.${action}`, "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
  }
}

export async function runAgentContextProjectionCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  return daemon.agentContextProjection(findRepositoryRoot(cwd), {
    action: (args[0] ?? "plan") as RuntimeAgentContextProjectionInput["action"],
    id: readFlag(args, "--id"),
    taskSessionId: readFlag(args, "--task-session-id"),
    approved: args.includes("--approved"),
    expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest")
  });
}

export async function runProjectionProtocolCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  const action = args[0] ?? "run";
  if (action === "publish" || action === "publish-status" || action === "verify-pr") return runProjectionWriterCliCommand(action, args.slice(1), cwd, deps);
  if (action === "snapshot") {
    const unexpected = args.slice(1).filter((arg) => arg !== "--json");
    if (unexpected.length > 0) return errorEnvelope("projection.snapshot", "AC_SCHEMA_INVALID", "projection snapshot accepts only --json");
    return runProjectionSnapshotCommand(cwd);
  }
  if (action === "freshness") return runProjectionFreshnessCliCommand(args.slice(1), cwd);
  if (action === "slice") return runProjectionSliceCliCommand(args.slice(1), cwd);
  if (action !== "run") return errorEnvelope("projection", "AC_SCHEMA_INVALID", "projection requires run --request-json <request>, snapshot|freshness [--json], slice --base <ref>, or publish|publish-status|verify-pr");
  const raw = readFlag(args, "--request-json");
  if (!raw) return errorEnvelope(`projection.${action}`, "AC_SCHEMA_INVALID", `projection ${action} requires --request-json`);
  let request: RuntimeProjectionInvocation["request"];
  try { request = JSON.parse(raw); }
  catch { return errorEnvelope(`projection.${action}`, "AC_SCHEMA_INVALID", "projection request is not valid JSON"); }
  if ((request as { mode?: unknown } | null)?.mode === "check") {
    return runProjectionCheckInvocation(request, cwd);
  }
  return (await runtime()).projection(findRepositoryRoot(cwd), { action: "run", request } as RuntimeProjectionInvocation);
}

function runProjectionSliceCliCommand(args: string[], cwd: string): JsonEnvelope {
  const requestId = "projection.slice";
  const stray = projectionWriterStrayToken(args, ["--base", "--changed-path"]);
  if (stray !== undefined) return cliArgumentFailure(requestId, `projection slice does not accept ${stray}; use --help`);
  const base = readFlag(args, "--base");
  if (!base || readRepeatedFlag(args, "--base").length !== 1) return cliArgumentFailure(requestId, "projection slice requires exactly one --base <ref>");
  const format = readFlag(args, "--format") ?? "json";
  if (format !== "json" && format !== "markdown") return cliArgumentFailure(requestId, "projection slice --format must be json or markdown");
  if (args.some((arg, index) => arg === "--changed-path" && args[index + 1] === "")) {
    return cliArgumentFailure(requestId, "projection slice --changed-path requires a nonempty path");
  }
  return runProjectionSliceCommand({ cwd, base, changedPaths: readRepeatedFlag(args, "--changed-path") });
}

function runProjectionFreshnessCliCommand(args: string[], cwd: string): JsonEnvelope {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") continue;
    if (arg === "--format") { index += 1; continue; }
    return errorEnvelope("projection.freshness", "AC_SCHEMA_INVALID", `projection freshness does not accept ${arg}; use --help`);
  }
  return runProjectionFreshnessCommand(cwd);
}

async function runProjectionWriterCliCommand(action: ProjectionWriterCliAction, args: string[], cwd: string, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  const requestId = `projection.${action}`;
  const valueFlags: readonly string[] = action === "publish" ? PROJECTION_PUBLISH_VALUE_FLAGS : action === "publish-status" ? PROJECTION_PUBLISH_STATUS_VALUE_FLAGS : PROJECTION_VERIFY_PR_VALUE_FLAGS;
  const stray = projectionWriterStrayToken(args, valueFlags);
  if (stray !== undefined) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `projection ${action} does not accept ${stray}; use --help`, "cli-input-invalid");
  if (action === "verify-pr") {
    const base = readFlag(args, "--base");
    if (!base) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", "projection verify-pr requires --base <ref>", "cli-input-invalid");
    return runProjectionVerifyPrCommand({ cwd, base });
  }
  if (action === "publish-status") {
    return runProjectionPublishStatusCommand({ cwd, base: readFlag(args, "--base"), remote: readFlag(args, "--remote") });
  }
  const parsed = parseProjectionPublishCliInput(args, cwd);
  if (!parsed.ok) return parsed.envelope;
  if (parsed.input.follow) {
    return errorEnvelope(requestId, "AC_SCHEMA_INVALID", "projection publish --follow is a foreground process loop of the archctx executable; without --follow this command runs once", "cli-input-invalid");
  }
  return runProjectionPublishOnce(parsed.input, cwd, deps);
}

function parseProjectionPublishCliInput(args: string[], cwd: string): { ok: true; input: ProjectionPublishCliInput } | { ok: false; envelope: JsonEnvelope } {
  const invalid = (message: string) => ({ ok: false as const, envelope: errorEnvelope("projection.publish", "AC_SCHEMA_INVALID", message, "cli-input-invalid") });
  const publisherKind = readFlag(args, "--publisher") ?? "gh";
  const publisherCommand = readFlag(args, "--publisher-command");
  const follow = args.includes("--follow");
  const baseSha = readFlag(args, "--base-sha");
  if (baseSha !== undefined && follow) return invalid("projection publish --base-sha cannot be used with --follow");
  const intervalFlag = readFlag(args, "--interval");
  if (intervalFlag !== undefined && !follow) return invalid("projection publish --interval requires --follow");
  const intervalSeconds = intervalFlag === undefined ? PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS : Number(intervalFlag);
  if (!/^\d+$/.test(intervalFlag ?? "0") || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS) {
    return invalid(`projection publish --interval must be an integer number of seconds, at least ${PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS}`);
  }
  let publisher: ProjectionPublisherPort;
  if (publisherKind === "gh" || publisherKind === "none") {
    if (publisherCommand !== undefined) return invalid("projection publish --publisher-command requires --publisher command");
    publisher = publisherKind === "gh" ? createGhProjectionPublisher() : createNoneProjectionPublisher();
  } else if (publisherKind === "command") {
    if (!publisherCommand) return invalid("projection publish --publisher command requires --publisher-command <executable>");
    const command = resolve(cwd, publisherCommand);
    if (!existsSync(command) || !statSync(command).isFile()) return invalid(`projection publish --publisher-command is not a file: ${command}`);
    publisher = createCommandProjectionPublisher({ command });
  } else {
    return invalid("projection publish --publisher must be gh, command or none");
  }
  return {
    ok: true,
    input: {
      remote: readFlag(args, "--remote"),
      base: readFlag(args, "--base"),
      baseSha,
      branch: readFlag(args, "--branch"),
      publisher,
      acceptObservedMajorChange: args.includes("--accept-observed-major-change"),
      follow,
      intervalSeconds
    }
  };
}

function runProjectionPublishOnce(input: ProjectionPublishCliInput, cwd: string, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  return runProjectionPublishCommand({
    cwd,
    remote: input.remote,
    base: input.base,
    baseSha: input.baseSha,
    branch: input.branch,
    publisher: input.publisher,
    acceptObservedMajorChange: input.acceptObservedMajorChange,
    apply: async (worktree, request) => {
      if (deps.runtimeClient) return deps.runtimeClient.projection(worktree, { action: "run", request });
      const daemon = await createStartedDaemon({ localStorePath: defaultLocalStorePath(worktree) });
      try {
        return await daemon.projection(worktree, { action: "run", request });
      } finally {
        await daemon.stop();
      }
    }
  });
}

export async function runProjectionPublishFollowEntry(args: string[], cwd: string): Promise<number> {
  const stray = projectionWriterStrayToken(args, PROJECTION_PUBLISH_VALUE_FLAGS);
  const parsed = stray === undefined
    ? parseProjectionPublishCliInput(args, cwd)
    : { ok: false as const, envelope: errorEnvelope("projection.publish", "AC_SCHEMA_INVALID", `projection publish does not accept ${stray}; use --help`, "cli-input-invalid") };
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify(parsed.envelope)}\n`);
    return 1;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await runProjectionPublishFollow({
      runOnce: () => runProjectionPublishOnce(parsed.input, cwd, {}),
      intervalMs: parsed.input.intervalSeconds * 1000,
      sleep: (ms) => sleepUnlessAborted(ms, controller.signal),
      shouldStop: () => controller.signal.aborted,
      onResult: (envelope) => { process.stdout.write(`${JSON.stringify(envelope)}\n`); }
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  return 0;
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) { resolvePromise(); return; }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolvePromise();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
