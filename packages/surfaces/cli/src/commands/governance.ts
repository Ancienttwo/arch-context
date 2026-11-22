import {
  REFACTOR_REQUEST_SCHEMA_VERSION,
  errorEnvelope,
  refactorRequestInvariantIssues,
  refactorVerificationRequestInvariantIssues,
  type RefactorRequestV1,
  type RefactorVerificationRequestV1
} from "@archcontext/contracts";
import type { RuntimeDaemonClient, RuntimeRecommendationInput } from "@archcontext/local-runtime/runtime-daemon";
import {
  RefactorFlagError,
  explorerProjectionQueryV2FromCli,
  importNodeLimitValue,
  readFlag,
  readRepeatedFlag,
  refactorFlagValue,
  refactorScanScopeFlags
} from "../cli-flags";

export async function runExploreCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "status";
  const daemon = await runtime();
  if (subcommand === "projection") return daemon.explorerProjectionV2(cwd, explorerProjectionQueryV2FromCli(args));
  if (subcommand === "delta") {
    const baseEventId = readFlag(args, "--base-event-id");
    const headEventId = readFlag(args, "--head-event-id");
    const baseProjectionDigest = readFlag(args, "--base-projection-digest");
    const headProjectionDigest = readFlag(args, "--head-projection-digest");
    if (!baseEventId || !headEventId || !baseProjectionDigest || !headProjectionDigest) return errorEnvelope("explorer.delta", "AC_SCHEMA_INVALID", "explore delta requires --base-event-id, --head-event-id, --base-projection-digest and --head-projection-digest");
    return daemon.explorerProjectionDelta(cwd, {
      schemaVersion: "archcontext.explorer-delta-query/v2",
      base: { eventId: baseEventId, projectionDigest: baseProjectionDigest },
      head: { eventId: headEventId, projectionDigest: headProjectionDigest }
    });
  }
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
  return errorEnvelope("explore", "AC_SCHEMA_INVALID", "explore requires start|stop|status|revoke|projection|delta|contract");
}

export async function runRecommendationsCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "metrics";
  if (subcommand === "metrics") {
    return daemon.recommendations(cwd, {
      command: "metrics",
      ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! })
    });
  }
  if (subcommand === "show") {
    const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? args[1];
    if (!recommendationId || recommendationId.startsWith("--")) {
      return errorEnvelope("recommendations.show", "AC_SCHEMA_INVALID", "recommendations show requires --id");
    }
    const importNodeLimit = recommendationsImportNodeLimit(args);
    if (importNodeLimit === null) return recommendationsImportNodeLimitError("show");
    return daemon.recommendations(cwd, { command: "show", recommendationId, ...(importNodeLimit === undefined ? {} : { importNodeLimit }) });
  }
  if (subcommand === "list") {
    const status = readFlag(args, "--status");
    return daemon.recommendations(cwd, { command: "list", ...(status === undefined ? {} : { status: status as RuntimeRecommendationInput["status"] }) });
  }
  if (!["acknowledge", "accept", "reject", "defer", "waive", "resolve"].includes(subcommand)) {
    return errorEnvelope("recommendations", "AC_SCHEMA_INVALID", "recommendations requires acknowledge|accept|reject|defer|waive|resolve|metrics|show|list");
  }
  const recommendationId = readFlag(args, "--id") ?? readFlag(args, "--recommendation-id") ?? args[1];
  if (!recommendationId || recommendationId.startsWith("--")) {
    return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} requires --id`);
  }
  const reason = readFlag(args, "--reason");
  if (!reason) return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} requires --reason`);
  const importNodeLimit = recommendationsImportNodeLimit(args);
  if (importNodeLimit === null) return recommendationsImportNodeLimitError(subcommand);
  const snapshotDigest = readFlag(args, "--snapshot-digest");
  if (snapshotDigest !== undefined && (args.lastIndexOf("--snapshot-digest") !== args.indexOf("--snapshot-digest") || !/^sha256:[a-f0-9]{64}$/.test(snapshotDigest))) {
    return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", "--snapshot-digest requires one sha256:<64-hex> value");
  }
  const input: RuntimeRecommendationInput = {
    ...(snapshotDigest === undefined ? {} : { snapshotDigest }),
    command: subcommand as RuntimeRecommendationInput["command"],
    recommendationId,
    reason,
    approved: true,
    actor: readFlag(args, "--actor") ?? "developer",
    ...(readFlag(args, "--actor-kind") === undefined ? {} : { actorKind: readFlag(args, "--actor-kind")! as any }),
    ...(readFlag(args, "--source") === undefined ? {} : { source: readFlag(args, "--source")! as any }),
    ...(readFlag(args, "--expected-worktree-digest") === undefined ? {} : { expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest")! }),
    ...(readFlag(args, "--evidence-digest") === undefined ? {} : { evidenceDigest: readFlag(args, "--evidence-digest")! }),
    ...(importNodeLimit === undefined ? {} : { importNodeLimit }),
    ...(readFlag(args, "--agent-job-id") === undefined ? {} : { agentJobId: readFlag(args, "--agent-job-id")! }),
    ...(readFlag(args, "--now") === undefined ? {} : { now: readFlag(args, "--now")! })
  };
  return daemon.recommendations(cwd, input);
}

function recommendationsImportNodeLimit(args: string[]): number | undefined | null {
  const index = args.indexOf("--import-node-limit");
  if (index === -1) return undefined;
  const raw = args[index + 1];
  return raw === undefined ? null : importNodeLimitValue(raw) ?? null;
}

function recommendationsImportNodeLimitError(subcommand: string) {
  return errorEnvelope(`recommendations.${subcommand}`, "AC_SCHEMA_INVALID", `recommendations ${subcommand} --import-node-limit must be a positive integer`);
}

export async function runRefactorCommand(args: string[], cwd: string, runtime: () => Promise<RuntimeDaemonClient>) {
  const subcommand = args[0] ?? "scan";
  if (subcommand !== "scan" && subcommand !== "record" && subcommand !== "verify") {
    return errorEnvelope("refactor", "AC_SCHEMA_INVALID", "refactor requires scan|record|verify");
  }
  const surface = `refactor.${subcommand}`;
  try {
    if (subcommand === "scan") {
      const raw = refactorFlagValue(args, "--request-json");
      const limitRaw = refactorFlagValue(args, "--import-node-limit");
      const scope = refactorScanScopeFlags(args, raw);
      if (scope.kind === "repository" && raw === undefined && limitRaw === undefined) return (await runtime()).refactorScan(cwd, {});
      let request: unknown = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope };
      if (raw !== undefined) {
        try {
          request = JSON.parse(raw);
        } catch (error) {
          return errorEnvelope(surface, "AC_SCHEMA_INVALID", `refactor scan --request-json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (typeof request !== "object" || request === null || Array.isArray(request)) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor scan --request-json must be a RefactorRequestV1 object");
      }
      if (limitRaw !== undefined) {
        const importNodeLimit = importNodeLimitValue(limitRaw);
        if (importNodeLimit === undefined) {
          return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor scan --import-node-limit must be a positive integer");
        }
        request = { ...request, importNodeLimit };
      }
      const issues = refactorRequestInvariantIssues(request as RefactorRequestV1);
      if (issues.length > 0) return errorEnvelope(surface, "AC_SCHEMA_INVALID", issues.join("; "));
      return (await runtime()).refactorScan(cwd, { request: request as RefactorRequestV1 });
    }
    if (subcommand === "verify") {
      const raw = refactorFlagValue(args, "--request-json");
      if (raw === undefined) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor verify --request-json is required");
      }
      let request: unknown;
      try {
        request = JSON.parse(raw);
      } catch (error) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", `refactor verify --request-json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (typeof request !== "object" || request === null || Array.isArray(request)) {
        return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor verify --request-json must be a RefactorVerificationRequestV1 object");
      }
      const limitRaw = refactorFlagValue(args, "--import-node-limit");
      if (limitRaw !== undefined) {
        const importNodeLimit = importNodeLimitValue(limitRaw);
        if (importNodeLimit === undefined) {
          return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor verify --import-node-limit must be a positive integer");
        }
        request = { ...request, importNodeLimit };
      }
      const issues = refactorVerificationRequestInvariantIssues(request as RefactorVerificationRequestV1);
      if (issues.length > 0) return errorEnvelope(surface, "AC_SCHEMA_INVALID", issues.join("; "));
      return (await runtime()).refactorVerify(cwd, request as RefactorVerificationRequestV1);
    }
    const assessmentDigest = refactorFlagValue(args, "--assessment-digest");
    const expectedWorktreeDigest = refactorFlagValue(args, "--expected-worktree-digest");
    if (!assessmentDigest || !expectedWorktreeDigest) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor record requires --assessment-digest and --expected-worktree-digest");
    }
    if (args.includes("--selection")) {
      return errorEnvelope(surface, "AC_SCHEMA_INVALID", "refactor record does not support the unknown flag --selection; every planned recommendation is recorded");
    }
    return (await runtime()).refactorRecord(cwd, { assessmentDigest, expectedWorktreeDigest });
  } catch (error) {
    if (error instanceof RefactorFlagError) return errorEnvelope(surface, "AC_SCHEMA_INVALID", error.message);
    throw error;
  }
}

export async function runPracticesCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const subcommand = args[0] ?? "list";
  if (subcommand === "checkpoint") return runPracticeCheckpointCommand(args.slice(1), cwd, daemon);
  if (subcommand === "list") {
    return daemon.practices(cwd, {
      action: "list",
      category: readFlag(args, "--category"),
      source: readFlag(args, "--source")
    });
  }
  if (subcommand === "show") {
    const id = args[1] ?? readFlag(args, "--id");
    if (!id) return errorEnvelope("practices.show", "AC_SCHEMA_INVALID", "practices show requires <id> or --id");
    return daemon.practices(cwd, { action: "show", id });
  }
  if (subcommand === "validate") {
    return daemon.practices(cwd, { action: "validate", strict: args.includes("--strict") });
  }
  if (subcommand === "sources") {
    return daemon.practices(cwd, { action: "sources" });
  }
  if (subcommand === "waivers") {
    return daemon.practiceWaivers(cwd);
  }
  if (subcommand === "waive") {
    const required = ["--practice-id", "--owner", "--reason", "--review-at", "--expires-at", "--evidence-digest"];
    const missing = required.filter((flag) => !readFlag(args, flag));
    if (missing.length > 0) return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", `practices waive requires ${missing.join(", ")}`);
    const subjects = readRepeatedFlag(args, "--subject");
    const pathGlobs = readRepeatedFlag(args, "--path-glob");
    if (subjects.length === 0 && pathGlobs.length === 0) {
      return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", "practices waive requires --subject or --path-glob");
    }
    return daemon.planPracticeWaiver(cwd, {
      ...(readFlag(args, "--id") === undefined ? {} : { id: readFlag(args, "--id")! }),
      ...(readFlag(args, "--waiver-id") === undefined ? {} : { waiverId: readFlag(args, "--waiver-id")! }),
      ...(readFlag(args, "--task-session-id") === undefined ? {} : { taskSessionId: readFlag(args, "--task-session-id")! }),
      practiceId: readFlag(args, "--practice-id")!,
      ...(readFlag(args, "--check-id") === undefined ? {} : { checkId: readFlag(args, "--check-id")! }),
      owner: readFlag(args, "--owner")!,
      reason: readFlag(args, "--reason")!,
      ...(readFlag(args, "--created-at") === undefined ? {} : { createdAt: readFlag(args, "--created-at")! }),
      reviewAt: readFlag(args, "--review-at")!,
      expiresAt: readFlag(args, "--expires-at")!,
      evidenceDigest: readFlag(args, "--evidence-digest")!,
      ...(subjects.length === 0 ? {} : { subjects }),
      ...(pathGlobs.length === 0 ? {} : { pathGlobs })
    });
  }
  return errorEnvelope("practices", "AC_SCHEMA_INVALID", "practices requires checkpoint|list|show|validate|sources|waivers|waive");
}

async function runPracticeCheckpointCommand(args: string[], cwd: string, daemon: RuntimeDaemonClient) {
  const task = readFlag(args, "--task");
  const result = await daemon.practiceCheckpoint(cwd, {
    taskSessionId: readFlag(args, "--task-session-id") ?? "task_cli",
    ...(task === undefined ? {} : { task }),
    event: (readFlag(args, "--event") as any) ?? "manual",
    changedPaths: [...readRepeatedFlag(args, "--path"), ...readRepeatedFlag(args, "--changed")],
    toolCallId: readFlag(args, "--tool-call-id"),
    expectedHeadSha: readFlag(args, "--expected-head-sha") ?? readFlag(args, "--head-sha"),
    expectedWorktreeDigest: readFlag(args, "--expected-worktree-digest"),
    maxBytes: Number(readFlag(args, "--max-bytes") ?? 12_288),
    maxItems: Number(readFlag(args, "--max-items") ?? 12)
  });
  return { ...result, requestId: "practices.checkpoint" };
}
