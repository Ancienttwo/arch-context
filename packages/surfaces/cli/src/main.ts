#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorEnvelope, okEnvelope } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { checkpoint, completeTask } from "@archcontext/core/application";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "@archcontext/cloud/hardening";
import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import {
  ArchctxRuntimeRpcServer,
  createRuntimeRpcClientFromConnectionFile,
  createStartedDaemon,
  defaultDaemonConnectionPath,
  type RuntimeDaemonClient,
  type RuntimeDeps
} from "@archcontext/local-runtime/runtime-daemon";
import { exportLikeC4Model, importLikeC4InitialModel } from "@archcontext/surfaces/adapter-likec4";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "@archcontext/surfaces/adapter-structurizr";
import { exportMermaidModel, loadNativeModelFromArchContext } from "@archcontext/surfaces/renderer";

const [, , command, ...args] = process.argv;
const CLI_ENTRY = fileURLToPath(import.meta.url);
const DAEMON_START_TIMEOUT_MS = 5_000;

if (import.meta.main) {
  if (command === "daemon" && args[0] === "start" && args.includes("--foreground")) {
    await runForegroundDaemon(process.cwd(), args).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  } else {
    const result = await runCli(command, args, process.cwd()).catch((error) =>
      errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error))
    );
    process.stdout.write(`${renderResult(result, readFlag(args, "--format") ?? "json")}\n`);
  }
}

export interface CliRuntimeDeps extends RuntimeDeps {
  runtimeClient?: RuntimeDaemonClient;
  disableRpcDiscovery?: boolean;
}

export async function runCli(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  if (command === "daemon") return runDaemonCommand(args, cwd);
  const daemon = await createCliRuntime(cwd, deps);
  switch (command) {
    case "init":
      return daemon.init(cwd, readFlag(args, "--name") ?? "ArchContext Project");
    case "sync":
      return daemon.sync(cwd, readRepeatedFlag(args, "--changed"));
    case "validate":
      return daemon.validate(cwd);
    case "context": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("context", "AC_SCHEMA_INVALID", "context requires --task or task text");
      if (args.includes("--landscape")) {
        await daemon.repoAdd(cwd, readFlag(args, "--name") ?? "local");
        return daemon.contextLandscape(task, Number(readFlag(args, "--max-symbols") ?? 12));
      }
      return daemon.context(cwd, task, Number(readFlag(args, "--max-symbols") ?? 12));
    }
    case "status":
      return daemon.runtimeStatus(cwd);
    case "repo": {
      const subcommand = args[0] ?? "list";
      if (subcommand === "add") return daemon.repoAdd(readFlag(args, "--root") ?? cwd, readFlag(args, "--name"));
      if (subcommand === "remove") {
        const repositoryId = readFlag(args, "--repository-id") ?? args[1];
        if (!repositoryId) return errorEnvelope("repo.remove", "AC_SCHEMA_INVALID", "repo remove requires --repository-id");
        return daemon.repoRemove(repositoryId);
      }
      return daemon.repoList();
    }
    case "landscape":
      return daemon.landscapeStatus();
    case "explore": {
      const subcommand = args[0] ?? "status";
      if (subcommand === "projection") return daemon.explorerProjection(cwd, readFlag(args, "--query"));
      if (subcommand === "contract") return daemon.explorerServiceContract(Number(readFlag(args, "--token-ttl-seconds") ?? 900));
      if (subcommand === "status") return daemon.explorerStatus();
      if (subcommand === "stop") return daemon.stopExplorer();
      if (subcommand === "revoke") return daemon.revokeExplorerToken();
      if (subcommand === "start") {
        if (args.includes("--foreground")) {
          return daemon.startExplorer(cwd, {
            port: Number(readFlag(args, "--port") ?? 0),
            tokenTtlSeconds: Number(readFlag(args, "--token-ttl-seconds") ?? 900)
          });
        }
        return {
          schemaVersion: "archcontext.envelope/v1",
          ok: true,
          requestId: "explorer.start",
          data: {
            command: "archctx explore start --foreground",
            bindHost: "127.0.0.1",
            defaultEnabled: false,
            readOnly: true,
            egress: "none",
            tokenRequired: true
          }
        };
      }
      return errorEnvelope("explore", "AC_SCHEMA_INVALID", "explore requires start|stop|status|revoke|projection|contract");
    }
    case "prepare": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("prepare", "AC_SCHEMA_INVALID", "prepare requires --task or task text");
      const result = await daemon.prepare(
        cwd,
        task,
        Number(readFlag(args, "--max-bytes") ?? 12288),
        Number(readFlag(args, "--max-items") ?? 12)
      );
      return result.ok ? { ...result, data: paginate(result.data, args) } : result;
    }
    case "checkpoint":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "checkpoint",
        data: checkpoint({ root: cwd, expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest") ?? computeWorktreeDigest(cwd) })
      };
    case "complete":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "complete",
        data: completeTask({
          taskSessionId: readFlag(args, "--task-session-id") ?? "task_cli",
          posture: (readFlag(args, "--posture") as any) ?? "normal",
          headSha: requireFlag(args, "--head-sha"),
          currentHeadSha: readFlag(args, "--current-head-sha") ?? requireFlag(args, "--head-sha"),
          worktreeDigest: readFlag(args, "--worktree-digest") ?? computeWorktreeDigest(cwd),
          modelDigest: requireFlag(args, "--model-digest"),
          codeFactsDigest: requireFlag(args, "--codefacts-digest")
        } as any)
      };
    case "plan": {
      const path = readFlag(args, "--path");
      if (!path) return errorEnvelope("plan", "AC_SCHEMA_INVALID", "plan requires --path");
      return daemon.planUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        operations: [{ op: "create_entity", path, expectedHash: readFlag(args, "--expected-hash") ?? "missing", body: readFlag(args, "--body") ?? "" }]
      });
    }
    case "apply": {
      return daemon.applyUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        approved: args.includes("--approved"),
        expectedWorktreeDigest: requireFlag(args, "--expected-worktree-digest")
      });
    }
    case "config":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "config",
        data: {
          codex: { mcpServers: { archcontext: { command: "archctx", args: ["mcp"] } } },
          claude: { mcpServers: { archcontext: { command: "archctx", args: ["mcp"] } } },
          generic: { command: "archctx", args: ["mcp"], transport: "stdio" }
        }
      };
    case "mcp":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "mcp",
        data: { command: "archctx mcp", stdout: "protocol-only", logs: "stderr" }
      };
    case "install":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "install",
        data: { marker: installMarker((readFlag(args, "--host") as any) ?? "generic") }
      };
    case "uninstall":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "uninstall",
        data: { content: uninstallMarker(readFlag(args, "--content") ?? "", (readFlag(args, "--host") as any) ?? "generic") }
      };
    case "doctor":
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "doctor", data: diagnostics() };
    case "privacy-audit":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "privacy-audit",
        data: { dependencyAudit: dependencyAudit(cwd), secretScan: secretScan(cwd) }
      };
    case "export": {
      const format = args[0] ?? readFlag(args, "--format") ?? "mermaid";
      const model = loadNativeModelFromArchContext(cwd);
      const result =
        format === "likec4" ? exportLikeC4Model(model) :
        format === "structurizr" ? exportStructurizrWorkspace(model) :
        format === "mermaid" ? exportMermaidModel(model) :
        undefined;
      if (!result) return errorEnvelope("export", "AC_SCHEMA_INVALID", "export requires likec4, structurizr, or mermaid");
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "export", data: result as any };
    }
    case "import": {
      const format = args[0] ?? readFlag(args, "--format");
      const content = readFlag(args, "--content");
      if (!format || !content) return errorEnvelope("import", "AC_SCHEMA_INVALID", "import requires likec4|structurizr and --content");
      const result =
        format === "likec4" ? importLikeC4InitialModel(content) :
        format === "structurizr" ? importStructurizrInitialModel(content) :
        undefined;
      if (!result) return errorEnvelope("import", "AC_SCHEMA_INVALID", "import requires likec4 or structurizr");
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "import", data: { ...result, mode: "initialization-only" } as any };
    }
    case "tunnel":
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "tunnel",
        data: {
          command: "archctx mcp",
          bindHost: "127.0.0.1",
          scopes: ["context:read", "changeset:preview"],
          writes: "disabled-by-default-local-confirmation-required",
          revocation: "archctx tunnel --revoke"
        }
      };
    case "help":
    default:
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "help",
        data: {
          commands: ["init", "sync", "validate", "context", "status", "daemon", "repo", "landscape", "explore", "prepare", "checkpoint", "plan", "apply", "complete", "config", "mcp", "install", "uninstall", "doctor", "privacy-audit", "export", "import", "tunnel"],
          examples: ["archctx init --name MyApp", "archctx daemon start", "archctx explore start --foreground", "archctx export likec4", "archctx import structurizr --content '<json>'", "archctx tunnel"]
        }
      };
  }
}

async function createCliRuntime(cwd: string, deps: CliRuntimeDeps): Promise<RuntimeDaemonClient> {
  if (deps.runtimeClient) return deps.runtimeClient;
  if (!deps.disableRpcDiscovery && !hasEmbeddedRuntimeDeps(deps)) {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (client) {
      const health = await client.health().catch(() => undefined);
      if ((health as any)?.ok === true) return client;
    }
  }
  return createStartedDaemon({ localStorePath: defaultLocalStorePath(cwd), ...deps });
}

function hasEmbeddedRuntimeDeps(deps: CliRuntimeDeps): boolean {
  return [
    "codeFacts",
    "codeGraphProviderFactory",
    "modelStore",
    "localStore",
    "changeSetEngine",
    "localStorePath",
    "clock",
    "maxRepoSessions"
  ].some((key) => key in deps);
}

async function runDaemonCommand(args: string[], cwd: string) {
  const subcommand = args[0] ?? "status";
  if (subcommand === "status") {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (!client) {
      return okEnvelope("daemon.status", {
        running: false,
        protocol: "http-loopback",
        connectionPath: defaultDaemonConnectionPath(cwd)
      } as any);
    }
    const health = await client.health().catch(() => undefined);
    if ((health as any)?.ok === true) {
      return okEnvelope("daemon.status", {
        running: true,
        ...client.connectionInfo(),
        token: "stored-in-connection-file"
      } as any);
    }
    return okEnvelope("daemon.status", {
      running: false,
      staleConnection: true,
      connectionPath: client.connectionInfo().connectionPath
    } as any);
  }
  if (subcommand === "start") {
    if (args.includes("--foreground")) {
      return okEnvelope("daemon.start", {
        command: "archctx daemon start --foreground",
        protocol: "http-loopback",
        bindHost: "127.0.0.1",
        connectionPath: defaultDaemonConnectionPath(cwd),
        note: "foreground process writes the bearer token to the local connection file"
      } as any);
    }
    return startBackgroundDaemon(args, cwd);
  }
  if (subcommand === "stop") {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (!client) return errorEnvelope("daemon.stop", "AC_RUNTIME_UNAVAILABLE", "No archctxd connection file found");
    return client.shutdown();
  }
  return errorEnvelope("daemon", "AC_SCHEMA_INVALID", "daemon requires start|status|stop");
}

async function startBackgroundDaemon(args: string[], cwd: string) {
  const existing = await runningDaemonInfo(cwd);
  if (existing) {
    return okEnvelope("daemon.start", {
      running: true,
      alreadyRunning: true,
      ...existing,
      token: "stored-in-connection-file"
    } as any);
  }

  const connectionPath = defaultDaemonConnectionPath(cwd);
  const controlDir = dirname(connectionPath);
  const logPath = join(controlDir, "archctxd.log");
  mkdirSync(controlDir, { recursive: true });
  const logFd = openSync(logPath, "a", 0o600);
  try {
    const child = spawn(process.execPath, [
      CLI_ENTRY,
      "daemon",
      "start",
      "--foreground",
      "--port",
      readFlag(args, "--port") ?? "0"
    ], {
      cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd]
    });
    child.unref();
    const ready = await waitForDaemonReady(cwd, Number(readFlag(args, "--timeout-ms") ?? DAEMON_START_TIMEOUT_MS));
    if (!ready) {
      return errorEnvelope("daemon.start", "AC_RUNTIME_UNAVAILABLE", `archctxd did not become ready; log=${logPath}`);
    }
    return okEnvelope("daemon.start", {
      running: true,
      background: true,
      childPid: child.pid,
      ...ready,
      logPath,
      token: "stored-in-connection-file"
    } as any);
  } finally {
    closeSync(logFd);
  }
}

async function runningDaemonInfo(cwd: string) {
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (!client) return undefined;
  const health = await client.health().catch(() => undefined);
  return (health as any)?.ok === true ? client.connectionInfo() : undefined;
}

async function waitForDaemonReady(cwd: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await runningDaemonInfo(cwd);
    if (ready) return ready;
    await sleep(50);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runForegroundDaemon(cwd: string, args: string[]): Promise<void> {
  const daemon = await createStartedDaemon({ localStorePath: defaultLocalStorePath(cwd) });
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const server = new ArchctxRuntimeRpcServer(daemon, {
    root: cwd,
    port: Number(readFlag(args, "--port") ?? 0),
    onStop: resolveStopped
  });
  const connection = await server.start();
  const result = okEnvelope("daemon.start", {
    running: true,
    protocol: connection.protocol,
    version: connection.version,
    url: connection.url,
    pid: connection.pid,
    connectionPath: connection.connectionPath,
    lockPath: connection.lockPath,
    token: "stored-in-connection-file"
  } as any);
  process.stdout.write(`${renderResult(result, readFlag(args, "--format") ?? "json")}\n`);
  const stop = async () => {
    await server.stop();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await stopped;
}

function paginate(value: any, args: string[]) {
  const maxItems = Number(readFlag(args, "--max-items") ?? 0);
  if (!maxItems || !Array.isArray(value?.context?.relevantNodes)) return value;
  return {
    ...value,
    context: {
      ...value.context,
      relevantNodes: value.context.relevantNodes.slice(0, maxItems),
      page: { maxItems, hasMore: value.context.relevantNodes.length > maxItems }
    }
  };
}

function renderResult(result: any, format: string): string {
  if (format !== "human") return JSON.stringify(result, null, 2);
  if (!result.ok) return `ERROR ${result.error?.code}: ${result.error?.message}`;
  return `OK ${result.requestId}\n${JSON.stringify(result.data, null, 2)}`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function requireFlag(args: string[], flag: string): string {
  const value = readFlag(args, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}
