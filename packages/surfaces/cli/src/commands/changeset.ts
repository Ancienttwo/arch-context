import { existsSync, readFileSync, statSync } from "node:fs";
import {
  digestJson,
  errorEnvelope,
  isRepoRelativePosixPath,
  okEnvelope,
  validateJsonSchema,
  type Json
} from "@archcontext/contracts";
import { assertPathHasNoSymlinkSegments, planManifestFieldsOperation, PLAN_OPERATIONS_SCHEMA, type ChangeOperation } from "@archcontext/core/changeset-engine";
import { assertAllowedArchContextPath } from "@archcontext/core/policy-engine";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { readFlag, requireFlag } from "../cli-flags";
import type { CliRuntimeDeps } from "../cli-types";

const CLI_PLAN_ENTITY_FLAGS = ["--op", "--path", "--expected-hash", "--body", "--body-file"] as const;

export async function runPlanCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>, deps: CliRuntimeDeps) {
  const operations = await readCliPlanOperations(args, cwd, deps);
  if (typeof operations === "string") return errorEnvelope("plan", "AC_SCHEMA_INVALID", operations);
  return (await runtime()).planUpdate(cwd, {
    id: readFlag(args, "--id") ?? "changeset.cli",
    operations
  });
}

export async function runApplyCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  return (await runtime()).applyUpdate(cwd, {
    id: readFlag(args, "--id") ?? "changeset.cli",
    approved: args.includes("--approved"),
    expectedWorktreeDigest: requireFlag(args, "--expected-worktree-digest")
  });
}

export async function runManifestPlanCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  if (args[0] !== "plan") return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest requires plan; use --help");
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]!;
    if (!["--id", "--decisions", "--layers"].includes(flag) || seen.has(flag) || !args[index + 1] || args[index + 1]!.startsWith("--")) {
      return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest plan accepts one --id and optional --decisions / --layers values only");
    }
    seen.add(flag);
  }
  const id = requireFlag(args, "--id");
  const decisions = readFlag(args, "--decisions");
  const layerValue = readFlag(args, "--layers");
  const layers = layerValue?.split(",");
  if (decisions === undefined && layers === undefined) return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "manifest plan requires --decisions or --layers");
  if (layers && (layers.length === 0 || new Set(layers).size !== layers.length || layers.some((layer) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(layer)))) {
    return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "--layers must be a comma-separated unique ordered list of layer slugs");
  }
  if (decisions !== undefined && decisions !== "docs/adr") {
    return errorEnvelope("manifest", "AC_SCHEMA_INVALID", "content.decisions supports only docs/adr");
  }
  const root = findRepositoryRoot(cwd);
  const operation = planManifestFieldsOperation(root, {
    ...(decisions === undefined ? {} : { "content.decisions": decisions }),
    ...(layers === undefined ? {} : { "model.layers": layers })
  });
  return (await runtime()).planUpdate(root, { id, operations: [operation] });
}

/**
 * `archctx hash`: prints the expected hash of one existing file exactly as the ChangeSet precondition
 * computes it (`digestJson({ body })`), under the same path boundary a write would face.
 */
export function runHashCommand(args: string[], cwd: string) {
  const path = readFlag(args, "--path");
  if (!path) return errorEnvelope("hash", "AC_SCHEMA_INVALID", "hash requires --path");
  if (!isRepoRelativePosixPath(path)) return errorEnvelope("hash", "AC_SCHEMA_INVALID", "hash --path must be a repository-relative POSIX path");
  let absolute: string;
  try {
    assertHashPathAllowed(cwd, path);
    absolute = assertPathHasNoSymlinkSegments(cwd, path);
  } catch (error) {
    return errorEnvelope("hash", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return errorEnvelope("hash", "AC_SCHEMA_INVALID", `hash --path is not an existing file: ${path}`);
  }
  return okEnvelope("hash", { path, hash: digestJson({ body: readFileSync(absolute, "utf8") }) } as unknown as Json);
}

function assertHashPathAllowed(cwd: string, path: string): void {
  const agentContextPaths: ReadonlySet<string> = new Set();
  try {
    assertAllowedArchContextPath(cwd, path);
  } catch (error) {
    for (const operation of ["manifest", "adr-reference"] as const) {
      try {
        assertAllowedArchContextPath(cwd, path, { operation, agentContextPaths });
        return;
      } catch { /* try the next scope */ }
    }
    throw error;
  }
}

function readRepositoryInputFile(cwd: string, flag: string, file: string): { content: string } | { problem: string } {
  if (!isRepoRelativePosixPath(file)) return { problem: `plan ${flag} must be a repository-relative POSIX path inside the repository; use --body - to read stdin` };
  try {
    const absolute = assertPathHasNoSymlinkSegments(cwd, file);
    if (!statSync(absolute).isFile()) return { problem: `plan ${flag} ${file} is not a regular file` };
    return { content: readFileSync(absolute, "utf8") };
  } catch (error) {
    return { problem: `plan ${flag} ${file} is not readable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function readCliPlanOperations(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<ChangeOperation[] | string> {
  if (args.includes("--operations-file")) {
    const conflicts = CLI_PLAN_ENTITY_FLAGS.filter((flag) => args.includes(flag));
    if (conflicts.length > 0) return `plan --operations-file cannot be combined with ${conflicts.join(", ")}`;
    const file = readFlag(args, "--operations-file");
    if (!file) return "plan --operations-file requires a path";
    const read = file === "-"
      ? { content: await (deps.readStdin ? deps.readStdin() : readFileSync(0, "utf8")) }
      : readRepositoryInputFile(cwd, "--operations-file", file);
    if ("problem" in read) return read.problem;
    let parsed: Json;
    try {
      parsed = JSON.parse(read.content) as Json;
    } catch (error) {
      return `plan --operations-file ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
    const validation = validateJsonSchema(PLAN_OPERATIONS_SCHEMA, parsed);
    if (!validation.valid) return `plan --operations-file ${file} is not a valid operations array: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`;
    return parsed as unknown as ChangeOperation[];
  }
  const operation = await readCliEntityOperation(args, cwd, deps);
  return typeof operation === "string" ? operation : [operation];
}

async function readCliEntityOperation(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<ChangeOperation | string> {
  const CLI_ENTITY_OPERATIONS = ["create_entity", "update_entity_fields", "delete_entity"] as const;
  const requested = readFlag(args, "--op") ?? "create_entity";
  const op = CLI_ENTITY_OPERATIONS.find((candidate) => candidate === requested);
  if (!op) return `plan --op must be one of ${CLI_ENTITY_OPERATIONS.join("|")}`;
  const path = readFlag(args, "--path");
  if (!path) return "plan requires --path";
  const expectedHash = readFlag(args, "--expected-hash");
  const body = await readCliPlanBody(args, cwd, deps);
  if (typeof body === "object") return body.problem;
  if (op === "create_entity") return { op, path, expectedHash: expectedHash ?? "missing", body: body ?? "" };
  if (!expectedHash || !/^sha256:[a-f0-9]{64}$/.test(expectedHash)) return `plan --op ${op} requires --expected-hash sha256:<64-hex> of the current file`;
  if (op === "delete_entity") {
    if (body !== undefined) return "plan --op delete_entity does not accept --body or --body-file";
    return { op, path, expectedHash };
  }
  if (body === undefined) return "plan --op update_entity_fields requires --body, --body - or --body-file with the complete YAML document";
  return { op, path, expectedHash, body };
}

async function readCliPlanBody(args: string[], cwd: string, deps: CliRuntimeDeps): Promise<string | undefined | { problem: string }> {
  const hasBody = args.includes("--body");
  const hasBodyFile = args.includes("--body-file");
  if (hasBody && hasBodyFile) return { problem: "plan accepts exactly one body source: --body, --body - or --body-file" };
  if (hasBodyFile) {
    const file = readFlag(args, "--body-file");
    if (!file) return { problem: "plan --body-file requires a path" };
    const read = readRepositoryInputFile(cwd, "--body-file", file);
    return "problem" in read ? read : read.content;
  }
  if (!hasBody) return undefined;
  const inline = readFlag(args, "--body");
  if (inline === undefined) return { problem: "plan --body requires a value (use - to read stdin)" };
  if (inline !== "-") return inline;
  return deps.readStdin ? deps.readStdin() : readFileSync(0, "utf8");
}
