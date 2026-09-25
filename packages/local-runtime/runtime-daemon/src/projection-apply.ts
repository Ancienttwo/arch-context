import { PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION, digestJson, errorEnvelope, okEnvelope, projectionApplyLookupKey, projectionApplyAbsenceInvariantIssues, projectionApplyReadbackRequestInvariantIssues, projectionApplyReadbackResultDigest, projectionApplyReadbackResultInvariantIssues, projectionApplyRecoveryIntentInvariantIssues, projectionApplyRecoveryProofDigest, projectionPriorCommittedAppliesIssues, type Json, type JsonEnvelope, type WorkspaceRef, type ProjectionApplyAbsenceV1, type ProjectionApplyReadbackResultV1, type ProjectionRequestV1, type ProjectionApplyRecoveryIntentV1, type ProjectionPriorCommittedApplyV1, type ProjectionApplyReceiptV1, type ProjectionApplyRecoveryProofV1 } from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { REPO_HARNESS_PROJECTION_PROFILE, architectureDocumentationSourceDigest, architectureDocumentationProjectionWorktreeDigest, assertArchitectureProjectionVerifiedAgainst, loadArchitectureDocumentationInputs, loadCapabilitySourceScaleSignals, renderArchitectureDocumentationProjection, type NativeModel, type CapabilitySourceChangeSinceStamp } from "@archcontext/core/projection-engine";
import { prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { readHeadSha } from "@archcontext/local-runtime/git-adapter";
import type { RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { projectionWorkspaceId as runtimeProjectionWorkspaceId, readCurrentBranch, readHeadCommittedAt } from "./projection-inputs";

interface ProjectionApplyContext {
  assertRunning(): void;
  openSession(root: string): Promise<{ workspace: WorkspaceRef }>;
  withWriter<T>(run: () => Promise<T>): Promise<T>;
  localStore: Pick<RuntimeLocalStore, "inspectProjectionApplyReceipt" | "listCommittedChangeSetsForTaskSession" | "consumeProjectionApplyReceiptRecovery">;
  worktreeDigest(root: string, profile: "architecture-documentation-projection"): string;
  loadSourceChanges(root: string, model: NativeModel): CapabilitySourceChangeSinceStamp[];
}

export class ProjectionApplyService {
  constructor(private readonly context: ProjectionApplyContext) {}

  async inspectProjectionApplyReceipt(root: string, lookupKey: string): Promise<JsonEnvelope> {
    this.context.assertRunning();
    await this.context.openSession(root);
    const inspection = await this.context.localStore.inspectProjectionApplyReceipt(lookupKey);
    return okEnvelope("projection.inspect-receipt", {
      found: inspection !== undefined,
      ...(inspection ?? {})
    } as unknown as Json);
  }

  /**
   * Names the ChangeSets an earlier attempt of `requestId` already committed for this root. The CLI
   * is a short-lived RPC client, so a caller killed after this daemon committed cannot otherwise
   * learn that projection-owned files were written under its own request.
   */
  async listProjectionPriorCommittedApplies(root: string, requestId: string): Promise<JsonEnvelope> {
    this.context.assertRunning();
    // The journal owns historical commits; opening a current source session
    // would hash unrelated workspace/runtime bytes before this read.
    let committed: Awaited<ReturnType<RuntimeLocalStore["listCommittedChangeSetsForTaskSession"]>>;
    try {
      committed = await this.context.localStore.listCommittedChangeSetsForTaskSession(root, requestId);
    } catch (error) {
      return errorEnvelope(
        "projection.prior-committed-applies",
        "AC_PRECONDITION_FAILED",
        error instanceof Error ? error.message : String(error)
      );
    }
    // changeset_journal is keyed by journal_id, not changeset_id, and the projection protocol derives
    // its changeSetId from the projection digest. Two killed-then-retried attempts of the same
    // request therefore commit two journal rows carrying one changeSetId, which the wire contract's
    // sorted-unique changeSetId invariant would reject — permanently failing every later run for
    // that requestId. Collapsing them is lossless: an equal changeSetId means an equal projection
    // digest, so both rows declare the same output file set; only the commit instant differs. The
    // store hands rows back ordered by committedAt then journal id, so upserting into an
    // insertion-ordered map keeps the latest commit of each changeSetId with that same tie-break.
    const byChangeSetId = new Map<string, ProjectionPriorCommittedApplyV1>();
    for (const entry of committed) {
      if (entry.files.length === 0) continue;
      byChangeSetId.set(entry.changeSetId, {
        ...(entry.applyId === undefined || entry.lookupKey === undefined
          ? {}
          : { applyId: entry.applyId as ProjectionPriorCommittedApplyV1["applyId"], lookupKey: entry.lookupKey as ProjectionPriorCommittedApplyV1["lookupKey"] }),
        requestId,
        changeSetId: entry.changeSetId,
        committedAt: entry.committedAt,
        files: entry.files
      });
    }
    const applies: ProjectionPriorCommittedApplyV1[] = [...byChangeSetId.values()]
      .sort((left, right) => left.changeSetId < right.changeSetId ? -1 : left.changeSetId > right.changeSetId ? 1 : 0);
    const issues = applies.length === 0 ? [] : projectionPriorCommittedAppliesIssues(applies, requestId);
    if (issues.length > 0) {
      return errorEnvelope(
        "projection.prior-committed-applies",
        "AC_SCHEMA_INVALID",
        `projection prior committed applies invariant failed: ${issues.join("; ")}`
      );
    }
    return okEnvelope("projection.prior-committed-applies", { applies } as unknown as Json);
  }

  async readbackProjectionApply(root: string, request: ProjectionRequestV1): Promise<JsonEnvelope> {
    this.context.assertRunning();
    try {
      const issues = projectionApplyReadbackRequestInvariantIssues(request);
      if (issues.length > 0) return errorEnvelope("projection.readback", "AC_SCHEMA_INVALID", issues.join("; "));
    } catch (error) {
      return errorEnvelope("projection.readback", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    return this.context.withWriter(async () => {
      try {
        const session = await this.context.openSession(root);
        const inspection = await this.context.localStore.inspectProjectionApplyReceipt(projectionApplyLookupKey({
          repositoryId: request.expected.repositoryId,
          workspaceId: request.expected.workspaceId,
          acceptedChange: request.acceptedChange!
        }));
        if (!inspection) {
          const body = {
            schemaVersion: "archcontext.projection-apply-absence/v1" as const,
            requestId: request.requestId,
            requestDigest: digestJson(request as unknown as Json) as ProjectionApplyAbsenceV1["requestDigest"],
            lookupKey: projectionApplyLookupKey({ repositoryId: request.expected.repositoryId, workspaceId: request.expected.workspaceId, acceptedChange: request.acceptedChange! }),
            current: {
              repositoryId: session.workspace.repositoryId,
              workspaceId: runtimeProjectionWorkspaceId(root),
              headSha: readHeadSha(root),
              worktreeDigest: this.context.worktreeDigest(root, "architecture-documentation-projection") as ProjectionApplyAbsenceV1["current"]["worktreeDigest"]
            }
          };
          const absence: ProjectionApplyAbsenceV1 = { ...body, absenceDigest: digestJson(body as unknown as Json) as ProjectionApplyAbsenceV1["absenceDigest"] };
          const issues = projectionApplyAbsenceInvariantIssues(absence, request);
          return issues.length === 0
            ? okEnvelope("projection.readback", absence as unknown as Json)
            : errorEnvelope("projection.readback", "AC_PRECONDITION_FAILED", issues.join("; "));
        }
        const receipt = inspection.receipt;
        const fixedPoint = buildRuntimeProjectionRecoveryFixedPoint(root, this.context.loadSourceChanges);
        const issues = runtimeProjectionRecoveryFixedPointIssues(receipt, fixedPoint);
        if (issues.length > 0) return errorEnvelope("projection.readback", "AC_PRECONDITION_FAILED", `projection readback proof failed: ${issues.join("; ")}`);
        const body = {
          schemaVersion: PROJECTION_APPLY_READBACK_RESULT_SCHEMA_VERSION,
          requestId: request.requestId,
          requestDigest: digestJson(request as unknown as Json) as ProjectionApplyReadbackResultV1["requestDigest"],
          receipt,
          current: runtimeProjectionRecoveryCurrent(fixedPoint)
        };
        const result: ProjectionApplyReadbackResultV1 = { ...body, readbackDigest: projectionApplyReadbackResultDigest(body) };
        const resultIssues = projectionApplyReadbackResultInvariantIssues(result, request);
        if (session.workspace.repositoryId !== result.current.snapshot.repositoryId
          || session.workspace.headSha !== result.current.snapshot.headSha
          || this.context.worktreeDigest(root, "architecture-documentation-projection") !== result.current.snapshot.worktreeDigest) {
          resultIssues.push("projection readback authority changed before response");
        }
        if (resultIssues.length > 0) return errorEnvelope("projection.readback", "AC_PRECONDITION_FAILED", resultIssues.join("; "));
        // Reading original evidence never consumes or rewrites its delivery checkpoint.
        return okEnvelope("projection.readback", result as unknown as Json);
      } catch (error) {
        return errorEnvelope("projection.readback", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
      }
    });
  }

  async recoverProjectionApply(root: string, intent: ProjectionApplyRecoveryIntentV1): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const intentIssues = projectionApplyRecoveryIntentInvariantIssues(intent);
    if (intentIssues.length > 0) {
      return errorEnvelope("projection.recover", "AC_SCHEMA_INVALID", `projection recovery intent invariant failed: ${intentIssues.join("; ")}`);
    }
    return this.context.withWriter(async () => {
      const session = await this.context.openSession(root);
      const inspection = await this.context.localStore.inspectProjectionApplyReceipt(intent.receipt.lookupKey);
      if (!inspection || inspection.receipt.identity.applyId !== intent.receipt.applyId) {
        return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", "committed projection apply receipt was not found");
      }
      if (inspection.deliveryStatus === "delivered") {
        if (!inspection.recoveryProof) {
          return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", "committed projection receipt was delivered without a recovery proof");
        }
        return okEnvelope("projection.recover", {
          found: true,
          receipt: inspection.receipt,
          proof: { ...inspection.recoveryProof, deliveryStatus: "already-delivered" },
          refreshSignalsDelivered: false
        } as unknown as Json);
      }
      let fixedPoint: RuntimeProjectionRecoveryFixedPoint;
      try {
        fixedPoint = buildRuntimeProjectionRecoveryFixedPoint(root, this.context.loadSourceChanges);
      } catch (error) {
        return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
      }
      const issues = runtimeProjectionRecoveryFixedPointIssues(inspection.receipt, fixedPoint);
      if (issues.length > 0) {
        return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", `projection recovery proof failed: ${issues.join("; ")}`);
      }
      const proof = createRuntimeProjectionRecoveryProof(intent, inspection.receipt, fixedPoint);
      const currentWorktreeDigest = this.context.worktreeDigest(root, "architecture-documentation-projection");
      if (session.workspace.repositoryId !== proof.current.snapshot.repositoryId
        || session.workspace.headSha !== proof.current.snapshot.headSha
        || currentWorktreeDigest !== proof.current.snapshot.worktreeDigest) {
        return errorEnvelope("projection.recover", "AC_PRECONDITION_FAILED", "projection recovery authority changed before delivery");
      }
      const consumption = await this.context.localStore.consumeProjectionApplyReceiptRecovery(proof);
      return okEnvelope("projection.recover", {
        found: consumption !== undefined,
        ...(consumption ?? {})
      } as unknown as Json);
    });
  }

}

type RuntimeProjectionRecoveryFixedPoint = {
  projection: ReturnType<typeof renderArchitectureDocumentationProjection>;
  snapshot: ProjectionApplyRecoveryProofV1["current"]["snapshot"];
  ownedOutputDigest: ProjectionApplyRecoveryProofV1["current"]["ownedOutputDigest"];
};

/** Rebuilds recovery semantics from repository authority while the daemon owns the writer. */
function buildRuntimeProjectionRecoveryFixedPoint(root: string, loadSourceChanges: ProjectionApplyContext["loadSourceChanges"]): RuntimeProjectionRecoveryFixedPoint {
  const loaded = loadArchitectureDocumentationInputs(root, REPO_HARNESS_PROJECTION_PROFILE);
  const sourceDigest = architectureDocumentationSourceDigest({
    model: loaded.model,
    profile: REPO_HARNESS_PROJECTION_PROFILE,
    decisions: loaded.decisions
  });
  const codeGraphInputs = prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model);
  const provenance = codeGraphInputs.provenance;
  const projection = renderArchitectureDocumentationProjection({
    model: loaded.model,
    profile: REPO_HARNESS_PROJECTION_PROFILE,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    verifiedAgainst: assertArchitectureProjectionVerifiedAgainst({
      branch: readCurrentBranch(root),
      commit: readHeadSha(root),
      committedAt: readHeadCommittedAt(root)
    }),
    sourceChangesSinceStamp: loadSourceChanges(root, loaded.model),
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model),
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance,
    sourceDigest,
    generatedAt: new Date(0).toISOString(),
    refreshContext: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: runtimeProjectionWorkspaceId(root),
      headSha: provenance.baseHeadSha,
      worktreeDigest: provenance.worktreeDigest
    }
  });
  const snapshot = {
    repositoryId: repositoryFingerprint(root),
    workspaceId: runtimeProjectionWorkspaceId(root),
    headSha: readHeadSha(root),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loaded.model),
    baseHeadSha: projection.provenance.baseHeadSha,
    sourceTreeDigest: projection.provenance.sourceTreeDigest,
    modelDigest: projection.provenance.modelDigest,
    codeGraphDigest: projection.provenance.codeGraphDigest,
    indexedWorktreeDigest: projection.provenance.indexedWorktreeDigest,
    projectionInputDigest: projection.provenance.projectionInputDigest,
    rendererVersion: projection.provenance.rendererVersion,
    layoutVersion: projection.provenance.layoutVersion,
    generatedFrom: projection.provenance.generatedFrom
  } as ProjectionApplyRecoveryProofV1["current"]["snapshot"];
  return {
    projection,
    snapshot,
    ownedOutputDigest: runtimeProjectionOwnedOutputDigest({ files: [...projection.files, projection.manifest] })
  };
}

function runtimeProjectionRecoveryFixedPointIssues(
  receipt: ProjectionApplyReceiptV1,
  fixedPoint: RuntimeProjectionRecoveryFixedPoint
): string[] {
  const binding = receipt.recovery;
  if (!binding) return ["committed projection receipt does not support semantic recovery"];
  const issues: string[] = [];
  const projection = fixedPoint.projection;
  if (!projection.drift.ok || projection.rejected.length > 0) issues.push("projection owned outputs are not a clean fixed point");
  if (projection.majorChange.mode !== "none" || projection.majorChange.reasonCodes.length > 0 || projection.majorChange.affectedNodeIds.length > 0) {
    issues.push("current architecture state contains an unresolved major change");
  }
  if (projection.refreshSignals.length > 0) issues.push("current architecture state has unresolved refresh signals");
  for (const field of ["repositoryId", "workspaceId", "headSha", "worktreeDigest"] as const) {
    if (fixedPoint.snapshot[field] !== binding.originalExpectedSnapshot[field]) {
      issues.push(`current projection snapshot differs from the approved snapshot: ${field}`);
    }
  }
  if (binding.generatedFrom.codeGraphStatus !== "ready") issues.push("approved CodeGraph snapshot is unavailable");
  if (projection.provenance.generatedFrom.codeGraphStatus !== "ready") issues.push("current CodeGraph snapshot is unavailable");
  if (digestJson(projection.architectureDigests as unknown as Json) !== digestJson(binding.expectedResultingDigests as unknown as Json)) {
    issues.push("current model, source, flow-proof, or projection digest differs from the approved result");
  }
  if (projection.provenance.projectionInputDigest !== receipt.result.outputSnapshot.projectionInputDigest
    || projection.provenance.codeGraphDigest !== receipt.result.outputSnapshot.codeGraphDigest
    || projection.provenance.rendererVersion !== binding.rendererVersion
    || projection.provenance.layoutVersion !== binding.layoutVersion
    || digestJson(projection.provenance.generatedFrom as unknown as Json) !== digestJson(binding.generatedFrom as unknown as Json)) {
    issues.push("current renderer, layout, or CodeGraph provenance differs from the approved result");
  }
  if (fixedPoint.ownedOutputDigest !== binding.ownedOutputDigest) issues.push("current projection-owned output bytes differ from the approved result");
  if (fixedPoint.snapshot.generatedFrom.codeGraphStatus !== "ready") issues.push("current proof snapshot requires CodeGraph ready");
  return issues;
}

function runtimeProjectionRecoveryCurrent(fixedPoint: RuntimeProjectionRecoveryFixedPoint): ProjectionApplyRecoveryProofV1["current"] {
  return {
    snapshot: fixedPoint.snapshot,
    resultingDigests: fixedPoint.projection.architectureDigests,
    ownedOutputDigest: fixedPoint.ownedOutputDigest,
    fixedPointDigest: digestJson({
      schemaVersion: "archcontext.projection-apply-recovery-fixed-point/v1",
      snapshot: fixedPoint.snapshot,
      resultingDigests: fixedPoint.projection.architectureDigests,
      ownedOutputDigest: fixedPoint.ownedOutputDigest,
      drift: fixedPoint.projection.drift,
      majorChange: fixedPoint.projection.majorChange,
      refreshSignalIds: fixedPoint.projection.refreshSignals.map((signal) => signal.signalId)
    } as unknown as Json)
  } as ProjectionApplyRecoveryProofV1["current"];
}

function createRuntimeProjectionRecoveryProof(
  intent: ProjectionApplyRecoveryIntentV1,
  receipt: ProjectionApplyReceiptV1,
  fixedPoint: RuntimeProjectionRecoveryFixedPoint
): ProjectionApplyRecoveryProofV1 {
  const current = runtimeProjectionRecoveryCurrent(fixedPoint);
  const payload = {
    schemaVersion: "archcontext.projection-apply-recovery-proof/v1" as const,
    requestId: intent.requestId,
    requestDigest: digestJson(intent as unknown as Json) as ProjectionApplyRecoveryProofV1["requestDigest"],
    receipt: {
      lookupKey: receipt.identity.lookupKey,
      applyId: receipt.identity.applyId,
      receiptDigest: receipt.result.receiptDigest
    },
    acceptedChange: receipt.identity.acceptedChange,
    expectedResultingDigests: receipt.recovery!.expectedResultingDigests,
    current
  };
  return {
    ...payload,
    proofDigest: projectionApplyRecoveryProofDigest(payload),
    deliveryStatus: "delivered"
  };
}

function runtimeProjectionOwnedOutputDigest(projection: { files: Array<{ path: string; body: string }> }): `sha256:${string}` {
  return digestJson({
    schemaVersion: "archcontext.projection-owned-output/v1",
    files: projection.files.map((file) => ({ path: file.path, body: file.body }))
      .sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json) as `sha256:${string}`;
}
