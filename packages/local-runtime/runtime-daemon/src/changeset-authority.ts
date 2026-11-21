import { modelValidationFailureDetails, FailureError, digestJson, okEnvelope, type Json, type JsonEnvelope, type ModelStorePort, type PracticeWaiverV1, type RepositorySnapshot, type WorkspaceRef } from "@archcontext/contracts";
import { canonicalRepositoryRoot, computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { changeSetBaseModelBlockingErrors, projectionPreimageFindings, type ChangeOperation, type ChangeSetDraft, type ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { loadPracticeWaiverOwnerRegistry, validatePracticeWaiver } from "@archcontext/core/practice-engine";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import type { RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planOwnershipDelta } from "./ownership-delta-preview";
import { assertProjectionInvocationSnapshot, projectionInvocationWrites, validateProjectionInvocation, type RuntimeProjectionInvocation } from "./projection-service";
import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import type { RuntimeApplyUpdateInput, RuntimePlanUpdateInput, RuntimePracticeWaiverInput, RuntimeWorktreeDigestProfile } from "./runtime-types";

type RepositorySession = { workspace: WorkspaceRef; snapshot: RepositorySnapshot };
const CHANGESET_DRAFTS_CACHE_NAMESPACE = "changeset_drafts";

interface CachedChangeSetDraft {
  draft: ChangeSetDraft;
  root: string;
  worktreeDigestProfile: RuntimeWorktreeDigestProfile;
}

interface ChangeSetAuthorityContext {
  assertRunning(): void;
  clock(): string;
  openSession(root: string): Promise<RepositorySession>;
  withWriter<T>(run: () => Promise<T>): Promise<T>;
  assertWriterHeld(): void;
  projection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope>;
  readModelStore: ModelStorePort;
  changeSetEngine: Pick<ChangeSetEngine, "plan" | "preview" | "approve" | "apply">;
  localStore: Pick<RuntimeLocalStore, "readCacheEntry" | "writeCacheEntry" | "deleteCacheEntry">;
}

class RuntimeUpdateInputError extends Error {}

function decodeRuntimeWorktreeDigestProfile(value: unknown, field: string): RuntimeWorktreeDigestProfile {
  if (value === "repository" || value === "architecture-documentation-projection") return value;
  throw new RuntimeUpdateInputError(`${field} must be repository or architecture-documentation-projection`);
}

function runtimeUpdateInputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeUpdateInputError(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function decodeRuntimePlanUpdateInput(value: unknown): RuntimePlanUpdateInput {
  const input = runtimeUpdateInputRecord(value, "plan_update input");
  if (typeof input.id !== "string" || input.id.length === 0) throw new RuntimeUpdateInputError("plan_update id must be a non-empty string");
  if (!Array.isArray(input.operations)) throw new RuntimeUpdateInputError("plan_update operations must be an array");
  if (input.operations.some((op) => op !== null && typeof op === "object" && (op as { op?: unknown }).op === "write_refactor_decision")) {
    throw new RuntimeUpdateInputError("plan_update cannot carry write_refactor_decision; use archctx recommendations <verb>");
  }
  let worktreeDigestPrecondition: RuntimePlanUpdateInput["worktreeDigestPrecondition"];
  if (input.worktreeDigestPrecondition !== undefined) {
    const pre = runtimeUpdateInputRecord(input.worktreeDigestPrecondition, "plan_update worktreeDigestPrecondition");
    if (decodeRuntimeWorktreeDigestProfile(pre.profile, "plan_update worktreeDigestPrecondition.profile") !== "architecture-documentation-projection") {
      throw new RuntimeUpdateInputError("plan_update worktreeDigestPrecondition.profile must be architecture-documentation-projection");
    }
    if (typeof pre.expectedDigest !== "string" || pre.expectedDigest.length === 0) {
      throw new RuntimeUpdateInputError("plan_update worktreeDigestPrecondition.expectedDigest must be a non-empty string");
    }
    worktreeDigestPrecondition = { profile: "architecture-documentation-projection", expectedDigest: pre.expectedDigest };
  }
  return {
    id: input.id,
    operations: input.operations as ChangeOperation[],
    ...(input.reason === undefined ? {} : { reason: input.reason as RuntimePlanUpdateInput["reason"] }),
    ...(worktreeDigestPrecondition === undefined ? {} : { worktreeDigestPrecondition })
  };
}

function decodeRuntimeApplyUpdateInput(value: unknown): RuntimeApplyUpdateInput {
  const input = runtimeUpdateInputRecord(value, "apply_update input");
  if (typeof input.id !== "string" || input.id.length === 0) throw new RuntimeUpdateInputError("apply_update id must be a non-empty string");
  if (typeof input.approved !== "boolean") throw new RuntimeUpdateInputError("apply_update approved must be a boolean");
  if (typeof input.expectedWorktreeDigest !== "string" || input.expectedWorktreeDigest.length === 0) {
    throw new RuntimeUpdateInputError("apply_update expectedWorktreeDigest must be a non-empty string");
  }
  const worktreeDigestProfile = input.worktreeDigestProfile === undefined
    ? undefined
    : decodeRuntimeWorktreeDigestProfile(input.worktreeDigestProfile, "apply_update worktreeDigestProfile");
  return { id: input.id, approved: input.approved, expectedWorktreeDigest: input.expectedWorktreeDigest, ...(worktreeDigestProfile === undefined ? {} : { worktreeDigestProfile }) };
}

/** Owns atomic in-process ChangeSet plan/apply operations against Git-visible YAML and projection files. */
export class ChangeSetAuthorityService {
  private readonly changesets = new Map<string, ChangeSetDraft>();
  private readonly changeSetRoots = new Map<string, string>();
  private readonly changeSetWorktreeDigestProfiles = new Map<string, RuntimeWorktreeDigestProfile>();

  constructor(private readonly context: ChangeSetAuthorityContext) {}

  async planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope> {
    try {
      this.context.assertRunning();
      const session = await this.context.openSession(root);
      const model = await this.context.readModelStore.validateModel(session.workspace);
      let ownerRegistry: ReturnType<typeof loadPracticeWaiverOwnerRegistry>;
      try { ownerRegistry = loadPracticeWaiverOwnerRegistry(session.workspace.root); }
      catch { return publicFailureEnvelope("practices.waive", "AC_SCHEMA_INVALID", "waiver-owner-registry-invalid"); }
      const waiver: PracticeWaiverV1 = {
        schemaVersion: "archcontext.practice-waiver/v1",
        practiceId: input.practiceId,
        ...(input.checkId === undefined ? {} : { checkId: input.checkId }),
        scope: {
          ...(input.pathGlobs?.length ? { pathGlobs: input.pathGlobs } : {}),
          ...(input.subjects?.length ? { subjects: input.subjects } : {})
        },
        owner: input.owner,
        reason: input.reason,
        createdAt: input.createdAt ?? this.context.clock(),
        reviewAt: input.reviewAt,
        expiresAt: input.expiresAt,
        evidenceDigest: input.evidenceDigest
      };
      let waiverId: string;
      try {
        validatePracticeWaiver(waiver, "practice waiver input", { allowedOwners: ownerRegistry.owners });
        waiverId = safePracticeWaiverId(input.waiverId, waiver);
      } catch {
        return publicFailureEnvelope("practices.waive", "AC_SCHEMA_INVALID", "waiver-input-invalid");
      }
      const path = `.archcontext/waivers/${waiverId}.json`;
      const absolute = resolve(session.workspace.root, path);
      const body = `${JSON.stringify(waiver, null, 2)}\n`;
      const expectedHash = existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
      const draft = this.context.changeSetEngine.plan({
        id: input.id ?? `changeset.practice-waiver-${waiverId.replace(/[^A-Za-z0-9_-]/g, "-")}`,
        base: { headSha: session.workspace.headSha, worktreeDigest: session.snapshot.worktreeDigest, modelDigest: model.modelDigest },
        reason: { taskSessionId: input.taskSessionId ?? "task_runtime" },
        operations: [{ op: "write_waiver", path, expectedHash, body }]
      });
      this.changesets.set(draft.id, draft);
      this.changeSetRoots.set(draft.id, canonicalRepositoryRoot(root));
      this.changeSetWorktreeDigestProfiles.set(draft.id, "repository");
      await this.context.localStore.writeCacheEntry(CHANGESET_DRAFTS_CACHE_NAMESPACE, draft.id, {
        draft,
        root: canonicalRepositoryRoot(root),
        worktreeDigestProfile: "repository"
      } satisfies CachedChangeSetDraft);
      return okEnvelope("practices.waive", {
        schemaVersion: "archcontext.practice-waiver-plan/v1",
        waiver,
        waiverDigest: digestJson(waiver as unknown as Json),
        ownerRegistry,
        path,
        draft,
        preview: this.context.changeSetEngine.preview(session.workspace.root, draft)
      } as unknown as Json);
    } catch (error) { throw publicOperationFailure(error); }
  }

  async planUpdate(root: string, rawInput: RuntimePlanUpdateInput): Promise<JsonEnvelope> {
    try { return publicOperationResult("plan_update", await this.planUpdateUnchecked(root, rawInput)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async planUpdateUnchecked(root: string, rawInput: RuntimePlanUpdateInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    let input: RuntimePlanUpdateInput;
    try { input = decodeRuntimePlanUpdateInput(rawInput); }
    catch (error) {
      if (error instanceof RuntimeUpdateInputError) return publicFailureEnvelope("plan_update", "AC_SCHEMA_INVALID", "plan-input-invalid", {});
      throw error;
    }
    const session = await this.context.openSession(root);
    const model = await this.context.readModelStore.validateModel(session.workspace);
    const worktreeDigestProfile: RuntimeWorktreeDigestProfile = input.worktreeDigestPrecondition?.profile ?? "repository";
    const worktreeDigest = runtimeWorktreeDigest(root, worktreeDigestProfile);
    if (input.worktreeDigestPrecondition && input.worktreeDigestPrecondition.expectedDigest !== worktreeDigest) {
      throw new FailureError("AC_PRECONDITION_FAILED", "plan-worktree-changed", { expectedWorktreeDigest: input.worktreeDigestPrecondition.expectedDigest, actualWorktreeDigest: worktreeDigest });
    }
    const draft = this.context.changeSetEngine.plan({
      id: input.id,
      base: { headSha: session.workspace.headSha, worktreeDigest, modelDigest: model.modelDigest },
      reason: input.reason ?? { taskSessionId: "task_runtime" },
      operations: input.operations
    });
    const baseErrors = changeSetBaseModelBlockingErrors(model, draft);
    if (baseErrors.length > 0) throw new FailureError("AC_PRECONDITION_FAILED", "plan-model-invalid", modelValidationFailureDetails(model, baseErrors));
    this.changesets.set(draft.id, draft);
    this.changeSetRoots.set(draft.id, canonicalRepositoryRoot(root));
    this.changeSetWorktreeDigestProfiles.set(draft.id, worktreeDigestProfile);
    await this.context.localStore.writeCacheEntry(CHANGESET_DRAFTS_CACHE_NAMESPACE, draft.id, {
      draft,
      root: canonicalRepositoryRoot(root),
      worktreeDigestProfile
    } satisfies CachedChangeSetDraft);
    const ownershipDelta = planOwnershipDelta(root, draft);
    return okEnvelope("plan_update", {
      draft,
      changeSetDigest: digestJson(draft as unknown as Json),
      preview: { ...this.context.changeSetEngine.preview(root, draft), ...(ownershipDelta === undefined ? {} : { ownershipDelta }) }
    } as unknown as Json);
  }

  async mcpProjection(root: string, input: RuntimeProjectionInvocation, approved: boolean): Promise<JsonEnvelope> {
    try {
      this.context.assertRunning();
      try { validateProjectionInvocation(input); }
      catch { return publicFailureEnvelope("projection", "AC_SCHEMA_INVALID", "projection-input-invalid"); }
      if (projectionInvocationWrites(input)) {
        if (approved !== true) return publicFailureEnvelope("projection", "AC_USER_CONFIRMATION_REQUIRED", "projection-approval-required");
        try { assertProjectionInvocationSnapshot(root, input); }
        catch (error) { return publicOperationErrorEnvelope("projection", error); }
      }
      return await this.context.projection(root, input);
    } catch (error) { throw publicOperationFailure(error); }
  }

  async applyUpdate(root: string, rawInput: RuntimeApplyUpdateInput): Promise<JsonEnvelope> {
    try {
      this.context.assertRunning();
      let input: RuntimeApplyUpdateInput;
      try { input = decodeRuntimeApplyUpdateInput(rawInput); }
      catch (error) {
        if (error instanceof RuntimeUpdateInputError) return publicFailureEnvelope("apply_update", "AC_SCHEMA_INVALID", "apply-input-invalid");
        throw error;
      }
      if (!input.approved) return publicFailureEnvelope("apply_update", "AC_USER_CONFIRMATION_REQUIRED", "apply-approval-required");
      let draft = this.changesets.get(input.id);
      let plannedRoot = this.changeSetRoots.get(input.id);
      let plannedProfile = this.changeSetWorktreeDigestProfiles.get(input.id);
      if (!draft) {
        const cached = await this.context.localStore.readCacheEntry<CachedChangeSetDraft>(CHANGESET_DRAFTS_CACHE_NAMESPACE, input.id);
        if (cached) {
          draft = cached.draft;
          plannedRoot = cached.root;
          plannedProfile = cached.worktreeDigestProfile;
        }
      }
      if (plannedRoot !== undefined && plannedRoot !== canonicalRepositoryRoot(root)) {
        return publicFailureEnvelope("apply_update", "AC_PRECONDITION_FAILED", "apply-repository-mismatch");
      }
      return await this.context.withWriter(async () => {
        if (!draft) throw new FailureError("AC_PRECONDITION_FAILED", "apply-draft-missing", { changeSetId: input.id });
        if (!plannedProfile) throw new FailureError("AC_PRECONDITION_FAILED", "apply-profile-missing");
        if ((input.worktreeDigestProfile ?? "repository") !== plannedProfile) throw new FailureError("AC_PRECONDITION_FAILED", "apply-profile-changed");
        const current = runtimeWorktreeDigest(root, plannedProfile);
        if (current !== input.expectedWorktreeDigest) throw new FailureError("AC_PRECONDITION_FAILED", "apply-worktree-changed", { expectedWorktreeDigest: input.expectedWorktreeDigest, actualWorktreeDigest: current });
        const session = await this.context.openSession(root);
        if (draft.base.headSha !== session.workspace.headSha) throw new FailureError("AC_PRECONDITION_FAILED", "apply-head-changed", { expectedHeadSha: draft.base.headSha, actualHeadSha: session.workspace.headSha });
        if (draft.base.worktreeDigest !== current) throw new FailureError("AC_PRECONDITION_FAILED", "apply-worktree-changed", { expectedWorktreeDigest: draft.base.worktreeDigest, actualWorktreeDigest: current });
        const currentModel = await this.context.readModelStore.validateModel(session.workspace);
        const baseErrors = changeSetBaseModelBlockingErrors(currentModel, draft);
        if (baseErrors.length > 0) throw new FailureError("AC_PRECONDITION_FAILED", "apply-model-invalid", modelValidationFailureDetails(currentModel, baseErrors));
        if (draft.base.modelDigest !== currentModel.modelDigest) throw new FailureError("AC_PRECONDITION_FAILED", "apply-model-changed", { expectedModelDigest: draft.base.modelDigest, actualModelDigest: currentModel.modelDigest });
        const stalePreimages = projectionPreimageFindings(root, draft);
        if (stalePreimages.length > 0) return publicFailureEnvelope("apply_update", "AC_PRECONDITION_FAILED", "apply-preimage-changed", { issueCount: stalePreimages.length });
        const result = await this.context.changeSetEngine.apply(root, this.context.changeSetEngine.approve(draft), { approved: true });
        this.changesets.delete(input.id);
        this.changeSetRoots.delete(input.id);
        this.changeSetWorktreeDigestProfiles.delete(input.id);
        await this.context.localStore.deleteCacheEntry(CHANGESET_DRAFTS_CACHE_NAMESPACE, input.id);
        return okEnvelope("apply_update", { ...result } as unknown as Json);
      });
    } catch (error) { throw publicOperationFailure(error); }
  }

  async applyRefactorDecisionWithinWriter(
    root: string,
    writes: { path: string; expectedHash: string; body: string }[],
    afterValidated?: () => Promise<void>
  ): Promise<{ changeSetId: string }> {
    this.context.assertRunning();
    this.context.assertWriterHeld();
    if (writes.length === 0) throw new Error("refactor decision ChangeSet requires at least one decision write");
    const session = await this.context.openSession(root);
    const model = await this.context.readModelStore.validateModel(session.workspace);
    const operations: ChangeOperation[] = writes.map((write) => ({ op: "write_refactor_decision", path: write.path, expectedHash: write.expectedHash, body: write.body }));
    const changeSetId = `changeset.refactor-decision-${digestJson({ operations: operations as unknown as Json }).slice("sha256:".length, "sha256:".length + 16)}`;
    const draft = this.context.changeSetEngine.plan({
      id: changeSetId,
      base: { headSha: session.workspace.headSha, worktreeDigest: computeWorktreeDigest(root, listGitVisibleFiles(root)), modelDigest: model.modelDigest },
      reason: { taskSessionId: "task_refactor_decision" },
      operations
    });
    const preview = this.context.changeSetEngine.preview(root, draft);
    if (!preview.allowed) throw new Error(`refactor decision ChangeSet refused: ${preview.findings.join("; ")}`);
    await this.context.changeSetEngine.apply(root, this.context.changeSetEngine.approve(draft), {
      approved: true,
      afterModelValidatedBeforeCommit: async () => {
        await afterValidated?.();
        return { journalCommitted: false };
      }
    });
    return { changeSetId };
  }
}

export function runtimeWorktreeDigest(root: string, profile: RuntimeWorktreeDigestProfile): string {
  switch (profile) {
    case "repository": return computeWorktreeDigest(root, listGitVisibleFiles(root));
    case "architecture-documentation-projection": return architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root));
    default: throw new RuntimeUpdateInputError(`unsupported worktree digest profile: ${String(profile)}`);
  }
}

function safePracticeWaiverId(explicit: string | undefined, waiver: PracticeWaiverV1): string {
  const explicitTrimmed = explicit?.trim();
  if (explicitTrimmed && (explicitTrimmed === "." || explicitTrimmed === ".." || explicitTrimmed.includes("/") || explicitTrimmed.includes("\\"))) {
    throw new Error("practice-waiver-id-invalid");
  }
  const evidencePrefix = waiver.evidenceDigest.startsWith("sha256:")
    ? waiver.evidenceDigest.slice("sha256:".length, "sha256:".length + 12)
    : waiver.evidenceDigest.slice(0, 12);
  const candidate = (explicitTrimmed || [waiver.practiceId.replace(/\./g, "-"), waiver.checkId ?? "all", evidencePrefix].join("-"))
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!candidate || candidate === "." || candidate === ".." || candidate.includes("/") || candidate.includes("\\")) {
    throw new Error("practice-waiver-id-invalid");
  }
  return candidate;
}
