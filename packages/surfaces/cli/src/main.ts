#!/usr/bin/env bun
import { errorEnvelope } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { checkpoint, completeTask } from "@archcontext/core/application";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "@archcontext/cloud/hardening";
import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon, type RuntimeDeps } from "@archcontext/local-runtime/runtime-daemon";
import { exportLikeC4Model, importLikeC4InitialModel } from "@archcontext/surfaces/adapter-likec4";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "@archcontext/surfaces/adapter-structurizr";
import { exportMermaidModel, loadNativeModelFromArchContext } from "@archcontext/surfaces/renderer";

const [, , command, ...args] = process.argv;

if (import.meta.main) {
  const result = await runCli(command, args, process.cwd()).catch((error) =>
    errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error))
  );
  process.stdout.write(`${renderResult(result, readFlag(args, "--format") ?? "json")}\n`);
}

export async function runCli(command = "help", args: string[] = [], cwd: string, deps: RuntimeDeps = {}) {
  const daemon = await createStartedDaemon({ localStorePath: defaultLocalStorePath(cwd), ...deps });
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
          commands: ["init", "sync", "validate", "context", "status", "repo", "landscape", "explore", "prepare", "checkpoint", "plan", "apply", "complete", "config", "mcp", "install", "uninstall", "doctor", "privacy-audit", "export", "import", "tunnel"],
          examples: ["archctx init --name MyApp", "archctx explore start --foreground", "archctx export likec4", "archctx import structurizr --content '<json>'", "archctx tunnel"]
        }
      };
  }
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
