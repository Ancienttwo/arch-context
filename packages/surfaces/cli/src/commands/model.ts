import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FailureError,
  NativeContextError,
  PATH_CONTEXT_SCHEMA_VERSION,
  errorEnvelope,
  isRepoRelativePosixPath,
  okEnvelope,
  toEnvelope,
  validateJsonSchema,
  type FailureEnvelope,
  type Json,
  type JsonEnvelope,
  type PathContextOutputV1,
  type ResolvePathResultV1
} from "@archcontext/contracts";
import {
  resolveArchitectureOwnerForPath,
  resolveArchitectureOwnersForPaths,
  type ResolveArchitectureOwnerResult
} from "@archcontext/core/architecture-domain";
import { exportMermaidModel, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { GitVisibleFilesUnavailableError } from "@archcontext/local-runtime/git-adapter";
import {
  runCodeGraphIndexSeed,
  runSyncCheckCommand,
  type RuntimeDaemonClient
} from "@archcontext/local-runtime/runtime-daemon";
import nodeSchema from "../../../../../schemas/repo/architecture-node.schema.json";
import { runArchitectureHistoryCommand } from "../architecture-history";
import {
  cliArgumentFailure,
  cliTaskText,
  collectMultiValueFlags,
  projectionWriterStrayToken,
  readFlag,
  readOptionalPositiveIntegerFlag,
  readRepeatedFlag
} from "../cli-flags";
import type { CliRuntimeDeps } from "../cli-types";
import { runNativeContextCommand } from "../native-context";

export async function runInitCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const modelOnly = args.includes("--model-only");
  return (await runtime()).init(cwd, readFlag(args, "--name") ?? "ArchContext Project", {
    infer: args.includes("--infer"),
    modelOnly,
    noHooks: modelOnly || args.includes("--no-hooks"),
    noSkills: modelOnly || args.includes("--no-skills"),
    noInstructions: modelOnly || args.includes("--no-instructions")
  });
}

export async function runSyncCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const noInstructions = args.includes("--no-instructions");
  if (args.includes("--check")) {
    return runSyncCheckCommand(cwd, { noInstructions });
  }
  return (await runtime()).sync(cwd, {
    changedPaths: readRepeatedFlag(args, "--changed"),
    noInstructions
  });
}

export async function runContextCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  if (args.includes("--path")) {
    if (args.includes("--landscape") || args.includes("--task") || args.includes("--name") || args.includes("--max-symbols")) {
      return cliArgumentFailure("context", "context --path cannot be combined with --task, --name, --max-symbols, or --landscape");
    }
    const { values, strayPositional } = collectMultiValueFlags(args, ["--path"], ["--task", "--name", "--max-symbols"]);
    if (strayPositional !== undefined) {
      return cliArgumentFailure("context", `context --path does not accept ${strayPositional}`);
    }
    const paths = [...new Set(values.get("--path") ?? [])];
    if (paths.length === 0) return cliArgumentFailure("context", "context --path requires at least one path");
    const badPath = paths.find((path) => !isRepoRelativePosixPath(path));
    if (badPath !== undefined) {
      return cliArgumentFailure("context", `context --path must be a repository-relative POSIX path: ${badPath}`);
    }
    const model = loadResolveModel(cwd);
    const outcomes = resolveArchitectureOwnersForPaths(model.nodes, paths);
    const owners: ResolvePathResultV1[] = outcomes.map((outcome, index) => resolveResultData(paths[index]!, outcome) as ResolvePathResultV1);
    const touchedIds = new Set<string>();
    for (const outcome of outcomes) {
      if (outcome.status === "matched") touchedIds.add(outcome.node.id);
      else if (outcome.status === "ambiguous") {
        for (const candidate of outcome.candidates) touchedIds.add(candidate.id);
      }
      if (outcome.owningCapabilityId) touchedIds.add(outcome.owningCapabilityId);
    }
    const nodes = model.nodes.filter((node) => touchedIds.has(node.id)) as unknown as Record<string, Json>[];
    const relations = model.relations.filter((rel) => touchedIds.has(rel.source) || touchedIds.has(rel.target)) as unknown as Record<string, Json>[];
    const payload: PathContextOutputV1 = {
      schemaVersion: PATH_CONTEXT_SCHEMA_VERSION,
      paths,
      owners,
      nodes,
      relations
    };
    return okEnvelope("context", payload as unknown as Json);
  }
  const taskText = cliTaskText("context", args);
  if (!taskText.ok) return taskText.envelope;
  const task = taskText.task;
  const daemon = await runtime();
  if (args.includes("--landscape")) {
    await daemon.repoAdd(cwd, readFlag(args, "--name") ?? "local");
    return daemon.contextLandscape(task, Number(readFlag(args, "--max-symbols") ?? 12));
  }
  return daemon.context(cwd, task, Number(readFlag(args, "--max-symbols") ?? 12));
}

export async function runModelCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === "validate") return (await runtime()).validate(cwd);
  if (subcommand === "resolve") return runResolveCommand(rest, cwd, deps);
  if (subcommand === "export") {
    if (rest[0] === "native") return runNativeContextCommand(rest.slice(1), cwd);
    return runExportCommand(rest, cwd);
  }
  if (subcommand === "history") return runArchitectureHistoryCommand(rest, cwd);
  if (subcommand === "show") {
    const stray = projectionWriterStrayToken(rest, ["--id"]);
    if (stray !== undefined) return cliArgumentFailure("model.show", `model show does not accept ${stray}; use --help`);
    const id = readFlag(rest, "--id");
    const model = loadResolveModel(cwd);
    if (id !== undefined) {
      const node = model.nodes.find((candidate) => candidate.id === id);
      if (!node) return cliArgumentFailure("model.show", `Unknown model node id: ${id}`);
      return okEnvelope("model.show", {
        schemaVersion: "archcontext.model-show/v1",
        node: node as unknown as Json,
        outgoingRelations: model.relations.filter((rel) => rel.source === id) as unknown as Json,
        incomingRelations: model.relations.filter((rel) => rel.target === id) as unknown as Json
      });
    }
    return okEnvelope("model.show", {
      schemaVersion: "archcontext.model-show/v1",
      nodeCount: model.nodes.length,
      relationCount: model.relations.length,
      nodes: model.nodes.map((node) => ({ id: node.id, kind: node.kind, name: node.name, status: node.status })) as unknown as Json
    });
  }
  return errorEnvelope("model", "AC_SCHEMA_INVALID", "model requires validate|resolve|export|history|show");
}

export function runExportCommand(args: string[], cwd: string): JsonEnvelope {
  const format = args[0] ?? readFlag(args, "--format") ?? "mermaid";
  const model = loadNativeModelFromArchContext(cwd);
  const result = format === "mermaid" ? exportMermaidModel(model) : undefined;
  if (!result) return errorEnvelope("export", "AC_SCHEMA_INVALID", "export requires native or mermaid");
  return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "export", data: result as unknown as Json };
}

export async function runResolveCommand(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<JsonEnvelope> {
  if (args.includes("--path") && args.includes("--paths-from")) {
    return cliArgumentFailure("resolve", "resolve accepts exactly one of --path or --paths-from");
  }
  if (args.includes("--paths-from")) {
    const read = await readResolvePathsFrom(args, cwd, deps);
    if ("problem" in read) return cliArgumentFailure("resolve", read.problem);
    const model = loadResolveModel(cwd);
    const outcomes = resolveArchitectureOwnersForPaths(model.nodes, read.paths);
    return okEnvelope("resolve", { results: outcomes.map((outcome, index) => resolveResultData(read.paths[index]!, outcome)) } as unknown as Json);
  }
  const path = readFlag(args, "--path");
  if (!path) return cliArgumentFailure("resolve", "resolve requires --path or --paths-from");
  if (!isRepoRelativePosixPath(path)) {
    return cliArgumentFailure("resolve", "resolve --path must be a repository-relative POSIX path");
  }
  const model = loadResolveModel(cwd);
  return okEnvelope("resolve", resolveResultData(path, resolveArchitectureOwnerForPath(model.nodes, path)) as unknown as Json);
}

/**
 * ADR-0043: `archctx resolve --path` exit codes are 0=matched, 1=no-match, 2=ambiguous.
 * `archctx resolve --paths-from` exits 2 when any path is ambiguous and 0 otherwise.
 */
export function resolveCommandExitCode(result: { ok?: boolean; data?: unknown }): number {
  if (!result || result.ok !== true) return 1;
  const data = result.data as { matched?: boolean; ambiguous?: boolean; results?: { ambiguous?: boolean }[] } | undefined;
  if (Array.isArray(data?.results)) return data.results.some((entry) => entry.ambiguous === true) ? 2 : 0;
  if (data?.matched === true) return 0;
  if (data?.ambiguous === true) return 2;
  return 1;
}

export async function runIndexCommand(args: string[], cwd: string): Promise<JsonEnvelope | FailureEnvelope> {
  const subcommand = args[0];
  if (subcommand !== "seed") {
    return errorEnvelope("index", "AC_SCHEMA_INVALID", "index requires seed [--timeout-ms <ms>] [--json]");
  }
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--timeout-ms" || token === "--format") { index += 1; continue; }
    if (token === "--json") continue;
    return errorEnvelope("index.seed", "AC_SCHEMA_INVALID", `index seed does not accept ${token}; use --help`);
  }
  const timeout = readOptionalPositiveIntegerFlag(args.slice(1), "--timeout-ms", "index.seed");
  if (!timeout.ok) return timeout.envelope;
  try {
    const result = await runCodeGraphIndexSeed(cwd, { timeoutMs: timeout.value });
    return okEnvelope("index.seed", result as unknown as Json);
  } catch (error) {
    if (error instanceof GitVisibleFilesUnavailableError) {
      return errorEnvelope("index.seed", error.code, error.message, error.reasonCode);
    }
    if (error instanceof FailureError) {
      return toEnvelope("index.seed", error, "cli");
    }
    throw error;
  }
}

/** Validate the same core node schema as native export, without its profile or document reads. */
export function loadResolveModel(cwd: string) {
  if (!existsSync(join(cwd, ".archcontext/manifest.yaml"))) {
    throw new NativeContextError("native-context-model-missing", { path: ".archcontext/manifest.yaml" });
  }
  let model: ReturnType<typeof loadNativeModelFromArchContext>;
  try {
    model = loadNativeModelFromArchContext(cwd);
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (typeof cause?.code === "string") {
      throw new NativeContextError("native-context-input-unreadable", {
        category: "open-or-read",
        ...(typeof cause.path === "string" ? { path: cause.path } : {})
      });
    }
    throw new NativeContextError("native-context-model-invalid", { invariant: "model-parse" });
  }
  if (model.nodes.length === 0) {
    throw new NativeContextError("native-context-model-missing", { category: "no-native-nodes" });
  }
  for (const node of model.nodes) {
    const { issues } = validateJsonSchema(nodeSchema, node as unknown as Json);
    if (issues.length > 0) {
      throw new NativeContextError("native-context-model-invalid", {
        issues: issues.slice(0, 32).map((issue) => ({ entityId: typeof node.id === "string" ? node.id : "(undeclared)", field: issue.path, invariant: issue.message })),
        omittedDiagnosticCount: Math.max(0, issues.length - 32)
      });
    }
  }
  return model;
}

function resolveResultData(path: string, outcome: ResolveArchitectureOwnerResult): Record<string, Json> {
  if (outcome.status === "matched") {
    const node = outcome.node;
    return {
      path,
      matched: true,
      ambiguous: false,
      stableId: node.id,
      kind: node.kind,
      name: node.name,
      owningCapabilityId: outcome.owningCapabilityId,
      ...(node.source ? { source: node.source } : {}),
      ...(node.extensions ? { extensions: node.extensions } : {})
    };
  }
  if (outcome.status === "ambiguous") {
    return { path, matched: false, ambiguous: true, candidates: outcome.candidates.map((node) => node.id), owningCapabilityId: outcome.owningCapabilityId };
  }
  return { path, matched: false, ambiguous: false, owningCapabilityId: null };
}

/** `resolve --paths-from <file>` or `--paths-from -` (stdin): one path per line, blank lines ignored. */
async function readResolvePathsFrom(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<{ paths: string[] } | { problem: string }> {
  const source = readFlag(args, "--paths-from");
  if (source === undefined || source.startsWith("--")) return { problem: "resolve --paths-from requires a file path or - for stdin" };
  let content: string;
  try {
    content = source === "-"
      ? await (deps.readStdin ? deps.readStdin() : readFileSync(0, "utf8"))
      : readFileSync(resolve(cwd, source), "utf8");
  } catch (error) {
    return { problem: `resolve --paths-from ${source} is not readable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const paths: string[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    const path = line.trim();
    if (path === "") continue;
    if (!isRepoRelativePosixPath(path)) return { problem: `resolve --paths-from line ${index + 1} must be a repository-relative POSIX path: ${path}` };
    paths.push(path);
  }
  return { paths };
}
