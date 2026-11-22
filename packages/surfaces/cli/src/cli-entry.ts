import { resolve } from "node:path";
import {
  ARCHCONTEXT_NODE_RANGE,
  ARCHCONTEXT_PRODUCT_VERSION,
  FailureError,
  archctxCapabilities,
  errorEnvelope,
  failureEnvelope,
  knownFailure,
  nodeVersionSatisfiesRange,
  normalizeFailureResult,
  okEnvelope,
  toEnvelope,
  type ArchctxCapabilitiesV1,
  type FailureEnvelope,
  type Json,
  type JsonEnvelope
} from "@archcontext/contracts";
import { selectedProducerFailureEnvelope } from "@archcontext/local-runtime/architecture-debt";
import { LocalEgressPolicyError } from "@archcontext/local-runtime/egress-admission";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
import { runArchitectureHistoryCommand } from "./architecture-history";
import {
  CLI_COMMAND_FLAGS,
  CliUsageError,
  cliArgumentFailure,
  cliTaskText,
  paginate,
  preflightCliArguments,
  readFlag
} from "./cli-flags";
import { generalHelpEnvelope } from "./cli-help";
import { createCliRuntime, type CliRuntimeDeps, type CliRuntimeHandle } from "./cli-types";
import { runApplyCommand, runHashCommand, runManifestPlanCommand, runPlanCommand } from "./commands/changeset";
import {
  checkCommandExitCode,
  runCheckCommand,
  runCheckpointCommand,
  runConstraintsCommand,
  runDebtCommand,
  runDepsCommand,
  runFlowsCommand,
  runRuntimeVerifyCliCommand,
  runStateMachinesCommand
} from "./commands/check";
import { runExploreCommand, runPracticesCommand, runRecommendationsCommand, runRefactorCommand } from "./commands/governance";
import {
  doctorManifest,
  doctorReport,
  runHookCommand,
  runHooksCommand,
  runtimePathsReport,
  updateCheckReport
} from "./commands/hooks-ops";
import {
  resolveCommandExitCode,
  runContextCommand,
  runExportCommand,
  runIndexCommand,
  runInitCommand,
  runModelCommand,
  runResolveCommand,
  runSyncCommand
} from "./commands/model";
import {
  runAgentContextProjectionCommand,
  runDocsAnchorsCliCommand,
  runDocsCommand,
  runProjectionProtocolCommand,
  runProjectionPublishFollowEntry
} from "./commands/projection";
import { runDecideCommand, runScanCommand, runVerifyV2Command } from "./commands/radar";
import { installMarker, uninstallMarker } from "./local-hardening";
import { runNativeContextCommand } from "./native-context";
import { runRefImpactCommand } from "./ref-impact";

export { CLI_COMMAND_FLAGS, checkCommandExitCode, doctorManifest, resolveCommandExitCode, type CliRuntimeDeps };

export function runCapabilitiesCommand() {
  return archctxCapabilities(ARCHCONTEXT_PRODUCT_VERSION);
}

type CliCommandResult = Awaited<ReturnType<typeof runCliUnchecked>> | FailureEnvelope;

export function runCli(command: "capabilities", args?: string[], cwd?: string, deps?: CliRuntimeDeps): Promise<ArchctxCapabilitiesV1 | CliCommandResult>;
export function runCli(command?: string, args?: string[], cwd?: string, deps?: CliRuntimeDeps): Promise<CliCommandResult>;
export async function runCli(command = "help", args: string[] = [], cwd = process.cwd(), deps: CliRuntimeDeps = {}): Promise<ArchctxCapabilitiesV1 | CliCommandResult> {
  if (command === "--version") {
    if (args.some((arg) => arg !== "--json") || args.length > 1) return cliArgumentFailure("version", "--version accepts only an optional --json flag");
    return okEnvelope("version", { version: ARCHCONTEXT_PRODUCT_VERSION });
  }
  if (command === "resolve") {
    const preflight = preflightCliArguments(command, args);
    if (preflight) return preflight.ok ? preflight : cliArgumentFailure("resolve", preflight.error!.message);
  }
  if (command === "capabilities") {
    const preflight = preflightCliArguments(command, args);
    if (preflight) return preflight;
    const jsonFlags = args.filter((arg) => arg === "--json");
    const unexpected = args.filter((arg) => arg !== "--json");
    if (jsonFlags.length > 1 || unexpected.length > 0) {
      return errorEnvelope("capabilities", "AC_SCHEMA_INVALID", "capabilities accepts only one optional --json flag");
    }
    return runCapabilitiesCommand();
  }
  const readerStage = command === "docs" && args[0] === "anchors" ? "docs-anchors"
    : command === "flows" ? "flows-check"
    : command === "state-machines" ? "state-machines-check" : undefined;
  const readerRequestId = readerStage === "docs-anchors" ? "docs.anchors" : readerStage === "flows-check" ? "flows.check"
    : readerStage === "state-machines-check" ? "state-machines.check" : undefined;
  const selectedRequestId = readerRequestId ?? command;
  const selected = readerStage !== undefined || ["debt", "checkpoint", "complete", "review"].includes(command)
    || (command === "practices" && args[0] === "checkpoint")
    || (command === "hook" && args[0] === "checkpoint");
  try {
    if (selected) {
      const preflight = preflightCliArguments(command, args);
      if (preflight) return preflight.ok ? preflight : failureEnvelope(selectedRequestId, knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
    }
    const result = await runCliUnchecked(command, args, cwd, deps);
    return selected ? normalizeFailureResult(result, readerStage ?? "cli", readerRequestId ?? (command === "practices" ? "practices.checkpoint" : command === "hook" ? "hook.checkpoint" : command)) : result;
  } catch (error) {
    if (selected) {
      if (error instanceof CliUsageError) return failureEnvelope(selectedRequestId, knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
      if (error instanceof LocalEgressPolicyError) return failureEnvelope(selectedRequestId, knownFailure("AC_POLICY_VIOLATION", "egress-policy-denied"));
      return selectedProducerFailureEnvelope(selectedRequestId, error, readerStage ?? "cli");
    }
    if (error instanceof LocalEgressPolicyError) return errorEnvelope(command, "AC_POLICY_VIOLATION", error.message);
    if (error instanceof GitVisibleFilesUnavailableError) return errorEnvelope(command, error.code, error.message, error.reasonCode);
    if (error instanceof FailureError) return toEnvelope(command, error, "cli");
    throw error;
  }
}

async function runCliUnchecked(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  if (command === "impact") return runRefImpactCommand(args, cwd);
  if (command === "verify" && (args.includes("--base") || args.includes("--help") || args.includes("-h") || args.length === 0)) {
    return runRuntimeVerifyCliCommand(args, cwd);
  }
  if (command === "history") return runArchitectureHistoryCommand(args, cwd);
  if (command === "export" && args[0] === "native") return runNativeContextCommand(args.slice(1), cwd);
  if (command === "model" && args[0] === "export" && args[1] === "native") return runNativeContextCommand(args.slice(2), cwd);
  const preflight = preflightCliArguments(command, args);
  if (preflight) return preflight;
  if (command === "verify") return runVerifyV2Command(args, cwd);
  if (command === "scan") return runScanCommand(args, cwd);
  if (command === "decide") return runDecideCommand(args, cwd);
  if (command === "check") return runCheckCommand(args, cwd);
  if (command === "index") return runIndexCommand(args, cwd);

  let runtimeHandle: Promise<CliRuntimeHandle> | undefined;
  const runtime = async () => {
    runtimeHandle ??= createCliRuntime(cwd, deps);
    return (await runtimeHandle).client;
  };
  const execute = async () => {
    switch (command) {
    case "init": return runInitCommand(args, cwd, runtime);
    case "sync": return runSyncCommand(args, cwd, runtime);
    case "validate": return (await runtime()).validate(cwd);
    case "model": return runModelCommand(args, cwd, runtime, deps);
    case "context": return runContextCommand(args, cwd, runtime);
    case "status": return (await runtime()).runtimeStatus(cwd);
    case "projection": return await runProjectionProtocolCommand(args, cwd, runtime, deps);
    case "flows": return runFlowsCommand(args, cwd);
    case "state-machines": return runStateMachinesCommand(args, cwd);
    case "repo": {
      const subcommand = args[0] ?? "list";
      if (subcommand === "add") {
        const root = readFlag(args, "--root") ?? cwd;
        if (resolve(root) !== resolve(cwd)) return errorEnvelope("repo.add", "AC_CAPABILITY_UNSUPPORTED", "Multi-repo architecture context is outside the Local Core MVP; run archctx inside one Git repository.");
        return (await runtime()).repoAdd(root, readFlag(args, "--name"));
      }
      const daemon = await runtime();
      if (subcommand === "remove") {
        const repositoryId = readFlag(args, "--repository-id") ?? args[1];
        if (!repositoryId) return errorEnvelope("repo.remove", "AC_SCHEMA_INVALID", "repo remove requires --repository-id");
        return daemon.repoRemove(repositoryId);
      }
      return daemon.repoList();
    }
    case "landscape": return (await runtime()).landscapeStatus();
    case "recommendations": return runRecommendationsCommand(args, cwd, await runtime());
    case "refactor": return runRefactorCommand(args, cwd, runtime);
    case "explore": return runExploreCommand(args, cwd, runtime);
    case "prepare": {
      const taskText = cliTaskText("prepare", args);
      if (!taskText.ok) return taskText.envelope;
      const result = await (await runtime()).prepare(cwd, taskText.task, Number(readFlag(args, "--max-bytes") ?? 12288), Number(readFlag(args, "--max-items") ?? 12), readFlag(args, "--task-session-id") ?? "task_cli");
      return result.ok ? { ...result, data: paginate(result.data, args) } : result;
    }
    case "docs":
      if (args[0] === "anchors") return runDocsAnchorsCliCommand(args.slice(1), cwd);
      return await runDocsCommand(args, cwd, await runtime());
    case "agent-context": return await runAgentContextProjectionCommand(args, cwd, await runtime());
    case "practices": return runPracticesCommand(args, cwd, await runtime());
    case "checkpoint": return runCheckpointCommand(args, cwd);
    case "hook": return runHookCommand(args, cwd);
    case "hooks": return runHooksCommand(args);
    case "review":
    case "complete": {
      const result = await (await runtime()).completeTask(cwd, { taskSessionId: readFlag(args, "--task-session-id") ?? "task_cli", task: readFlag(args, "--task"), posture: (readFlag(args, "--posture") as any) ?? "normal", headSha: readFlag(args, "--head-sha") });
      return { ...result, requestId: command };
    }
    case "plan": return runPlanCommand(args, cwd, runtime, deps);
    case "hash": return runHashCommand(args, cwd);
    case "apply": return runApplyCommand(args, cwd, runtime);
    case "manifest": return runManifestPlanCommand(args, cwd, runtime);
    case "install": return okEnvelope("install", { marker: installMarker((readFlag(args, "--host") as any) ?? "generic") });
    case "uninstall": return okEnvelope("uninstall", { content: uninstallMarker(readFlag(args, "--content") ?? "", (readFlag(args, "--host") as any) ?? "generic") });
    case "doctor": return okEnvelope("doctor", await doctorReport(cwd, args) as unknown as Json);
    case "update": {
      if (!args.includes("--check")) return errorEnvelope("update", "AC_CAPABILITY_UNSUPPORTED", "update only supports read-only checks; run archctx update --check");
      return okEnvelope("update.check", updateCheckReport({ checkUpdates: true }) as unknown as Json);
    }
    case "paths": return okEnvelope("paths", runtimePathsReport(cwd) as unknown as Json);
    case "export": return runExportCommand(args, cwd);
    case "debt": return runDebtCommand(args, cwd);
    case "deps": return runDepsCommand(args, cwd);
    case "constraints": return runConstraintsCommand(args, cwd);
    case "resolve": return runResolveCommand(args, cwd, deps);
    case "help":
    default: return generalHelpEnvelope();
    }
  };
  try {
    return await execute();
  } finally {
    const handle = await runtimeHandle?.catch(() => undefined);
    await handle?.close();
  }
}

export async function runCliProcessEntry(argv: string[], cwd: string, versions: { node: string; bun?: string }): Promise<void> {
  const [, , command, ...args] = argv;
  const nodeEngineError = nodeEngineErrorEnvelope(command ?? "help", versions);
  if (nodeEngineError) {
    process.stdout.write(`${renderResult(nodeEngineError, command === "export" && args[0] === "native" ? "json" : readFlag(args, "--format") ?? "json")}\n`);
    process.exitCode = 1;
    return;
  }
  if (command === "capabilities") {
    const result = await runCli(command, args, cwd);
    if ("ok" in result) {
      process.stdout.write(`${renderResult(result, "json")}\n`);
      if (result.ok === false) process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return;
  }
  if (command === "projection" && args[0] === "publish" && args.includes("--follow") && preflightCliArguments(command, args) === undefined) {
    process.exitCode = await runProjectionPublishFollowEntry(args.slice(1), cwd);
    return;
  }
  const result = await runCli(command, args, cwd).catch(cliFailureEnvelope);
  process.stdout.write(`${renderResult(result, command === "export" && args[0] === "native" ? "json" : readFlag(args, "--format") ?? "json")}\n`);
  if (result.ok === false) process.exitCode = 1;
  if ((command === "validate" || command === "sync" || (command === "model" && args[0] === "validate")) && result.ok && (result.data as { valid?: boolean } | undefined)?.valid === false) process.exitCode = 1;
  if (command === "resolve" || (command === "model" && args[0] === "resolve")) process.exitCode = resolveCommandExitCode(result);
  if (command === "check") process.exitCode = checkCommandExitCode(result);
  if (command === "sync" && args.includes("--check") && result.ok && (result.data as { fresh?: boolean } | undefined)?.fresh === false) process.exitCode = 2;
}

function renderResult(result: any, format: string): string {
  if (format === "markdown" && result.requestId === "projection.slice" && result.ok) return result.data.markdown.trimEnd();
  if (format !== "human") return JSON.stringify(result, null, 2);
  if (!result.ok) return `ERROR ${result.error?.code}: ${result.error?.message}`;
  const codeFactsLine = result.requestId === "doctor" ? `${doctorCodeFactsLine(result.data?.codeFacts)}\n` : "";
  return `OK ${result.requestId}\n${codeFactsLine}${JSON.stringify(result.data, null, 2)}`;
}

function doctorCodeFactsLine(codeFacts: any): string {
  if (!codeFacts) return "code facts: not reported";
  if (codeFacts.state === "unavailable") return `code facts: unavailable (${codeFacts.message})`;
  if (codeFacts.state === "index-missing") return "code facts: index missing; run `codegraph init`, or `archctx index seed` in a linked worktree once the primary checkout has published a base index";
  const issues = codeFacts.issues.length === 0 ? "" : ` (${codeFacts.issues.map((issue: { code: string }) => issue.code).join(", ")})`;
  return `code facts: ${codeFacts.state}${issues}; CodeGraph ${codeFacts.codeGraphVersion}`;
}

function nodeEngineErrorEnvelope(command: string, versions: { node: string; bun?: string }): JsonEnvelope | undefined {
  if (versions.bun !== undefined || nodeVersionSatisfiesRange(versions.node)) return undefined;
  return errorEnvelope(
    command,
    "AC_NODE_VERSION_UNSUPPORTED",
    `archctx requires Node.js ${ARCHCONTEXT_NODE_RANGE}; this process runs Node.js ${versions.node}`,
    undefined,
    { nodeVersion: versions.node, supportedRange: ARCHCONTEXT_NODE_RANGE }
  );
}

function cliFailureEnvelope(error: unknown): JsonEnvelope | FailureEnvelope {
  if (error instanceof CliUsageError) return errorEnvelope("cli", "AC_SCHEMA_INVALID", error.message);
  if (error instanceof FailureError) return toEnvelope("cli", error, "cli");
  return errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error));
}
