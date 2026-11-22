import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  ARCHITECTURE_MAJOR_CHANGE_REASON_CODES,
  PROJECTION_ARCHITECTURE_DEBT_COVERAGE_REASON_CODES,
  PROJECTION_ARCHITECTURE_DEBT_REASON_CODES,
  PROJECTION_COVERAGE_REASON_CODES,
  PROJECTION_FRESHNESS_REASON_CODES,
  PROJECTION_PRIOR_COMMITTED_APPLY_OPERATIONS,
  PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES,
  PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS,
  PROJECTION_TARGET_CHANGE_REASON_CODES,
  type ProjectionMode,
  type ProjectionTargetChangeClassification,
  type ProjectionTargetChangeReasonCode,
  type Sha256Digest
} from "./projection-constants";
import type {
  ProjectionArchitectureDebtV1,
  ProjectionCoverageV1,
  ProjectionFileResultV1,
  ProjectionFreshnessV2,
  ProjectionPriorCommittedApplyV1,
  ProjectionRequestV1,
  ProjectionTargetChangeV2
} from "./projection-types";
import type { ProjectionResultV3 } from "./projection-apply-types";
import { ISO_INSTANT, SHA256_DIGEST, sortedUniqueIssues } from "./projection-validation-helpers";
import { digestJson, isRepoRelativePosixPath, type Json } from "./schema";

export function projectionRequestInvariantIssues(input: ProjectionRequestV1): string[] {
  const issues = [
    ...sortedUniqueIssues("targets", input.targets),
    ...sortedUniqueIssues("changedPaths", input.changedPaths),
    ...(input.acceptedChange
      ? [
          ...sortedUniqueIssues("acceptedChange.reasonCodes", input.acceptedChange.reasonCodes),
          ...sortedUniqueIssues("acceptedChange.affectedNodeIds", input.acceptedChange.affectedNodeIds)
        ]
      : [])
  ];
  if (input.targets.length === 0) issues.push("targets must contain at least one projection target");
  if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) issues.push("requestId must use the stable identifier character set");
  if (input.mode === "adopt" && !input.adoptionPlanId) issues.push("adoptionPlanId is required when mode=adopt");
  if (input.mode !== "adopt" && input.adoptionPlanId !== undefined) issues.push("adoptionPlanId is only allowed when mode=adopt");
  if (input.acceptObservedMajorChange !== undefined) {
    if (input.acceptObservedMajorChange !== true) issues.push("acceptObservedMajorChange must be true when present");
    if (input.mode !== "apply" && input.mode !== "adopt") issues.push("acceptObservedMajorChange is only allowed when mode=apply or mode=adopt");
    if (input.acceptedChange !== undefined) issues.push("acceptObservedMajorChange and acceptedChange are mutually exclusive");
  }
  if (input.acceptedChange) {
    if (input.acceptedChange.changeSetId.trim() === "") issues.push("acceptedChange.changeSetId must not be empty");
    if (input.acceptedChange.eventId.trim() === "") issues.push("acceptedChange.eventId must not be empty");
    if (input.acceptedChange.reasonCodes.length === 0) issues.push("acceptedChange.reasonCodes must contain at least one reason");
    if (input.acceptedChange.affectedNodeIds.length === 0) issues.push("acceptedChange.affectedNodeIds must contain at least one node");
    const allowedReasons = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
    for (const reason of input.acceptedChange.reasonCodes) {
      if (!allowedReasons.has(reason)) issues.push(`acceptedChange.reasonCodes contains unsupported reason: ${reason}`);
    }
    for (const nodeId of input.acceptedChange.affectedNodeIds) {
      if (nodeId.trim() === "") issues.push("acceptedChange.affectedNodeIds must not contain empty node ids");
    }
  }
  return issues;
}

/**
 * Invariants that bind a result to the request mode that produced it, which the result itself does
 * not carry: only a `plan` result previews what it would write (#264); `check`, `apply` and
 * `adopt` results never carry `files[].preview`, whatever their status.
 */
export function projectionResultRequestModeIssues(input: ProjectionResultV3, mode: ProjectionMode): string[] {
  const issues: string[] = [];
  if (mode !== "plan" && input.files.some((file) => file.preview !== undefined)) {
    issues.push(`files[].preview is only allowed on a plan result, never when mode=${mode}`);
  }
  if (mode !== "check" && mode !== "plan" && input.architectureDebt !== undefined) {
    issues.push(`architectureDebt is only allowed on a check or plan result, never when mode=${mode}`);
  }
  if (mode !== "check" && mode !== "plan" && input.changes !== undefined) {
    issues.push(`changes is only allowed on a check or plan result, never when mode=${mode}`);
  }
  // The schema cannot condition on the request mode, so the presence promise is checked here.
  if ((mode === "check" || mode === "plan") && input.changes === undefined) {
    issues.push(`changes is required on every check or plan result, also when mode=${mode}`);
  }
  if (input.status === "planned-partial" && mode !== "check" && mode !== "plan") {
    issues.push(`planned-partial is only allowed on a check or plan result, never when mode=${mode}`);
  }
  if (input.status === "applied-partial" && mode !== "apply") {
    issues.push(`applied-partial is only allowed on an apply result, never when mode=${mode}`);
  }
  return issues;
}

/**
 * Shape and canonical order of a partial result's `coverage`, and its binding to the result's
 * files: a carried-forward target is never also a written file.
 */
export function projectionCoverageIssues(input: ProjectionCoverageV1, files: readonly ProjectionFileResultV1[] = []): string[] {
  const issues = [
    ...sortedUniqueIssues("coverage.blockedCapabilityIds", input.blockedCapabilityIds),
    ...sortedUniqueIssues("coverage.blockedTargets.targetId", input.blockedTargets.map((target) => target.targetId)),
    ...sortedUniqueIssues("coverage.appliedTargetIds", input.appliedTargetIds)
  ];
  if (input.complete !== false) issues.push("coverage.complete must be false; a result that covers every target omits coverage");
  if (input.blockedCapabilityIds.length === 0) issues.push("coverage.blockedCapabilityIds must name at least one capability");
  if (input.blockedTargets.length === 0) issues.push("coverage.blockedTargets must name at least one target");
  if (input.blockedCapabilityIds.some((id) => typeof id !== "string" || id.trim() === "")) issues.push("coverage.blockedCapabilityIds must not contain empty ids");
  if (input.appliedTargetIds.some((id) => typeof id !== "string" || id.trim() === "")) issues.push("coverage.appliedTargetIds must not contain empty ids");
  const blockedCapabilities = new Set(input.blockedCapabilityIds);
  const blockingCapabilities = new Set<string>();
  const blockedPaths = new Set<string>();
  const reasons = new Set<string>(PROJECTION_COVERAGE_REASON_CODES);
  for (const [index, target] of input.blockedTargets.entries()) {
    const prefix = `coverage.blockedTargets[${index}]`;
    if (typeof target.targetId !== "string" || target.targetId.trim() === "") issues.push(`${prefix}.targetId must not be empty`);
    if (!isRepoRelativePosixPath(target.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
    else if (blockedPaths.has(target.path)) issues.push(`${prefix}.path is named by another blocked target`);
    blockedPaths.add(target.path);
    issues.push(...sortedUniqueIssues(`${prefix}.capabilityIds`, target.capabilityIds), ...sortedUniqueIssues(`${prefix}.reasonCodes`, target.reasonCodes));
    if (target.capabilityIds.length === 0) issues.push(`${prefix}.capabilityIds must name at least one capability`);
    if (target.reasonCodes.length === 0) issues.push(`${prefix}.reasonCodes must name at least one reason`);
    for (const capabilityId of target.capabilityIds) {
      if (!blockedCapabilities.has(capabilityId)) issues.push(`${prefix}.capabilityIds names ${capabilityId}, which is not a blocked capability`);
      blockingCapabilities.add(capabilityId);
    }
    const reason = target.reasonCodes.find((code) => !reasons.has(code));
    if (reason !== undefined) issues.push(`${prefix}.reasonCodes contains unsupported reason: ${reason}`);
    if (input.appliedTargetIds.includes(target.targetId)) issues.push(`${prefix}.targetId must not also be an applied target`);
  }
  for (const capabilityId of input.blockedCapabilityIds) {
    if (!blockingCapabilities.has(capabilityId)) issues.push(`coverage.blockedCapabilityIds names ${capabilityId}, which blocks no target`);
  }
  for (const file of files) {
    if (blockedPaths.has(file.path)) issues.push(`files[] must not write the carried-forward target path ${file.path}`);
  }
  return issues;
}

const TARGET_CHANGE_BLOCKING_REASONS = new Set<string>(PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES);
const TARGET_CHANGE_UNKNOWN_REASONS = ["baseline-missing", "target-row-missing"] as const;
const TARGET_CHANGE_OUTPUT_REASONS = ["file-bytes-changed", "rendered-output-changed", "target-added", "target-removed"] as const;
const TARGET_CHANGE_PROOF_REASONS = ["flow-proof-changed", "selector-evidence-changed"] as const;
const TARGET_CHANGE_SEMANTIC_REASONS = ["model-digest-changed", "semantic-fingerprint-changed"] as const;

/**
 * The one precedence rule of a target change: blocked > proof-change (`proofChanged === true`) >
 * baseline-missing > semantic-change > output-change > unchanged. A known proof change is never
 * hidden by an unknown comparison (a target without a committed row can still carry a moved flow
 * proof); an unknown comparison outranks everything below the proof change and is never `unchanged`.
 */
export function projectionTargetChangeClassification(
  input: Pick<ProjectionTargetChangeV2, "reasonCodes" | "outputChanged" | "semanticChanged" | "proofChanged">
): ProjectionTargetChangeClassification {
  if (input.reasonCodes.some((code) => TARGET_CHANGE_BLOCKING_REASONS.has(code))) return "blocked";
  if (input.proofChanged === true) return "proof-change";
  if (input.semanticChanged === null || input.proofChanged === null) return "baseline-missing";
  if (input.semanticChanged) return "semantic-change";
  if (input.outputChanged) return "output-change";
  return "unchanged";
}

/**
 * Shape, canonical order and internal consistency of a result's `changes`, and their binding to its
 * `files`: a change with a planned action names the `files[]` entry of its path with that action; a
 * `files[]` entry a change names but does not plan is a path rejected for adoption or ownership
 * repair, so that change is blocked by that rejection, and still reports the bytes that entry
 * changes (`outputChanged`). Every `files[]` entry that changes a file has a change of its path,
 * except the projection manifest, which is never a target.
 *
 * One entry per target: `targetId` is unique, and entries are ordered by path, then targetId. Only
 * agent-context targets share a path, because several nodes' regions live in one contract file
 * (ADR-0056 §9).
 */
export function projectionTargetChangesIssues(input: readonly ProjectionTargetChangeV2[], files: readonly ProjectionFileResultV1[] = []): string[] {
  const issues: string[] = new Set(input.map((entry) => entry.targetId)).size === input.length ? [] : ["changes.targetId must be unique"];
  const order = (entry: ProjectionTargetChangeV2) => `${entry.path}\u0000${entry.targetId}`;
  if (input.some((entry, index) => index > 0 && order(input[index - 1]!) >= order(entry))) issues.push("changes must be ordered by path, then targetId");
  const targetIdsByPath = new Map<string, string[]>();
  for (const entry of input) targetIdsByPath.set(entry.path, [...(targetIdsByPath.get(entry.path) ?? []), entry.targetId]);
  for (const [path, targetIds] of targetIdsByPath) {
    if (targetIds.length > 1 && targetIds.some((targetId) => !isAgentContextTargetId(targetId))) issues.push(`changes.path ${path} is shared by targets that are not all agent-context targets`);
  }
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const reasons = new Set<string>(PROJECTION_TARGET_CHANGE_REASON_CODES);
  for (const [index, entry] of input.entries()) {
    const prefix = `changes[${index}]`;
    const has = (codes: readonly string[]) => codes.some((code) => entry.reasonCodes.includes(code as ProjectionTargetChangeReasonCode));
    if (typeof entry.targetId !== "string" || entry.targetId.trim() === "") issues.push(`${prefix}.targetId must not be empty`);
    if (!isRepoRelativePosixPath(entry.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
    issues.push(...sortedUniqueIssues(`${prefix}.affectedCapabilityIds`, entry.affectedCapabilityIds), ...sortedUniqueIssues(`${prefix}.reasonCodes`, entry.reasonCodes));
    if (entry.affectedCapabilityIds.some((id) => typeof id !== "string" || id.trim() === "")) issues.push(`${prefix}.affectedCapabilityIds must not contain empty ids`);
    const unsupported = entry.reasonCodes.find((code) => !reasons.has(code));
    if (unsupported !== undefined) issues.push(`${prefix}.reasonCodes contains an unsupported code: ${unsupported}`);
    for (const field of ["semanticChanged", "proofChanged"] as const) {
      if (entry[field] !== null && typeof entry[field] !== "boolean") issues.push(`${prefix}.${field} must be a boolean or null`);
    }
    if (typeof entry.outputChanged !== "boolean") issues.push(`${prefix}.outputChanged must be a boolean`);
    if (!(PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS as readonly string[]).includes(entry.plannedAction)) issues.push(`${prefix}.plannedAction is unsupported`);
    if ((entry.semanticChanged === true) !== has(TARGET_CHANGE_SEMANTIC_REASONS)) issues.push(`${prefix}.semanticChanged must be true exactly when semantic-fingerprint-changed or model-digest-changed is reported`);
    if ((entry.proofChanged === true) !== has(TARGET_CHANGE_PROOF_REASONS)) issues.push(`${prefix}.proofChanged must be true exactly when flow-proof-changed or selector-evidence-changed is reported`);
    if (entry.outputChanged !== has(TARGET_CHANGE_OUTPUT_REASONS)) issues.push(`${prefix}.outputChanged must be true exactly when an output reason code is reported`);
    if ((entry.semanticChanged === null || entry.proofChanged === null) !== has(TARGET_CHANGE_UNKNOWN_REASONS)) {
      issues.push(`${prefix} must report baseline-missing or target-row-missing exactly when a comparison is unknown`);
    }
    const derived = projectionTargetChangeClassification(entry);
    if (entry.classification !== derived) issues.push(`${prefix}.classification must be ${derived} for its comparisons and reason codes`);
    if ((entry.classification === "unchanged") !== (entry.reasonCodes.length === 0)) issues.push(`${prefix}.reasonCodes must be empty exactly when classification is unchanged`);
    if (entry.classification === "unchanged" && entry.affectedCapabilityIds.length > 0) issues.push(`${prefix} is unchanged, so affectedCapabilityIds must be empty`);
    if (entry.classification === "blocked" && entry.plannedAction !== "none") issues.push(`${prefix} is blocked, so plannedAction must be none`);
    if (entry.plannedAction !== "none" && entry.outputChanged !== true) issues.push(`${prefix} writes its file, so outputChanged must be true`);
    if (entry.path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH) issues.push(`${prefix} names the projection manifest, which is not a target`);
    const file = fileByPath.get(entry.path);
    const fileAction = file === undefined || file.action === "unchanged" ? "none" : file.action;
    const rejected = has(["adoption-required", "ambiguous-ownership"]);
    if (entry.plannedAction !== fileAction && !(rejected && entry.plannedAction === "none" && fileAction === "update")) {
      issues.push(`${prefix}.plannedAction must be ${fileAction}, the files[] action for ${entry.path}`);
    }
    // The file result proves the bytes change, whether or not this run may write them.
    if (fileAction !== "none" && entry.outputChanged !== true) issues.push(`${prefix}.outputChanged must be true, the files[] entry for ${entry.path} changes its bytes`);
  }
  const changedPaths = new Set(input.map((entry) => entry.path));
  for (const file of files) {
    if (file.action === "unchanged" || file.path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH || changedPaths.has(file.path)) continue;
    issues.push(`changes must name the files[] ${file.action} of ${file.path}; only the projection manifest has none`);
  }
  return issues;
}

/** The targetId shape of an agent-context target: `projection_target.agent-context.<agents|claude>.<node>`. */
function isAgentContextTargetId(targetId: unknown): boolean {
  return typeof targetId === "string" && /^projection_target\.agent-context\.(agents|claude)\.[^.]+$/.test(targetId);
}

export function projectionFreshnessIssues(input: ProjectionFreshnessV2): string[] {
  const issues = [
    ...sortedUniqueIssues("freshness.reasonCodes", input.reasonCodes),
    ...sortedUniqueIssues("freshness.staleTargets.targetId", input.staleTargets.map((target) => target.targetId))
  ];
  const unsupported = input.reasonCodes.find((code) => !(PROJECTION_FRESHNESS_REASON_CODES as readonly string[]).includes(code));
  if (unsupported) issues.push(`freshness.reasonCodes contains an unsupported code: ${unsupported}`);
  if (input.ok !== (input.reasonCodes.length === 0)) issues.push("freshness.ok must be true exactly when reasonCodes is empty");
  if ((input.staleTargets.length > 0) !== input.reasonCodes.includes("projection-output-changed")) {
    issues.push("freshness.staleTargets must be non-empty exactly when projection-output-changed is reported");
  }
  for (const [index, target] of input.staleTargets.entries()) {
    const prefix = `freshness.staleTargets[${index}]`;
    if (target.targetId.trim() === "") issues.push(`${prefix}.targetId must not be empty`);
    if (!isRepoRelativePosixPath(target.path)) issues.push(`${prefix}.path must be a repository-relative POSIX path`);
    const digests = [target.committedOutputDigest, target.renderedOutputDigest];
    if (digests.every((digest) => digest === null)) issues.push(`${prefix} must name at least one digest`);
    else if (digests.some((digest) => digest !== null && !SHA256_DIGEST.test(digest))) issues.push(`${prefix} digests must be SHA-256 digests or null`);
    else if (target.committedOutputDigest === target.renderedOutputDigest) issues.push(`${prefix} must name two different digests`);
  }
  return issues;
}

export function projectionArchitectureDebtIssues(input: ProjectionArchitectureDebtV1): string[] {
  const issues = [
    ...sortedUniqueIssues("architectureDebt.coverageReasonCodes", input.coverageReasonCodes),
    ...sortedUniqueIssues("architectureDebt.items", input.items.map((item) => JSON.stringify([item.fromCapabilityId, item.toCapabilityId])))
  ];
  if (!(["complete", "partial", "unknown"] as const).includes(input.coverage)) issues.push("architectureDebt.coverage is unsupported");
  const unsupported = input.coverageReasonCodes.find((code) => !(PROJECTION_ARCHITECTURE_DEBT_COVERAGE_REASON_CODES as readonly string[]).includes(code));
  if (unsupported) issues.push(`architectureDebt.coverageReasonCodes contains an unsupported code: ${unsupported}`);
  if ((input.coverage === "complete") !== (input.coverageReasonCodes.length === 0)) {
    issues.push("architectureDebt.coverageReasonCodes must be empty exactly when coverage is complete");
  }
  if ((input.coverage === "unknown") !== input.coverageReasonCodes.includes("code-facts-unavailable")) {
    issues.push("architectureDebt.coverage must be unknown exactly when code-facts-unavailable is reported");
  }
  if (input.coverage === "unknown" && input.items.length > 0) issues.push("architectureDebt.items must be empty when coverage is unknown");
  for (const [index, item] of input.items.entries()) {
    const prefix = `architectureDebt.items[${index}]`;
    if (!(PROJECTION_ARCHITECTURE_DEBT_REASON_CODES as readonly string[]).includes(item.reasonCode)) issues.push(`${prefix}.reasonCode is unsupported`);
    if (item.fromCapabilityId.trim() === "" || item.toCapabilityId.trim() === "") issues.push(`${prefix} must name two capabilities`);
    else if (item.fromCapabilityId === item.toCapabilityId) issues.push(`${prefix} must name two different capabilities`);
    if (!Number.isSafeInteger(item.importEdgeCount) || item.importEdgeCount < 1) issues.push(`${prefix}.importEdgeCount must be a positive integer`);
  }
  return issues;
}

export function projectionPriorCommittedAppliesIssues(
  input: readonly ProjectionPriorCommittedApplyV1[],
  requestId: string
): string[] {
  const issues = sortedUniqueIssues("priorCommittedApplies.changeSetId", input.map((entry) => entry.changeSetId));
  if (input.length === 0) issues.push("priorCommittedApplies must be omitted instead of empty");
  for (const [index, entry] of input.entries()) {
    const prefix = `priorCommittedApplies[${index}]`;
    issues.push(...sortedUniqueIssues(`${prefix}.files.path`, entry.files.map((file) => file.path)));
    if (entry.requestId !== requestId) issues.push(`${prefix}.requestId must match the projection result requestId`);
    if (entry.changeSetId.trim() === "") issues.push(`${prefix}.changeSetId must not be empty`);
    if (!ISO_INSTANT.test(entry.committedAt)) issues.push(`${prefix}.committedAt must be an ISO-8601 UTC instant`);
    if (entry.files.length === 0) issues.push(`${prefix}.files must name at least one committed file`);
    if ((entry.applyId === undefined) !== (entry.lookupKey === undefined)) {
      issues.push(`${prefix}.applyId and lookupKey must be present together or both absent`);
    }
    for (const field of ["applyId", "lookupKey"] as const) {
      const value = entry[field];
      if (value !== undefined && !SHA256_DIGEST.test(value)) issues.push(`${prefix}.${field} must be a SHA-256 digest`);
    }
    for (const [fileIndex, file] of entry.files.entries()) {
      const filePrefix = `${prefix}.files[${fileIndex}]`;
      if (!isRepoRelativePosixPath(file.path)) issues.push(`${filePrefix}.path must be a repository-relative POSIX path`);
      if (!(PROJECTION_PRIOR_COMMITTED_APPLY_OPERATIONS as readonly string[]).includes(file.operation)) {
        issues.push(`${filePrefix}.operation must be a supported committed operation`);
      }
      const expectsMissing = file.operation === "delete";
      if (expectsMissing && file.hash !== "missing") issues.push(`${filePrefix}.hash must be "missing" for a delete`);
      if (!expectsMissing && !SHA256_DIGEST.test(file.hash)) issues.push(`${filePrefix}.hash must be a SHA-256 body digest`);
    }
  }
  return issues;
}

/**
 * Computes the accepted projection receipt. Signal back-references are omitted from the
 * receipt payload to avoid a circular hash; every signal must then bind that receipt via
 * projectionReceiptDigest, which projectionResultInvariantIssues verifies.
 */
export function projectionResultReceiptDigest(input: Omit<ProjectionResultV3, "receiptDigest">): Sha256Digest {
  const { replayed: _replayed, written: _written, ...payload } = input;
  const refreshSignals = payload.refreshSignals.map(({ projectionReceiptDigest: _projectionReceiptDigest, ...signal }) => signal);
  return digestJson({ ...payload, refreshSignals } as unknown as Json) as Sha256Digest;
}
