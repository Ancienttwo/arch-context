import {
  FailureError,
  PROJECTION_MODES,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  PROJECTION_TARGETS,
  isRepoRelativePosixPath,
  okEnvelope,
  projectionRequestInvariantIssues,
  type Json,
  type JsonEnvelope,
  type ProjectionExpectedSnapshotV1,
  type ProjectionRequestV1,
  type Sha256Digest
} from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureDocumentationProjectionWorktreeDigest,
  loadNativeModelFromArchContext
} from "@archcontext/core/projection-engine";
import { findRepositoryRoot, listGitVisibleFiles, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { projectionWorkspaceId } from "./projection-inputs";
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationResult } from "./public-operation-failure";
import type { BuiltArchitectureDocsProjection } from "./projection-docs-helpers";
import type { RuntimeAgentContextProjectionInput, RuntimeDocsProjectionInput, RuntimeProjectionInvocation } from "./runtime-types";

export function parseProjectionProtocolRequest(raw: string): ProjectionRequestV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("projection request is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection request must be an object");
  const input = value as Record<string, unknown>;
  const expected = input.expected;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new Error("projection request.expected must be an object");
  const snapshot = expected as Record<string, unknown>;
  if (input.schemaVersion !== PROJECTION_REQUEST_SCHEMA_VERSION) throw new Error("projection request schemaVersion mismatch");
  if (input.profile !== REPO_HARNESS_PROJECTION_PROFILE) throw new Error(`projection request profile must be ${REPO_HARNESS_PROJECTION_PROFILE}`);
  if (typeof input.mode !== "string" || !(PROJECTION_MODES as readonly string[]).includes(input.mode)) throw new Error("projection request mode is invalid");
  if (!Array.isArray(input.targets) || input.targets.some((target) => typeof target !== "string" || !(PROJECTION_TARGETS as readonly string[]).includes(target))) throw new Error("projection request targets are invalid");
  if (!Array.isArray(input.changedPaths) || input.changedPaths.some((path) => typeof path !== "string" || !isRepoRelativePosixPath(path))) throw new Error("projection request changedPaths must be repository-relative POSIX paths");
  if (typeof input.requestId !== "string") throw new Error("projection request requestId is required");
  if (typeof snapshot.repositoryId !== "string" || typeof snapshot.workspaceId !== "string") throw new Error("projection request repository/workspace identity is required");
  if (typeof snapshot.headSha !== "string" || !/^[a-f0-9]{40}$/.test(snapshot.headSha)) throw new Error("projection request expected.headSha is invalid");
  if (typeof snapshot.worktreeDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(snapshot.worktreeDigest)) throw new Error("projection request expected.worktreeDigest is invalid");
  if (input.acceptedChange !== undefined) validateProjectionAcceptedChange(input.acceptedChange);
  const request = input as unknown as ProjectionRequestV1;
  const issues = projectionRequestInvariantIssues(request);
  if (issues.length > 0) throw new Error(`projection request invariant failed: ${issues.join("; ")}`);
  return request;
}

export function validateProjectionAcceptedChange(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("projection request acceptedChange must be an object");
  }
  const accepted = value as Record<string, unknown>;
  const supportedKeys = new Set(["changeSetId", "eventId", "reasonCodes", "affectedNodeIds"]);
  const unsupportedKey = Object.keys(accepted).find((key) => !supportedKeys.has(key));
  if (unsupportedKey) throw new Error(`projection request acceptedChange contains unsupported property: ${unsupportedKey}`);
  if (typeof accepted.changeSetId !== "string" || typeof accepted.eventId !== "string") {
    throw new Error("projection request acceptedChange changeSetId and eventId are required");
  }
  if (!Array.isArray(accepted.reasonCodes) || accepted.reasonCodes.some((reason) => typeof reason !== "string")) {
    throw new Error("projection request acceptedChange reasonCodes must be a string array");
  }
  if (!Array.isArray(accepted.affectedNodeIds) || accepted.affectedNodeIds.some((nodeId) => typeof nodeId !== "string")) {
    throw new Error("projection request acceptedChange affectedNodeIds must be a string array");
  }
}

export function currentProjectionExpectedSnapshot(
  root: string,
  model: ReturnType<typeof loadNativeModelFromArchContext>,
  files = listGitVisibleFiles(root)
): ProjectionExpectedSnapshotV1 {
  return {
    repositoryId: repositoryFingerprint(root),
    workspaceId: projectionWorkspaceId(root),
    headSha: readHeadSha(root),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, model, files) as Sha256Digest
  };
}

export function runProjectionSnapshotCommand(cwd: string, inputs?: { model(): ReturnType<typeof loadNativeModelFromArchContext>; files(): string[] }): JsonEnvelope {
  try { return publicOperationResult("projection.snapshot", runProjectionSnapshotCommandUnchecked(cwd, inputs)) as JsonEnvelope; }
  catch (error) { return publicOperationErrorEnvelope("projection.snapshot", error); }
}

function runProjectionSnapshotCommandUnchecked(cwd: string, inputs?: { model(): ReturnType<typeof loadNativeModelFromArchContext>; files(): string[] }): JsonEnvelope {
  let root: string;
  try {
    root = findRepositoryRoot(cwd);
  } catch {
    return publicFailureEnvelope("projection.snapshot", "AC_REPO_NOT_FOUND", "git-worktree-required");
  }
  try {
    return okEnvelope("projection.snapshot", {
      expected: currentProjectionExpectedSnapshot(root, inputs?.model() ?? loadNativeModelFromArchContext(root), inputs?.files())
    } as unknown as Json);
  } catch (error) {
    return publicOperationErrorEnvelope("projection.snapshot", error);
  }
}

export function assertProjectionExpectedSnapshot(
  request: ProjectionRequestV1,
  root: string,
  projection: BuiltArchitectureDocsProjection
): void {
  assertProjectionExpectedSnapshotAgainstModel(request, root, projection.loaded.model);
}

export function assertProjectionExpectedSnapshotAgainstModel(
  request: ProjectionRequestV1,
  root: string,
  model: ReturnType<typeof loadNativeModelFromArchContext>
): void {
  const actual = currentProjectionExpectedSnapshot(root, model);
  for (const field of ["repositoryId", "workspaceId", "headSha", "worktreeDigest"] as const) {
    if (request.expected[field] !== actual[field]) throw new ProjectionExpectedSnapshotMismatchError(field);
  }
}

export class ProjectionExpectedSnapshotMismatchError extends FailureError<"AC_PRECONDITION_FAILED"> {
  constructor(readonly field: "repositoryId" | "workspaceId" | "headSha" | "worktreeDigest") {
    super("AC_PRECONDITION_FAILED", "projection-snapshot-mismatch", { field });
    this.name = "ProjectionExpectedSnapshotMismatchError";
  }
}

function projectionInputRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("projection input must be an object");
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`projection input contains unsupported property: ${extra}`);
  return record;
}

export function validateProjectionInvocation(value: unknown): asserts value is RuntimeProjectionInvocation {
  const input = projectionInputRecord(value, ["action", "request"]);
  if (input.action !== "run") throw new Error("projection action must be run");
  parseProjectionProtocolRequest(JSON.stringify(input.request));
}

export function projectionInvocationWrites(input: RuntimeProjectionInvocation): boolean {
  return input.action === "run" && ["apply", "adopt"].includes(input.request.mode);
}

export function assertProjectionInvocationSnapshot(root: string, input: RuntimeProjectionInvocation): void {
  assertProjectionExpectedSnapshotAgainstModel(input.request, findRepositoryRoot(root), loadNativeModelFromArchContext(root));
}

function validateHumanProjectionInput(input: Record<string, unknown>, actions: readonly string[]): void {
  if (typeof input.action !== "string" || !actions.includes(input.action)) throw new Error(`projection action must be ${actions.join("|")}`);
  for (const key of ["id", "taskSessionId", "expectedWorktreeDigest", "adoptionPlanId"]) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`projection ${key} must be a string`);
  }
  if (input.approved !== undefined && typeof input.approved !== "boolean") throw new Error("projection approved must be a boolean");
}

export function validateDocsProjectionInput(value: unknown): asserts value is RuntimeDocsProjectionInput {
  const input = projectionInputRecord(value, ["action", "profile", "acceptedChange", "id", "taskSessionId", "approved", "expectedWorktreeDigest", "adoptionPlanId", "includeInstructions"]);
  validateHumanProjectionInput(input, ["plan", "apply", "adopt", "drift", "clean"]);
  if (input.profile !== undefined && input.profile !== "default" && input.profile !== REPO_HARNESS_PROJECTION_PROFILE) throw new Error("projection profile is invalid");
  if (input.includeInstructions !== undefined && typeof input.includeInstructions !== "boolean") throw new Error("projection includeInstructions must be a boolean");
  if (input.acceptedChange !== undefined) validateProjectionAcceptedChange(input.acceptedChange);
}

export function validateAgentContextProjectionInput(value: unknown): asserts value is RuntimeAgentContextProjectionInput {
  const input = projectionInputRecord(value, ["action", "id", "taskSessionId", "approved", "expectedWorktreeDigest"]);
  validateHumanProjectionInput(input, ["plan", "preview", "apply"]);
}
