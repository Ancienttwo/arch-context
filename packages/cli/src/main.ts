#!/usr/bin/env bun
import { errorEnvelope } from "../../contracts/src/index";
import { computeWorktreeDigest } from "../../architecture-domain/src/index";
import { CodeGraphAdapter, MockCodeGraphProvider } from "../../codegraph-adapter/src/index";
import { YamlModelStore } from "../../model-store-yaml/src/index";
import { applyArchitectureUpdate, checkpoint, completeTask, planArchitectureUpdate, prepareTask } from "../../application/src/index";
import { dependencyAudit, diagnostics, installMarker, secretScan, uninstallMarker } from "../../hardening/src/index";
import { createStartedDaemon } from "../../runtime-daemon/src/index";
import { exportLikeC4Model, importLikeC4InitialModel } from "../../adapter-likec4/src/index";
import { exportStructurizrWorkspace, importStructurizrInitialModel } from "../../adapter-structurizr/src/index";
import { exportMermaidModel, loadNativeModelFromArchContext } from "../../renderer/src/index";

const [, , command, ...args] = process.argv;

if (import.meta.main) {
  const result = await runCli(command, args, process.cwd()).catch((error) =>
    errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error))
  );
  process.stdout.write(`${renderResult(result, readFlag(args, "--format") ?? "json")}\n`);
}

export async function runCli(command = "help", args: string[] = [], cwd: string) {
  const daemon = await createStartedDaemon();
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
    case "prepare": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("prepare", "AC_SCHEMA_INVALID", "prepare requires --task or task text");
      const result = await prepareTask({
        workspace: { root: cwd, repositoryId: "repo.local", headSha: "local" },
        task,
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        modelStore: new YamlModelStore(),
        budget: {
          maxBytes: Number(readFlag(args, "--max-bytes") ?? 12288),
          maxItems: Number(readFlag(args, "--max-items") ?? 12)
        }
      });
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "prepare", data: paginate(result as any, args) };
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
          headSha: readFlag(args, "--head-sha") ?? "local",
          currentHeadSha: readFlag(args, "--current-head-sha") ?? readFlag(args, "--head-sha") ?? "local",
          worktreeDigest: readFlag(args, "--worktree-digest") ?? computeWorktreeDigest(cwd),
          modelDigest: readFlag(args, "--model-digest") ?? "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          codeFactsDigest: readFlag(args, "--codefacts-digest") ?? "sha256:1111111111111111111111111111111111111111111111111111111111111111"
        } as any)
      };
    case "plan": {
      const path = readFlag(args, "--path");
      if (!path) return errorEnvelope("plan", "AC_SCHEMA_INVALID", "plan requires --path");
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "plan",
        data: planArchitectureUpdate({
          id: readFlag(args, "--id") ?? "changeset.cli",
          operations: [{ op: "create_entity", path, expectedHash: readFlag(args, "--expected-hash") ?? "missing", body: readFlag(args, "--body") ?? "" }]
        }) as any
      };
    }
    case "apply": {
      const path = readFlag(args, "--path");
      if (!path) return errorEnvelope("apply", "AC_SCHEMA_INVALID", "apply requires --path");
      const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest") ?? computeWorktreeDigest(cwd);
      const result = await applyArchitectureUpdate(cwd, {
        id: readFlag(args, "--id") ?? "changeset.cli",
        approved: args.includes("--approved"),
        expectedWorktreeDigest,
        operations: [{ op: "create_entity", path, expectedHash: readFlag(args, "--expected-hash") ?? "missing", body: readFlag(args, "--body") ?? "" }]
      });
      return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "apply", data: result as any };
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
          commands: ["init", "sync", "validate", "context", "status", "repo", "landscape", "prepare", "checkpoint", "plan", "apply", "complete", "config", "mcp", "install", "uninstall", "doctor", "privacy-audit", "export", "import", "tunnel"],
          examples: ["archctx init --name MyApp", "archctx export likec4", "archctx import structurizr --content '<json>'", "archctx tunnel"]
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

function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}
