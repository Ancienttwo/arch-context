import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  FailureError,
  architectureDocsProjectionCompatibilityIssues,
  baseModelBlockingErrors,
  digestJson,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion,
  parseRefactorDecisionFile,
  serializeRefactorDecision,
  type ModelValidationResult,
  type validateJsonSchema
} from "@archcontext/contracts";
import type { ArchContextPathScope } from "@archcontext/core/policy-engine";
import { assertExpectedHash, assertPathHasNoSymlinkSegments, preimageFailure } from "./atomic-fs";
import { ADR_REFERENCE_OPERATION_SCHEMA, assertAdrReferenceOperation, renderAdrReferenceUpdate } from "./adr-reference-update";
import { MANIFEST_UPDATE_OPERATION_SCHEMA, MANIFEST_UPDATE_PATH, assertManifestUpdateOperation, renderManifestFieldsUpdate, type ManifestUpdateFields } from "./manifest-update";
import type {
  AgentContextScopePort,
  ChangeOperation,
  ChangeOperationKind,
  ChangeSetDraft,
  ChangeSetProjectionDelete,
  ChangeSetProjectionFile,
  ChangeSetProjectionGuard
} from "./types";

/** Shared by the daemon preflight and the engine. Post-apply validation has no exemptions. */
export function changeSetBaseModelBlockingErrors(result: ModelValidationResult, draft: ChangeSetDraft): string[] {
  const repairedPaths = new Set(draft.operations
    .filter(operation => operation.op === "update_entity_fields" || operation.op === "delete_entity")
    .map(operation => operation.path));
  const repairedErrors = new Set((result.nodeSchemaErrors ?? [])
    .filter(issue => repairedPaths.has(issue.path))
    .map(issue => issue.error));
  if (draft.operations.length === 1) {
    const operation = draft.operations[0]!;
    try {
      assertManifestUpdateOperation(operation);
      if (operation.fields["model.layers"] !== undefined) for (const error of result.layerOrderErrors ?? []) repairedErrors.add(error);
    } catch { /* An invalid or unrelated operation cannot relax base validation. */ }
  }
  return baseModelBlockingErrors(result).filter(error => !repairedErrors.has(error));
}

/** Reserve the manifest destination through dot/slash aliases and case-insensitive filesystems. */
export function isProjectionManifestDestination(root: string, path: string): boolean {
  return resolve(root, path).toLowerCase() === resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH).toLowerCase();
}

/** Live repository floors also govern supplied output and implicit generated rebuilds. */
export function assertProjectionWriteCompatibility(root: string, proposed?: ChangeSetProjectionFile | ChangeSetProjectionDelete): void {
  const path = resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  let current: unknown;
  if (existsSync(path)) {
    const body = readFileSync(path, "utf8");
    try { current = JSON.parse(body); } catch { /* Existing malformed-manifest handling remains. */ }
  }
  if (architectureDocsProjectionCompatibilityIssues(current).length) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  if (!proposed) return;
  if ("delete" in proposed) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  let candidate: unknown;
  try { candidate = JSON.parse(proposed.body); } catch { throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible"); }
  if (architectureDocsProjectionCompatibilityIssues(candidate).length) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  // A superseded manifest is not a baseline: its floors only decide whether this engine may replace it (#579).
  const currentSchema = current && typeof current === "object" ? (current as Record<string, unknown>).schemaVersion : undefined;
  if (typeof currentSchema === "string" && isSupersededArchitectureDocsProjectionManifestSchemaVersion(currentSchema)) return;
  for (const key of ["minimumRendererVersion", "minimumProtocolVersion"] as const) {
    const floor = current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
    if (floor !== undefined && (!candidate || typeof candidate !== "object" || (candidate as Record<string, unknown>)[key] !== floor)) throw new FailureError("AC_PRECONDITION_FAILED", "projection-manifest-incompatible");
  }
}

export const EMPTY_PATH_SET: ReadonlySet<string> = new Set<string>();

export function planManifestFieldsOperation(root: string, fields: ManifestUpdateFields): ChangeOperation {
  const absolute = assertPathHasNoSymlinkSegments(root, MANIFEST_UPDATE_PATH);
  const body = readFileSync(absolute, "utf8");
  const operation: ChangeOperation = { op: "update_manifest_fields", path: MANIFEST_UPDATE_PATH, expectedHash: digestJson({ body }), fields };
  assertManifestUpdateOperation(operation);
  renderManifestFieldsUpdate(body, fields);
  return operation;
}

const ENTITY_FILE_OPERATIONS: ReadonlySet<ChangeOperationKind> = new Set(["create_entity", "update_entity_fields", "delete_entity"]);

/**
 * Preview-time view of the per-entity preimage: the expected hash must match the current file
 * (`missing` for an absent one), and the preview reports update or delete of an absent target as
 * a finding. A mismatch names the current hash so the caller can re-read and re-plan. Apply does
 * not trust the preview and does not repeat the target-exists check: `applyFileOperation` only
 * rechecks the expected hash immediately before it writes.
 */
export function entityPreimageFindings(root: string, operation: ChangeOperation): string[] {
  if (!ENTITY_FILE_OPERATIONS.has(operation.op) || !operation.path) return [];
  let absolute: string;
  try {
    absolute = assertPathHasNoSymlinkSegments(root, operation.path);
  } catch {
    // Path containment and symlink findings are the path policy's to report, not a preimage finding.
    return [];
  }
  const current = existsSync(absolute) && lstatSync(absolute).isFile() ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
  if (current === "missing" && operation.op !== "create_entity") return [`${operation.op} target does not exist: ${operation.path}`];
  return current === operation.expectedHash ? [] : [`Expected hash mismatch: ${operation.path} (current ${current})`];
}

/**
 * Every projection file write's preimage, checked as one pass before any file is touched. Apply
 * rechecks each file again immediately before it writes; this pass lets a caller refuse a stale
 * projection with nothing written instead of rolling back the files written before the stale one.
 * A path an earlier operation of the same draft writes is left to that per-file recheck. Paths that
 * fail containment or symlink checks are the path policy's to report, not a preimage finding.
 */
export function projectionPreimageFindings(root: string, draft: ChangeSetDraft): string[] {
  const findings: string[] = [];
  const written = new Set<string>();
  for (const operation of draft.operations) {
    if (operation.path) written.add(operation.path);
    for (const file of operation.projectionFiles ?? []) {
      if (written.has(file.path)) continue;
      written.add(file.path);
      let absolute: string;
      try {
        absolute = assertPathHasNoSymlinkSegments(root, file.path);
      } catch {
        continue;
      }
      const current = existsSync(absolute) && lstatSync(absolute).isFile() ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
      if (current !== file.expectedHash) findings.push(`Expected hash mismatch: ${file.path} (current ${current})`);
    }
  }
  return findings;
}

/**
 * The draft's projection guards, each allowed by its operation and on a path no write or delete of
 * the same draft touches: a guarded file is one the apply depends on and leaves alone.
 */
export function projectionGuards(draft: ChangeSetDraft): ChangeSetProjectionGuard[] {
  const guards: ChangeSetProjectionGuard[] = [];
  const touched = new Set<string>();
  for (const operation of draft.operations) {
    if (operation.path) touched.add(operation.path);
    for (const file of operation.projectionFiles ?? []) {
      if (!("guard" in file)) {
        touched.add(file.path);
        continue;
      }
      assertProjectionGuardAllowed(operation.op, file);
      guards.push(file);
    }
  }
  const overlapping = guards.find((guard) => touched.has(guard.path));
  if (overlapping) throw new Error(`Projection file guard must not be written by the same ChangeSet: ${overlapping.path}`);
  return guards;
}

export function assertProjectionGuardAllowed(op: ChangeOperationKind, file: ChangeSetProjectionGuard): void {
  if (op !== "render_projection") throw new Error(`Projection file guard is only allowed in render_projection: ${file.path}`);
  if (file.guard !== true || "body" in file || "delete" in file) throw new Error(`Projection file guard must carry guard: true and no body: ${file.path}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(file.expectedHash)) throw new Error(`Projection file guard requires the exact current hash: ${file.path}`);
}

/** The guarded file still exists with exactly the raw bytes the render read; nothing is written. */
export function assertProjectionGuardHolds(root: string, guard: ChangeSetProjectionGuard): void {
  const absolute = assertPathHasNoSymlinkSegments(root, guard.path);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw preimageFailure(`Expected hash mismatch: ${guard.path} (current missing)`);
  assertExpectedHash(absolute, guard.expectedHash);
}

export function assertProjectionDeleteAllowed(op: ChangeOperationKind, file: ChangeSetProjectionDelete): void {
  if (op !== "render_projection") throw new Error(`Projection file delete is only allowed in render_projection: ${file.path}`);
  if (file.delete !== true || "body" in file) throw new Error(`Projection file delete must carry delete: true and no body: ${file.path}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(file.expectedHash)) throw new Error(`Projection file delete requires the exact current hash: ${file.path}`);
}

export function operationTargetPaths(operation: ChangeOperation): string[] {
  return [
    ...(operation.path ? [operation.path] : []),
    ...(operation.projectionFiles?.map((file) => file.path) ?? [])
  ];
}

export function pathScope(operation: ChangeOperationKind, agentContextPaths: ReadonlySet<string>): ArchContextPathScope {
  return {
    operation: operation === "render_agent_context" ? "agent-context"
      : operation === "update_manifest_fields" ? "manifest"
      : operation === "update_adr_references" ? "adr-reference"
      : operation === "write_refactor_decision" ? "refactor-decision"
      : "default",
    agentContextPaths
  };
}

/** True when every operation of a non-empty draft writes a refactor decision file. */
export function isRefactorDecisionOnly(operations: readonly ChangeOperation[]): boolean {
  return operations.length > 0 && operations.every((operation) => operation.op === "write_refactor_decision");
}

/**
 * A decision write never shares a draft with another operation kind: the daemon builds it as a
 * decision-only ChangeSet, so it can skip projection planning without hiding a model change.
 */
export function assertRefactorDecisionDraft(draft: ChangeSetDraft): void {
  if (draft.operations.some((operation) => operation.op === "write_refactor_decision") && !isRefactorDecisionOnly(draft.operations)) {
    throw new Error("write_refactor_decision must not be combined with other ChangeSet operations");
  }
}

/**
 * The bytes of one decision write, checked before anything is touched: a no-follow path that is
 * exactly a decision file, a body that parses as that file's `RefactorDecisionV1` and is already in
 * the one canonical serialization, and the expected preimage hash.
 */
export function refactorDecisionBody(root: string, operation: ChangeOperation): string {
  if (!operation.path || operation.body === undefined) throw new Error("write_refactor_decision requires path and body");
  if (operation.fields !== undefined || operation.references !== undefined || operation.projectionFiles !== undefined || operation.entityId !== undefined) {
    throw new Error("write_refactor_decision carries only path, expectedHash and body");
  }
  const absolute = assertPathHasNoSymlinkSegments(root, operation.path);
  const decision = parseRefactorDecisionFile(operation.path, operation.body);
  if (serializeRefactorDecision(decision) !== operation.body) {
    throw new Error(`write_refactor_decision body must be the canonical serialization: ${operation.path}`);
  }
  if (existsSync(absolute)) assertExpectedHash(absolute, operation.expectedHash);
  else if (operation.expectedHash !== "missing") throw preimageFailure(`Expected missing file hash for new path: ${operation.path}`);
  return operation.body;
}

type JsonSchema = Parameters<typeof validateJsonSchema>[0];
const nonEmptyTextSchema: JsonSchema = { type: "string", minLength: 1 };
const planEntityOperationSchema: JsonSchema = {
  type: "object",
  required: ["op", "expectedHash"],
  additionalProperties: false,
  properties: {
    op: { enum: ["create_entity", "update_entity_fields", "delete_entity", "write_policy", "write_waiver", "render_projection", "render_agent_context"] },
    path: nonEmptyTextSchema,
    entityId: nonEmptyTextSchema,
    expectedHash: nonEmptyTextSchema,
    body: { type: "string" },
    projectionFiles: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "expectedHash", "body"],
        additionalProperties: false,
        properties: { path: nonEmptyTextSchema, expectedHash: nonEmptyTextSchema, body: { type: "string" } }
      }
    }
  }
};

/** Schema for `archctx plan --operations-file` operations array. */
export const PLAN_OPERATIONS_SCHEMA: JsonSchema = {
  type: "array",
  items: { oneOf: [planEntityOperationSchema, MANIFEST_UPDATE_OPERATION_SCHEMA, ADR_REFERENCE_OPERATION_SCHEMA] }
};

export function buildAdrReferenceBody(root: string, operation: ChangeOperation): string {
  assertAdrReferenceOperation(operation);
  const absolute = assertPathHasNoSymlinkSegments(root, operation.path);
  assertExpectedHash(absolute, operation.expectedHash);
  return renderAdrReferenceUpdate(readFileSync(absolute, "utf8"), operation.references);
}

export function validateRootContractFileWrite(root: string, file: ChangeSetProjectionFile, scope?: AgentContextScopePort): void {
  if (file.path !== "AGENTS.md" && file.path !== "CLAUDE.md") return;
  const validate = scope?.validateRootWrite;
  if (!validate) throw new Error("Root contract write requires canonical marker-only validation");
  const absolute = assertPathHasNoSymlinkSegments(root, file.path);
  if (!/^sha256:[a-f0-9]{64}$/.test(file.expectedHash)) throw new Error("Root contract must exist with an exact expectedHash");
  assertExpectedHash(absolute, file.expectedHash);
  validate(root, file);
}

export function buildManifestUpdateBody(root: string, draft: ChangeSetDraft): string {
  if (draft.operations.length !== 1) throw new Error("Manifest update must be the only ChangeSet operation");
  const operation = draft.operations[0]!;
  assertManifestUpdateOperation(operation);
  const absolute = assertPathHasNoSymlinkSegments(root, MANIFEST_UPDATE_PATH);
  assertExpectedHash(absolute, operation.expectedHash);
  if (operation.fields["content.decisions"] !== undefined) {
    const directory = assertPathHasNoSymlinkSegments(root, "docs/adr");
    if (!lstatSync(directory).isDirectory()) throw new Error("Manifest decisions target docs/adr must be an existing directory");
  }
  return renderManifestFieldsUpdate(readFileSync(absolute, "utf8"), operation.fields);
}

export function assertModelValidationPassed(result: ModelValidationResult, draft: ChangeSetDraft, phase: "before" | "after"): void {
  // The base may have dangling references or schema errors on nodes this draft repairs.
  // The after-apply model must be fully valid.
  const errors = phase === "before" ? changeSetBaseModelBlockingErrors(result, draft) : result.errors;
  const blocked = phase === "before" ? errors.length > 0 : !result.valid;
  if (blocked) {
    const path = errors[0]?.match(/^(\.archcontext\/.+?): /)?.[1];
    const error = new FailureError("AC_SCHEMA_INVALID", "native-context-model-invalid", {
      invariant: `model-validation-${phase}-apply`,
      ...(path ? { path } : {})
    });
    // Keep the local diagnostic. Public adapters publish only the classified failure.
    error.message = `ChangeSet model validation failed ${phase} apply: ${errors.join("; ") || "unknown validation error"}`;
    throw error;
  }
}
