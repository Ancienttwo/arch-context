import { posix } from "node:path";
import {
  ARCHITECTURE_MAJOR_CHANGE_REASON_CODES,
  CALLER_PROVIDED_ATTESTATION_FIELDS,
  EXPLORER_VIEW_IDS,
  errorEnvelope,
  isRepoRelativePosixPath,
  knownFailure,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureMajorChangeReasonCode,
  type ExplorerProjectionQueryV2,
  type JsonEnvelope,
  type RefactorRequestV1
} from "@archcontext/contracts";
import { REPO_HARNESS_PROJECTION_PROFILE, type ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import { CLI_COMMAND_FLAGS, GLOBAL_BOOLEAN_FLAGS, GLOBAL_VALUE_FLAGS, type CliFlagSpec } from "./cli-flag-table";
import { cliHelpEnvelope } from "./cli-help";
import type { AgentHost } from "./cli-types";

export { CLI_COMMAND_FLAGS, GLOBAL_BOOLEAN_FLAGS, GLOBAL_VALUE_FLAGS, type CliFlagSpec };

export class RefactorFlagError extends Error {}

/** A CLI argument error. The process entry reports it as AC_SCHEMA_INVALID, not as a runtime outage. */
export class CliUsageError extends Error {}

export function cliTaskText(command: "context" | "prepare", args: string[]): { ok: true; task: string } | { ok: false; envelope: JsonEnvelope } {
  const task = readFlag(args, "--task");
  if (task !== undefined) return { ok: true, task };
  if (args.some(isCliFlagToken)) {
    return { ok: false, envelope: errorEnvelope(command, "AC_SCHEMA_INVALID", `${command} takes options only together with --task <text>; bare task text cannot contain options`) };
  }
  const text = args.join(" ").trim();
  if (!text) return { ok: false, envelope: errorEnvelope(command, "AC_SCHEMA_INVALID", `${command} requires --task or task text`) };
  return { ok: true, task: text };
}

/** `--x`, `-x` or `--x=y`; `-`, `---`, `-1` and `- item` are values. */
export function isCliFlagToken(token: string): boolean {
  return /^--?[A-Za-z]/.test(token);
}

/**
 * The one argument check every command passes before its handler (#322): help is answered here,
 * daemon-owned review fields and unknown flags are rejected here (#182).
 */
export function preflightCliArguments(command: string, args: string[]): JsonEnvelope | undefined {
  const spec = CLI_COMMAND_FLAGS[command];
  if (!spec) return undefined;
  if (args.includes("--help") || args.includes("-h")) return cliHelpEnvelope(command, args);
  if (command === "review" || command === "complete") {
    const forbidden = readForbiddenAttestationFlags(args);
    if (forbidden.length > 0) {
      return errorEnvelope(command, "AC_SCHEMA_INVALID", `Review attestation fields are daemon-owned and cannot be provided by CLI flags: ${forbidden.join(",")}`);
    }
  }
  const subcommand = args[0] !== undefined && !isCliFlagToken(args[0]) ? args[0] : undefined;
  const flags = (subcommand === undefined ? undefined : spec.subcommands?.[subcommand]) ?? spec;
  const valueFlags = [...flags.value, ...GLOBAL_VALUE_FLAGS];
  const booleanFlags = [...flags.boolean, ...GLOBAL_BOOLEAN_FLAGS];
  const name = flags === spec ? command : `${command} ${subcommand}`;
  const requestId = flags === spec ? command : `${command}.${subcommand}`;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!isCliFlagToken(token)) {
      if ((command === "checkpoint" || (command === "hook" && subcommand === "checkpoint"))
        && !(command === "hook" && index === 0)) {
        return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${name} takes named options only`);
      }
      continue;
    }
    if (booleanFlags.includes(token)) continue;
    if (valueFlags.includes(token)) {
      const value = args[index + 1];
      if (value === undefined || isCliFlagToken(value)) return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${name} requires a value for ${token}`);
      index += 1;
      continue;
    }
    return errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${name} does not recognize the flag ${token}`);
  }
  return undefined;
}

export function projectionWriterStrayToken(args: string[], valueFlags: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (valueFlags.includes(token) || token === "--format") { index += 1; continue; }
    if (isCliFlagToken(token)) continue;
    return token;
  }
  return undefined;
}

export function isCheckInvocation(args: string[], booleanFlags: readonly string[] = []): boolean {
  const formatAt = args.indexOf("--format");
  const unexpected = args.slice(1).filter((arg, index) => arg !== "--json" && !booleanFlags.includes(arg) && (formatAt < 0 || (index + 1 !== formatAt && index !== formatAt)));
  return args[0] === "check" && unexpected.length === 0;
}

export function acceptedArchitectureChange(args: string[]): AcceptedArchitectureChangeReferenceV1 | undefined {
  const changeSetId = readFlag(args, "--accepted-change-set-id");
  const eventId = readFlag(args, "--accepted-event-id");
  const reasonCodes = readRepeatedFlag(args, "--major-reason")
    .flatMap((value) => value.split(","))
    .filter((value) => value !== "")
    .sort() as ArchitectureMajorChangeReasonCode[];
  const affectedNodeIds = readRepeatedFlag(args, "--affected-node")
    .flatMap((value) => value.split(","))
    .filter((value) => value !== "")
    .sort();
  if (!changeSetId && !eventId && reasonCodes.length === 0 && affectedNodeIds.length === 0) return undefined;
  if (!changeSetId || !eventId || reasonCodes.length === 0 || affectedNodeIds.length === 0) {
    throw new Error("architecture-major-change-accepted-reference-incomplete");
  }
  const allowed = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
  const unsupported = reasonCodes.find((reason) => !allowed.has(reason));
  if (unsupported) throw new Error(`architecture-major-change-reason-unsupported: ${unsupported}`);
  return {
    changeSetId,
    eventId,
    reasonCodes: [...new Set(reasonCodes)],
    affectedNodeIds: [...new Set(affectedNodeIds)]
  };
}

export function architectureProjectionProfile(args: string[]): ArchitectureProjectionProfile | undefined {
  const profile = readFlag(args, "--profile");
  if (profile === undefined) return undefined;
  if (profile !== "default" && profile !== REPO_HARNESS_PROJECTION_PROFILE) {
    throw new Error(`architecture-docs-profile-unsupported: ${profile}`);
  }
  return profile;
}

export function cliArgumentFailure(requestId: string, message: string): JsonEnvelope {
  return {
    schemaVersion: "archcontext.envelope/v1",
    ok: false,
    requestId,
    error: { ...knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"), message }
  };
}

export function readOptionalPositiveIntegerFlag(args: string[], flag: string, requestId: string):
  | { ok: true; value?: number }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const raw = readFlag(args, flag);
  if (raw === undefined) return { ok: true };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${flag} must be a positive integer`) };
  }
  return { ok: true, value };
}

export function readOptionalNonNegativeIntegerFlag(args: string[], flag: string, requestId: string):
  | { ok: true; value?: number }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const raw = readFlag(args, flag);
  if (raw === undefined) return { ok: true };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, envelope: errorEnvelope(requestId, "AC_SCHEMA_INVALID", `${flag} must be a non-negative integer`) };
  }
  return { ok: true, value };
}

export function readAgentHost(args: string[]): AgentHost | undefined {
  const host = readFlag(args, "--host") ?? "generic";
  return host === "codex" || host === "claude" || host === "generic" ? host : undefined;
}

export function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function requireFlag(args: string[], flag: string): string {
  const value = readFlag(args, flag);
  if (!value) throw new CliUsageError(`${flag} is required`);
  return value;
}

export function readForbiddenAttestationFlags(args: string[]): string[] {
  return CALLER_PROVIDED_ATTESTATION_FIELDS
    .map((field) => `--${field.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`)
    .filter((flag) => args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`)));
}

export function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]!);
  }
  return values;
}

/**
 * Collects values supplied as `--flag v1 --flag v2` or variadic `--flag v1 v2` before the next flag,
 * and identifies any stray positional arguments outside multi-value flag runs.
 */
export function collectMultiValueFlags(args: string[], multiFlags: readonly string[], singleValueFlags: readonly string[]): {
  values: Map<string, string[]>;
  strayPositional?: string;
} {
  const values = new Map<string, string[]>();
  for (const flag of multiFlags) values.set(flag, []);
  let activeMultiFlag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (multiFlags.includes(token)) {
      activeMultiFlag = token;
      const next = args[index + 1];
      if (next !== undefined && !isCliFlagToken(next)) {
        values.get(token)!.push(next);
        index += 1;
      }
      continue;
    }
    if (singleValueFlags.includes(token) || token === "--format") {
      activeMultiFlag = undefined;
      index += 1;
      continue;
    }
    if (isCliFlagToken(token)) {
      activeMultiFlag = undefined;
      continue;
    }
    if (activeMultiFlag !== undefined) {
      values.get(activeMultiFlag)!.push(token);
      continue;
    }
    return { values, strayPositional: token };
  }
  return { values };
}

export function importNodeLimitValue(raw: string): number | undefined {
  return /^[0-9]+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined;
}

export function refactorFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return refactorFlagValueAt(args, index, flag);
}

function refactorFlagValueAt(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new RefactorFlagError(`refactor ${flag} requires a value`);
  return value;
}

export function refactorScanScopeFlags(args: string[], raw: string | undefined): RefactorRequestV1["scope"] {
  const nodeId = refactorFlagValue(args, "--node");
  const paths = args.flatMap((arg, index) => arg === "--path" ? [refactorFlagValueAt(args, index, arg)] : []);
  if (args.lastIndexOf("--node") !== args.indexOf("--node")
    || (nodeId !== undefined && paths.length > 0)
    || (raw !== undefined && (nodeId !== undefined || paths.length > 0))) {
    throw new RefactorFlagError("refactor scan accepts one --node, repeatable --path, or --request-json");
  }
  if (nodeId !== undefined) return { kind: "node", nodeId };
  if (paths.length === 0) return { kind: "repository" };
  if (paths.some((path) => !isRepoRelativePosixPath(path) || !path.trim() || /^[A-Za-z]:/.test(path) || posix.normalize(path) === ".")) {
    throw new RefactorFlagError("refactor scan --path requires a repo-relative file path");
  }
  return { kind: "paths", paths: [...new Set(paths.map((path) => posix.normalize(path).replace(/\/$/, "")))].sort() };
}

export function paginate(value: any, args: string[]) {
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

export function explorerProjectionQueryV2FromCli(args: string[]): ExplorerProjectionQueryV2 {
  const expectedHeadSha = readFlag(args, "--expected-head-sha");
  const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
  const expectedGraphDigest = readFlag(args, "--expected-graph-digest");
  const expectedObservedFactsDigest = readFlag(args, "--expected-observed-facts-digest");
  const expectedRequired = [expectedHeadSha, expectedWorktreeDigest, expectedGraphDigest];
  if (expectedRequired.some(Boolean) && !expectedRequired.every(Boolean)) {
    throw new CliUsageError("--expected-head-sha, --expected-worktree-digest, and --expected-graph-digest must be provided together");
  }
  const viewId = readFlag(args, "--view") ?? "system-map";
  if (!(EXPLORER_VIEW_IDS as readonly string[]).includes(viewId)) throw new CliUsageError(`unsupported Explorer view: ${viewId}`);
  return {
    schemaVersion: "archcontext.explorer-projection-query/v2",
    viewId: viewId as ExplorerProjectionQueryV2["viewId"],
    semanticLevel: (readFlag(args, "--level") ?? "context") as NonNullable<ExplorerProjectionQueryV2["semanticLevel"]>,
    ...(readFlag(args, "--task-session-id") ? { taskSessionId: readFlag(args, "--task-session-id")! } : {}),
    ...(expectedRequired.every(Boolean) ? {
      expectedCursor: {
        headSha: expectedHeadSha!,
        worktreeDigest: expectedWorktreeDigest!,
        graphDigest: expectedGraphDigest!,
        ...(expectedObservedFactsDigest ? { observedFactsDigest: expectedObservedFactsDigest } : {})
      }
    } : {}),
    ...(readFlag(args, "--focus") ? { focus: { subjectId: readFlag(args, "--focus")! } } : {}),
    expandedOccurrenceIds: readRepeatedFlag(args, "--expand"),
    depth: Number(readFlag(args, "--depth") ?? 1) as 0 | 1 | 2,
    budget: {
      maxNodes: Number(readFlag(args, "--max-nodes") ?? 80),
      maxRelations: Number(readFlag(args, "--max-relations") ?? 160)
    }
  };
}
