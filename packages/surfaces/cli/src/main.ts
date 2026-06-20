#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorEnvelope, okEnvelope, productVersionManifest } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { checkpoint, completeTask } from "@archcontext/core/application";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "@archcontext/cloud/hardening";
import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import { findRepositoryRoot, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import {
  ArchctxRuntimeRpcServer,
  RUNTIME_RPC_VERSION,
  createRuntimeRpcClientFromConnectionFile,
  createStartedDaemon,
  createStartedProductionDaemon,
  defaultDaemonConnectionPath,
  defaultDaemonLockPath,
  recoverStaleDaemonControlFiles,
  type RuntimeDaemonClient,
  type RuntimeDeps
} from "@archcontext/local-runtime/runtime-daemon";
import { exportLikeC4Model, importLikeC4InitialModel } from "@archcontext/surfaces/adapter-likec4";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "@archcontext/surfaces/adapter-structurizr";
import { runStdioMcpLoop } from "@archcontext/surfaces/mcp-local";
import { exportMermaidModel, loadNativeModelFromArchContext } from "@archcontext/surfaces/renderer";

const [, , command, ...args] = process.argv;
const CLI_ENTRY = fileURLToPath(import.meta.url);
const DAEMON_START_TIMEOUT_MS = 5_000;

if (import.meta.main) {
  if (command === "mcp" && args.length === 0) {
    await runStdioMcpLoop(stdinLines(), (line) => process.stdout.write(`${line}\n`));
  } else if (command === "daemon" && args[0] === "start" && args.includes("--foreground")) {
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

async function* stdinLines(): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
      newline = buffer.indexOf("\n");
    }
  }
  const trailing = buffer.trim();
  if (trailing) yield trailing;
}

export interface CliRuntimeDeps extends RuntimeDeps {
  runtimeClient?: RuntimeDaemonClient;
  disableRpcDiscovery?: boolean;
}

type AgentHost = "codex" | "claude" | "generic";

export async function runCli(command = "help", args: string[] = [], cwd: string, deps: CliRuntimeDeps = {}) {
  if (command === "daemon") return runDaemonCommand(args, cwd);
  const runtime = () => createCliRuntime(cwd, deps);
  switch (command) {
    case "init":
      return (await runtime()).init(cwd, readFlag(args, "--name") ?? "ArchContext Project");
    case "sync":
      return (await runtime()).sync(cwd, readRepeatedFlag(args, "--changed"));
    case "validate":
      return (await runtime()).validate(cwd);
    case "context": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("context", "AC_SCHEMA_INVALID", "context requires --task or task text");
      const daemon = await runtime();
      if (args.includes("--landscape")) {
        await daemon.repoAdd(cwd, readFlag(args, "--name") ?? "local");
        return daemon.contextLandscape(task, Number(readFlag(args, "--max-symbols") ?? 12));
      }
      return daemon.context(cwd, task, Number(readFlag(args, "--max-symbols") ?? 12));
    }
    case "status":
      return (await runtime()).runtimeStatus(cwd);
    case "repo": {
      const subcommand = args[0] ?? "list";
      const daemon = await runtime();
      if (subcommand === "add") return daemon.repoAdd(readFlag(args, "--root") ?? cwd, readFlag(args, "--name"));
      if (subcommand === "remove") {
        const repositoryId = readFlag(args, "--repository-id") ?? args[1];
        if (!repositoryId) return errorEnvelope("repo.remove", "AC_SCHEMA_INVALID", "repo remove requires --repository-id");
        return daemon.repoRemove(repositoryId);
      }
      return daemon.repoList();
    }
    case "landscape":
      return (await runtime()).landscapeStatus();
    case "explore": {
      const subcommand = args[0] ?? "status";
      const daemon = await runtime();
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
      const result = await (await runtime()).prepare(
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
      return (await runtime()).planUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        operations: [{ op: "create_entity", path, expectedHash: readFlag(args, "--expected-hash") ?? "missing", body: readFlag(args, "--body") ?? "" }]
      });
    }
    case "apply": {
      return (await runtime()).applyUpdate(cwd, {
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
          codex: agentHostConfig("codex"),
          claude: agentHostConfig("claude"),
          generic: agentHostConfig("generic")
        }
      };
    case "mcp":
      return runMcpCommand(args);
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
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "doctor", data: await doctorReport(cwd) };
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

function runMcpCommand(args: string[]) {
  const subcommand = args[0] ?? "serve";
  if (subcommand === "serve" || subcommand === "start") {
    return okEnvelope("mcp", {
      command: "archctx mcp",
      stdout: "protocol-only",
      logs: "stderr"
    } as any);
  }
  if (!["install", "status", "remove"].includes(subcommand)) {
    return errorEnvelope("mcp", "AC_SCHEMA_INVALID", "mcp requires install|status|remove");
  }
  const host = readAgentHost(args);
  if (!host) return errorEnvelope("mcp", "AC_SCHEMA_INVALID", "--host must be codex, claude, or generic");
  if (subcommand === "install") {
    return okEnvelope("mcp.install", {
      host,
      installed: true,
      writes: "manual-host-config",
      serverName: "archcontext",
      config: agentHostConfig(host),
      marker: installMarker(host)
    } as any);
  }
  if (subcommand === "status") {
    return okEnvelope("mcp.status", {
      host,
      installed: "config-ready",
      serverName: "archcontext",
      config: agentHostConfig(host),
      command: "archctx mcp",
      transport: "stdio"
    } as any);
  }
  return okEnvelope("mcp.remove", {
    host,
    installed: false,
    writes: "manual-host-config",
    serverName: "archcontext",
    removeConfig: agentHostRemoveConfig(host),
    markerRemovedFrom: uninstallMarker(readFlag(args, "--content") ?? "", host)
  } as any);
}

function readAgentHost(args: string[]): AgentHost | undefined {
  const host = readFlag(args, "--host") ?? "generic";
  return host === "codex" || host === "claude" || host === "generic" ? host : undefined;
}

function agentHostConfig(host: AgentHost) {
  const server = { command: "archctx", args: ["mcp"] };
  if (host === "generic") return { command: "archctx", args: ["mcp"], transport: "stdio" };
  return { mcpServers: { archcontext: server } };
}

function agentHostRemoveConfig(host: AgentHost) {
  if (host === "generic") return { command: null, args: [], transport: "stdio", remove: true };
  return { mcpServers: { archcontext: null } };
}

async function doctorReport(cwd: string) {
  const product = productVersionManifest();
  const daemon = await doctorDaemon(cwd);
  const git = doctorGit(cwd);
  const sqlite = doctorSqlite(cwd);
  const permissions = doctorPermissions(cwd);
  const hardening = diagnostics();
  return {
    product,
    version: {
      product: product.product.version,
      cli: product.surfaces.cli.version,
      daemon: product.surfaces.daemon.version,
      mcp: product.surfaces.mcp.version,
      rpcSchemaVersion: product.runtime.localRpc.schemaVersion,
      schemaSetVersion: product.schemas.schemaSetVersion
    },
    daemon,
    sqlite,
    codeGraph: product.runtime.codeGraph,
    git,
    permissions,
    hardening,
    ok: hardening.supportedNode && permissions.workspace.readable && permissions.workspace.writable
  };
}

async function doctorDaemon(cwd: string) {
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (!client) {
    return {
      running: false,
      connectionPath: defaultDaemonConnectionPath(cwd),
      lockPath: defaultDaemonLockPath(cwd)
    };
  }
  const health = await client.health().catch(() => undefined);
  return {
    running: (health as any)?.ok === true,
    staleConnection: (health as any)?.ok !== true,
    rpcVersionCompatible: (health as any)?.schemaVersion === productVersionManifest().runtime.localRpc.schemaVersion,
    connection: client.connectionInfo(),
    health: (health as any)?.ok === true ? {
      composition: (health as any).composition,
      product: (health as any).product
    } : undefined
  };
}

function doctorGit(cwd: string) {
  try {
    const root = findRepositoryRoot(cwd);
    return {
      ok: true,
      root,
      headSha: readHeadSha(root)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function doctorSqlite(cwd: string) {
  const path = defaultLocalStorePath(cwd);
  return {
    path,
    exists: existsSync(path),
    migrations: productVersionManifest().runtime.sqliteMigrations
  };
}

function doctorPermissions(cwd: string) {
  const controlDir = dirname(defaultDaemonConnectionPath(cwd));
  return {
    workspace: pathAccess(cwd),
    controlDir: pathAccess(controlDir),
    sqlite: pathAccess(defaultLocalStorePath(cwd))
  };
}

function pathAccess(path: string) {
  const exists = existsSync(path);
  return {
    path,
    exists,
    readable: canAccess(path, constants.R_OK),
    writable: canAccess(path, constants.W_OK),
    private: exists ? isPrivatePath(path) : undefined
  };
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

function isPrivatePath(path: string): boolean {
  if (process.platform === "win32") return true;
  try {
    return (statSync(path).mode & 0o077) === 0;
  } catch {
    return false;
  }
}

async function createCliRuntime(cwd: string, deps: CliRuntimeDeps): Promise<RuntimeDaemonClient> {
  if (deps.runtimeClient) return deps.runtimeClient;
  if (!deps.disableRpcDiscovery && !hasEmbeddedRuntimeDeps(deps)) {
    const client = createRuntimeRpcClientFromConnectionFile(cwd);
    if (client) {
      const health = await client.health().catch(() => undefined);
      if ((health as any)?.ok === true) return client;
      recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
    } else {
      recoverStaleDaemonControlFiles(cwd);
    }
    const started = await startBackgroundDaemon([], cwd);
    if (!started.ok) throw new Error(started.error?.message ?? "archctxd did not start");
    const startedClient = createRuntimeRpcClientFromConnectionFile(cwd);
    if (startedClient) {
      const health = await startedClient.health().catch(() => undefined);
      if ((health as any)?.ok === true) return startedClient;
    }
    throw new Error("archctxd started but no healthy runtime RPC connection was available");
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
      const recovery = recoverStaleDaemonControlFiles(cwd);
      return okEnvelope("daemon.status", {
        running: false,
        protocol: "http-loopback",
        connectionPath: defaultDaemonConnectionPath(cwd),
        ...recoveryData(recovery)
      } as any);
    }
    const health = await client.health().catch(() => undefined);
    if ((health as any)?.ok === true) {
      return okEnvelope("daemon.status", {
        running: true,
        product: (health as any).product,
        rpcVersionCompatible: (health as any).schemaVersion === RUNTIME_RPC_VERSION,
        ...client.connectionInfo(),
        token: "stored-in-connection-file"
      } as any);
    }
    const recovery = recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true });
    return okEnvelope("daemon.status", {
      running: false,
      staleConnection: true,
      connectionPath: client.connectionInfo().connectionPath,
      ...recoveryData(recovery)
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
  const discovered = await discoverRunningDaemonInfo(cwd, { recoverStale: true });
  if (discovered.info) {
    return okEnvelope("daemon.start", {
      running: true,
      alreadyRunning: true,
      ...discovered.info,
      token: "stored-in-connection-file"
    } as any);
  }
  const recovery = discovered.recovery;

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
      token: "stored-in-connection-file",
      ...recoveryData(recovery)
    } as any);
  } finally {
    closeSync(logFd);
  }
}

async function runningDaemonInfo(cwd: string) {
  return (await discoverRunningDaemonInfo(cwd)).info;
}

async function discoverRunningDaemonInfo(cwd: string, options: { recoverStale?: boolean } = {}) {
  const client = createRuntimeRpcClientFromConnectionFile(cwd);
  if (!client) {
    return {
      info: undefined,
      recovery: options.recoverStale ? recoverStaleDaemonControlFiles(cwd) : emptyRecovery(cwd)
    };
  }
  const health = await client.health().catch(() => undefined);
  if ((health as any)?.ok === true) {
    return { info: client.connectionInfo(), recovery: emptyRecovery(cwd) };
  }
  return {
    info: undefined,
    recovery: options.recoverStale ? recoverStaleDaemonControlFiles(cwd, { removeUnhealthyConnection: true }) : emptyRecovery(cwd)
  };
}

function emptyRecovery(cwd: string) {
  return {
    connectionPath: defaultDaemonConnectionPath(cwd),
    lockPath: defaultDaemonLockPath(cwd),
    removed: []
  };
}

function recoveryData(recovery: { removed: string[] }) {
  return recovery.removed.length > 0 ? { recoveredStaleControlFiles: recovery.removed } : {};
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
  const daemon = await createStartedProductionDaemon({ root: cwd, localStorePath: defaultLocalStorePath(cwd) });
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
