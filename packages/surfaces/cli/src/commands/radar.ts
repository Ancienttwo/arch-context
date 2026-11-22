import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  errorEnvelope,
  isRepoRelativePosixPath,
  okEnvelope,
  type Json,
  type RefactorScopeV1,
  type RefactorSimulationMoveV1,
  type RefactorSimulationRequestV1
} from "@archcontext/contracts";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import {
  runDecideV2,
  runRefactorSimulate,
  runScanV2,
  runVerifyV2,
  type V2DecideAction
} from "@archcontext/local-runtime/runtime-daemon";
import { importNodeLimitValue, readFlag, readRepeatedFlag } from "../cli-flags";

const VALID_DECIDE_ACTIONS = new Set<V2DecideAction>([
  "list",
  "show",
  "accept",
  "defer",
  "reject",
  "waive",
  "acknowledge",
  "resolve"
]);

function parseOptionalImportLimit(args: string[], surface: string): { ok: true; value?: number } | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  if (!args.includes("--import-node-limit")) return { ok: true };
  const parsed = importNodeLimitValue(readFlag(args, "--import-node-limit") ?? "");
  if (parsed === undefined) {
    return {
      ok: false,
      envelope: errorEnvelope(surface, "AC_SCHEMA_INVALID", `${surface} --import-node-limit must be a positive integer`)
    };
  }
  return { ok: true, value: parsed };
}

function parseScanScope(args: string[]): { ok: true; scope: RefactorScopeV1 } | { ok: false; envelope: ReturnType<typeof errorEnvelope> } {
  const scopeKind = readFlag(args, "--scope");
  const nodeId = readFlag(args, "--node");
  const pathList = [
    ...readRepeatedFlag(args, "--path"),
    ...(readFlag(args, "--paths")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])
  ];
  if (nodeId && pathList.length > 0) {
    return { ok: false, envelope: errorEnvelope("scan", "AC_SCHEMA_INVALID", "scan cannot combine --node and --path/--paths") };
  }
  if (scopeKind === "node" || (nodeId !== undefined && scopeKind === undefined)) {
    if (!nodeId || nodeId.trim() === "") {
      return { ok: false, envelope: errorEnvelope("scan", "AC_SCHEMA_INVALID", "scan --scope node requires --node <nodeId>") };
    }
    return { ok: true, scope: { kind: "node", nodeId } };
  }
  if (scopeKind === "paths" || (pathList.length > 0 && scopeKind === undefined)) {
    const uniquePaths = [...new Set(pathList)].sort();
    if (uniquePaths.length === 0 || uniquePaths.some((p) => !isRepoRelativePosixPath(p))) {
      return { ok: false, envelope: errorEnvelope("scan", "AC_SCHEMA_INVALID", "scan --scope paths requires valid repo-relative --path entries") };
    }
    return { ok: true, scope: { kind: "paths", paths: uniquePaths } };
  }
  if (scopeKind !== undefined && scopeKind !== "repository") {
    return { ok: false, envelope: errorEnvelope("scan", "AC_SCHEMA_INVALID", "scan --scope must be repository|node|paths") };
  }
  return { ok: true, scope: { kind: "repository" } };
}

export function runScanCommand(args: string[], cwd: string) {
  if (args[0] === "simulate") return runRefactorSimulateCommand(args.slice(1), cwd);
  const scopeParsed = parseScanScope(args);
  if (!scopeParsed.ok) return scopeParsed.envelope;
  const limitParsed = parseOptionalImportLimit(args, "scan");
  if (!limitParsed.ok) return limitParsed.envelope;
  const root = findRepositoryRoot(cwd);
  return okEnvelope(
    "scan",
    runScanV2(root, {
      scope: scopeParsed.scope,
      ...(limitParsed.value !== undefined ? { importNodeLimit: limitParsed.value } : {})
    }) as unknown as Json
  );
}

export function runDecideCommand(args: string[], cwd: string) {
  const action = (args[0] ?? "list") as V2DecideAction;
  if (!VALID_DECIDE_ACTIONS.has(action)) {
    return errorEnvelope(
      "decide",
      "AC_SCHEMA_INVALID",
      "decide requires list|show|accept|defer|reject|waive|acknowledge|resolve"
    );
  }
  const surface = `decide.${action}`;
  const limitParsed = parseOptionalImportLimit(args, surface);
  if (!limitParsed.ok) return limitParsed.envelope;
  const positionalId = args[1] !== undefined && !args[1].startsWith("-") ? args[1] : undefined;
  const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? positionalId;
  const root = findRepositoryRoot(cwd);

  const result = runDecideV2(root, {
    action,
    ...(recommendationId !== undefined ? { recommendationId } : {}),
    ...(readFlag(args, "--status") !== undefined ? { status: readFlag(args, "--status")! } : {}),
    ...(readFlag(args, "--reason") !== undefined ? { reason: readFlag(args, "--reason")! } : {}),
    ...(readFlag(args, "--resolution-digest") !== undefined ? { resolutionDigest: readFlag(args, "--resolution-digest")! } : {}),
    ...(readFlag(args, "--actor") !== undefined ? { actorId: readFlag(args, "--actor")! } : {}),
    ...(limitParsed.value !== undefined ? { importNodeLimit: limitParsed.value } : {}),
    killSymbols: readRepeatedFlag(args, "--kill-symbol"),
    killPaths: readRepeatedFlag(args, "--kill-path"),
    killRelations: readRepeatedFlag(args, "--kill-relation")
  });
  return okEnvelope(surface, result as unknown as Json);
}

export function runVerifyV2Command(args: string[], cwd: string) {
  const positionalId = args.find((token, idx) =>
    !token.startsWith("-") && (idx === 0 || !["--import-node-limit", "--format"].includes(args[idx - 1]!))
  );
  const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? positionalId;
  if (!recommendationId || !/^recommendation\.[a-f0-9]{16}$/.test(recommendationId)) {
    return errorEnvelope("verify", "AC_SCHEMA_INVALID", "verify requires <recommendation-id> (recommendation.<16-hex>) or --base <ref>");
  }
  const limitParsed = parseOptionalImportLimit(args, "verify");
  if (!limitParsed.ok) return limitParsed.envelope;
  const root = findRepositoryRoot(cwd);
  return okEnvelope(
    "verify",
    runVerifyV2(root, recommendationId, {
      ...(limitParsed.value !== undefined ? { importNodeLimit: limitParsed.value } : {})
    }) as unknown as Json
  );
}

function parseMoveFlags(rawMoves: readonly string[]): { ok: true; moves: RefactorSimulationMoveV1[] } | { ok: false; message: string } {
  const moves: RefactorSimulationMoveV1[] = [];
  for (const raw of rawMoves) {
    const parts = raw.split(":");
    if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) {
      return { ok: false, message: `--move must be <path>:<toNodeId>[:sym1,sym2]: ${raw}` };
    }
    const [path, toNodeId, rawSymbols] = parts;
    if (parts.length === 3) {
      const symbols = (rawSymbols ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (symbols.length === 0) {
        return { ok: false, message: `--move symbols segment cannot be empty: ${raw}` };
      }
      moves.push({ path: path!, toNodeId: toNodeId!, symbols });
    } else {
      moves.push({ path: path!, toNodeId: toNodeId! });
    }
  }
  return { ok: true, moves };
}

export function runRefactorSimulateCommand(args: string[], cwd: string) {
  const surface = "refactor.simulate";
  const limitParsed = parseOptionalImportLimit(args, surface);
  if (!limitParsed.ok) return limitParsed.envelope;
  const root = findRepositoryRoot(cwd);
  let request: RefactorSimulationRequestV1 = {};

  const requestFile = readFlag(args, "--request-file");
  const requestJson = readFlag(args, "--request-json");
  if (requestFile && requestJson) {
    return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor simulate accepts either --request-file or --request-json, not both");
  }
  if (requestFile) {
    if (!isRepoRelativePosixPath(requestFile)) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", "--request-file must be a safe repo-relative path");
    }
    const absFile = resolve(root, requestFile);
    if (!existsSync(absFile) || lstatSync(absFile).isSymbolicLink()) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", `--request-file is missing or symlinked: ${requestFile}`);
    }
    try {
      request = JSON.parse(readFileSync(absFile, "utf8")) as RefactorSimulationRequestV1;
    } catch (error) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", `invalid --request-file JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (requestJson) {
    try {
      request = JSON.parse(requestJson) as RefactorSimulationRequestV1;
    } catch (error) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", `invalid --request-json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor simulate request must be an object");
  }

  const rawMoves = readRepeatedFlag(args, "--move");
  if (rawMoves.length > 0) {
    const parsedMoves = parseMoveFlags(rawMoves);
    if (!parsedMoves.ok) return errorEnvelope(surface, "AC_SCHEMA_INVALID", parsedMoves.message);
    request = { ...request, moves: [...(request.moves ?? []), ...parsedMoves.moves] };
  }
  const targetSubject = readFlag(args, "--target");
  if (targetSubject !== undefined) request = { ...request, targetSubject };
  const expectedHeadSha = readFlag(args, "--expected-head-sha");
  if (expectedHeadSha !== undefined) request = { ...request, expectedHeadSha };
  const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
  if (expectedWorktreeDigest !== undefined) request = { ...request, expectedWorktreeDigest };
  if (limitParsed.value !== undefined) request = { ...request, importNodeLimit: limitParsed.value };

  return okEnvelope(surface, runRefactorSimulate(root, request) as unknown as Json);
}
