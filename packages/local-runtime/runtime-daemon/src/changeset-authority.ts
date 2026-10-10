import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalRepositoryRoot, computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import type { ChangeOperation, ChangeSetDraft, ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { architectureLedgerStateDigest, planChangeSetApplyToArchitectureLedgerEvent, type ArchitectureLedgerAppendInput, type ArchitectureLedgerAppendResult, type ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { loadPracticeWaiverOwnerRegistry, validatePracticeWaiver } from "@archcontext/core/practice-engine";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { baseModelBlockingErrors, digestJson, errorEnvelope, okEnvelope, type ArchitectureEventV1, type Json, type JsonEnvelope, type ModelStorePort, type PracticeWaiverV1, type ProjectionApplyReceiptV1, type RepositorySnapshot, type WorkspaceRef } from "@archcontext/contracts";
import { runtimeStatePaths, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import { AcceptCommittedChangeInputError, acceptedChangeFromEventV2, acceptedCommittedChangeEventV2, captureModelTransitionBase, decodeAcceptCommittedChangeInput, planCommittedChangeAcceptance, recordModelTransitionEvidence, resolveAcceptanceHeadSha, type AcceptCommittedChangeRequest } from "./committed-change-acceptance";
import type { RuntimeArchitectureLedgerModes, RuntimeArchitectureLedgerWriteMode } from "./ledger-admin";
import { projectionWorkspaceId, readCurrentBranch } from "./projection-inputs";
import { assertProjectionInvocationSnapshot, buildArchitectureDocsProjection, projectionInvocationWrites, validateProjectionInvocation, type ProjectionServiceHost, type RuntimeProjectionInvocation } from "./projection-service";
import type { RuntimeAcceptCommittedChangeInput, RuntimeApplyUpdateInput, RuntimePlanUpdateInput, RuntimePracticeWaiverInput, RuntimeWorktreeDigestProfile } from "./rpc-types";

/** The parts of the daemon's repository session this service reads. */
type RepositorySession = { workspace: WorkspaceRef; snapshot: RepositorySnapshot };

interface ChangeSetAuthorityContext {
  projectionPlannedDrafts: WeakSet<ChangeSetDraft>;
  assertRunning(): void;
  clock(): string;
  openSession(root: string): Promise<RepositorySession>;
  /** The daemon's single writer lock; every ChangeSet apply and acceptance runs inside it. */
  withWriter<T>(run: () => Promise<T>): Promise<T>;
  appendArchitectureEventsWithFeed(root: string, input: ArchitectureLedgerAppendInput, journalId?: string): Promise<ArchitectureLedgerAppendResult>;
  projectionHost(): ProjectionServiceHost;
  projection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope>;
  readModelStore: ModelStorePort;
  localStore: Pick<RuntimeLocalStore, "inspectProjectionApplyReceipt" | "recordProjectionApplyReceipt" | "recordChangeSetProjectionOwner" | "recordChangeSetModelTransition" | "replayArchitectureLedgerEvidence" | "recordChangeSetLedgerPlan" | "readCommittedChangeSet" | "readLatestCommittedChangeSetFile" | "readArchitectureEvent" | "readArchitectureLedgerState">;
  /** The daemon's single ChangeSet engine, shared with ledger-admin. */
  changeSetEngine: Pick<ChangeSetEngine, "plan" | "preview" | "approve" | "apply">;
  architectureLedger: RuntimeArchitectureLedgerModes;
}

class RuntimeUpdateInputError extends Error {}

function decodeRuntimeWorktreeDigestProfile(value: unknown, field: string): RuntimeWorktreeDigestProfile {
  switch (value) {
    case "repository":
    case "architecture-documentation-projection":
      return value;
    default:
      throw new RuntimeUpdateInputError(`${field} must be repository or architecture-documentation-projection`);
  }
}

function decodeRuntimePlanUpdateInput(value: unknown): RuntimePlanUpdateInput {
  const input = runtimeUpdateInputRecord(value, "plan_update input");
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new RuntimeUpdateInputError("plan_update id must be a non-empty string");
  }
  if (!Array.isArray(input.operations)) {
    throw new RuntimeUpdateInputError("plan_update operations must be an array");
  }
  let worktreeDigestPrecondition: RuntimePlanUpdateInput["worktreeDigestPrecondition"];
  if (input.worktreeDigestPrecondition !== undefined) {
    const precondition = runtimeUpdateInputRecord(
      input.worktreeDigestPrecondition,
      "plan_update worktreeDigestPrecondition"
    );
    const profile = decodeRuntimeWorktreeDigestProfile(
      precondition.profile,
      "plan_update worktreeDigestPrecondition.profile"
    );
    if (profile !== "architecture-documentation-projection") {
      throw new RuntimeUpdateInputError(
        "plan_update worktreeDigestPrecondition.profile must be architecture-documentation-projection"
      );
    }
    if (typeof precondition.expectedDigest !== "string" || precondition.expectedDigest.length === 0) {
      throw new RuntimeUpdateInputError(
        "plan_update worktreeDigestPrecondition.expectedDigest must be a non-empty string"
      );
    }
    worktreeDigestPrecondition = { profile, expectedDigest: precondition.expectedDigest };
  }
  return {
    id: input.id,
    operations: input.operations as ChangeOperation[],
    ...(input.reason === undefined
      ? {}
      : { reason: input.reason as RuntimePlanUpdateInput["reason"] }),
    ...(worktreeDigestPrecondition === undefined ? {} : { worktreeDigestPrecondition })
  };
}

function decodeRuntimeApplyUpdateInput(value: unknown): RuntimeApplyUpdateInput {
  const input = runtimeUpdateInputRecord(value, "apply_update input");
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new RuntimeUpdateInputError("apply_update id must be a non-empty string");
  }
  if (typeof input.approved !== "boolean") {
    throw new RuntimeUpdateInputError("apply_update approved must be a boolean");
  }
  if (typeof input.expectedWorktreeDigest !== "string" || input.expectedWorktreeDigest.length === 0) {
    throw new RuntimeUpdateInputError("apply_update expectedWorktreeDigest must be a non-empty string");
  }
  const worktreeDigestProfile = input.worktreeDigestProfile === undefined
    ? undefined
    : decodeRuntimeWorktreeDigestProfile(input.worktreeDigestProfile, "apply_update worktreeDigestProfile");
  return {
    id: input.id,
    approved: input.approved,
    expectedWorktreeDigest: input.expectedWorktreeDigest,
    ...(worktreeDigestProfile === undefined ? {} : { worktreeDigestProfile }),
    ...(input.projectionApplyReceipt === undefined
      ? {}
      : { projectionApplyReceipt: input.projectionApplyReceipt as ProjectionApplyReceiptV1 })
  };
}

function runtimeUpdateInputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeUpdateInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Owns ChangeSet plan/apply authority: the draft maps, the explicit-approval gate shared by CLI and
 * MCP, the applied-change ledger append and committed-change acceptance.
 *
 * The daemon keeps the ChangeSet engine, the writer lock, sessions, the ledger append with its
 * change feed, and `projectionHost`/`projection`, and reaches them here through the context.
 * Member names match the daemon's so the moved bodies are unchanged from the facade.
 */
export class ChangeSetAuthorityService {
  private readonly readModelStore: ModelStorePort;
  private readonly localStore: ChangeSetAuthorityContext["localStore"];
  private readonly changeSetEngine: ChangeSetAuthorityContext["changeSetEngine"];
  private readonly architectureLedger: RuntimeArchitectureLedgerModes;
  private readonly changesets = new Map<string, ChangeSetDraft>();
  private readonly changeSetRoots = new Map<string, string>();
  private readonly changeSetWorktreeDigestProfiles = new Map<string, RuntimeWorktreeDigestProfile>();

  constructor(private readonly context: ChangeSetAuthorityContext) {
    this.readModelStore = context.readModelStore;
    this.localStore = context.localStore;
    this.changeSetEngine = context.changeSetEngine;
    this.architectureLedger = context.architectureLedger;
  }

  async planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const model = await this.readModelStore.validateModel(session.workspace);
    let ownerRegistry: ReturnType<typeof loadPracticeWaiverOwnerRegistry>;
    try {
      ownerRegistry = loadPracticeWaiverOwnerRegistry(session.workspace.root);
    } catch (error) {
      return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    const waiver: PracticeWaiverV1 = {
      schemaVersion: "archcontext.practice-waiver/v1",
      practiceId: input.practiceId,
      ...(input.checkId === undefined ? {} : { checkId: input.checkId }),
      scope: {
        ...(input.pathGlobs && input.pathGlobs.length > 0 ? { pathGlobs: input.pathGlobs } : {}),
        ...(input.subjects && input.subjects.length > 0 ? { subjects: input.subjects } : {})
      },
      owner: input.owner,
      reason: input.reason,
      createdAt: input.createdAt ?? this.clock(),
      reviewAt: input.reviewAt,
      expiresAt: input.expiresAt,
      evidenceDigest: input.evidenceDigest
    };
    let waiverId: string;
    try {
      validatePracticeWaiver(waiver, "practice waiver input", { allowedOwners: ownerRegistry.owners });
      waiverId = safePracticeWaiverId(input.waiverId, waiver);
    } catch (error) {
      return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    const path = `.archcontext/waivers/${waiverId}.json`;
    const absolute = resolve(session.workspace.root, path);
    const body = `${JSON.stringify(waiver, null, 2)}\n`;
    const expectedHash = existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
    const draft = this.changeSetEngine.plan({
      id: input.id ?? `changeset.practice-waiver-${waiverId.replace(/[^A-Za-z0-9_-]/g, "-")}`,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: { taskSessionId: input.taskSessionId ?? "task_runtime" },
      operations: [{ op: "write_waiver", path, expectedHash, body }]
    });
    this.changesets.set(draft.id, draft);
    this.changeSetRoots.set(draft.id, canonicalRepositoryRoot(root));
    this.changeSetWorktreeDigestProfiles.set(draft.id, "repository");
    return okEnvelope("practices.waive", {
      schemaVersion: "archcontext.practice-waiver-plan/v1",
      waiver,
      waiverDigest: digestJson(waiver as unknown as Json),
      ownerRegistry,
      path,
      draft,
      preview: this.changeSetEngine.preview(session.workspace.root, draft)
    } as unknown as Json);
  }

  async planUpdate(root: string, rawInput: RuntimePlanUpdateInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimePlanUpdateInput;
    try {
      input = decodeRuntimePlanUpdateInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeUpdateInputError) {
        return errorEnvelope("plan_update", "AC_SCHEMA_INVALID", error.message);
      }
      throw error;
    }
    const session = await this.openSession(root);
    const model = await this.readModelStore.validateModel(session.workspace);
    const worktreeDigestProfile: RuntimeWorktreeDigestProfile = input.worktreeDigestPrecondition?.profile ?? "repository";
    const worktreeDigest = runtimeWorktreeDigest(root, worktreeDigestProfile);
    if (input.worktreeDigestPrecondition && input.worktreeDigestPrecondition.expectedDigest !== worktreeDigest) {
      throw new Error("Worktree digest changed before plan");
    }
    const draft = this.changeSetEngine.plan({
      id: input.id,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: input.reason ?? { taskSessionId: "task_runtime" },
      operations: input.operations
    });
    this.changesets.set(draft.id, draft);
    this.changeSetRoots.set(draft.id, canonicalRepositoryRoot(root));
    this.changeSetWorktreeDigestProfiles.set(draft.id, worktreeDigestProfile);
    return okEnvelope("plan_update", {
      draft,
      changeSetDigest: digestJson(draft as unknown as Json),
      preview: this.changeSetEngine.preview(root, draft)
    } as unknown as Json);
  }

  /**
   * The MCP projection entrypoint. Writes (apply, adopt, recover) need the same confirmation as a
   * ChangeSet apply: an explicit `approved: true` plus the request's own expected snapshot, checked
   * here before any work so a stale request fails closed with a typed precondition error.
   */
  async mcpProjection(root: string, input: RuntimeProjectionInvocation, approved: boolean): Promise<JsonEnvelope> {
    this.assertRunning();
    try { validateProjectionInvocation(input); }
    catch (error) { return errorEnvelope("projection", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)); }
    if (projectionInvocationWrites(input)) {
      if (approved !== true) {
        return errorEnvelope("projection", "AC_USER_CONFIRMATION_REQUIRED", "Review the projection request, then call again with approved: true");
      }
      try { assertProjectionInvocationSnapshot(root, input); }
      catch (error) { return errorEnvelope("projection", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error)); }
    }
    return this.projection(root, input);
  }

  /**
   * The single apply entrypoint for CLI, MCP and internal callers. Confirmation is the explicit
   * `approved: true`, the expected worktree digest checked under the writer lock, and each
   * operation's expected hash checked by the engine immediately before it writes.
   */
  async applyUpdate(root: string, rawInput: RuntimeApplyUpdateInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimeApplyUpdateInput;
    try {
      input = decodeRuntimeApplyUpdateInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeUpdateInputError) {
        return errorEnvelope("apply_update", "AC_SCHEMA_INVALID", error.message);
      }
      throw error;
    }
    if (!input.approved) {
      return errorEnvelope("apply_update", "AC_USER_CONFIRMATION_REQUIRED", "Review the ChangeSet preview, then apply explicitly with approved: true (CLI: --approved)");
    }
    const plannedRoot = this.changeSetRoots.get(input.id);
    if (plannedRoot !== undefined && plannedRoot !== canonicalRepositoryRoot(root)) {
      return errorEnvelope("apply_update", "AC_PRECONDITION_FAILED", "ChangeSet was planned for a different repository");
    }
    return this.applyAuthorizedUpdate(root, input);
  }

  private async applyAuthorizedUpdate(root: string, rawInput: RuntimeApplyUpdateInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimeApplyUpdateInput;
    try {
      input = decodeRuntimeApplyUpdateInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeUpdateInputError) {
        return errorEnvelope("apply_update", "AC_SCHEMA_INVALID", error.message);
      }
      throw error;
    }
    return this.withWriter(async () => {
      const draft = this.changesets.get(input.id);
      if (!draft) throw new Error(`Unknown ChangeSet: ${input.id}`);
      const plannedProfile = this.changeSetWorktreeDigestProfiles.get(input.id);
      if (!plannedProfile) throw new Error("ChangeSet worktree digest profile missing before apply");
      const requestedProfile = input.worktreeDigestProfile ?? "repository";
      if (requestedProfile !== plannedProfile) throw new Error("ChangeSet worktree digest profile changed before apply");
      const current = runtimeWorktreeDigest(root, plannedProfile);
      if (current !== input.expectedWorktreeDigest) throw new Error("Worktree digest changed before apply");
      const session = await this.openSession(root);
      if (draft.base.headSha !== session.workspace.headSha) throw new Error("ChangeSet HEAD changed before apply");
      if (draft.base.worktreeDigest !== current) throw new Error("ChangeSet worktree digest changed before apply");
      const currentModel = await this.readModelStore.validateModel(session.workspace);
      const baseErrors = baseModelBlockingErrors(currentModel);
      if (baseErrors.length > 0) {
        throw new Error(`ChangeSet base model is invalid: ${baseErrors.join("; ")}`);
      }
      if (draft.base.modelDigest !== currentModel.modelDigest) throw new Error("ChangeSet model digest changed before apply");
      if (input.projectionApplyReceipt && await this.localStore.inspectProjectionApplyReceipt(input.projectionApplyReceipt.identity.lookupKey)) {
        return errorEnvelope("apply_update", "AC_PRECONDITION_FAILED", "committed projection receipt requires explicit projection recover");
      }
      const approved = input.approved ? this.changeSetEngine.approve(draft) : draft;
      const transitionBase = captureModelTransitionBase(root, approved);
      let ledgerAppend: Json | undefined;
      let appliedJournalId: string | undefined;
      const writesLedger = architectureLedgerWriteAppendsEvents(this.architectureLedger.writeMode);
      const result = await this.changeSetEngine.apply(root, approved, {
        approved: input.approved,
        // Installed in every write mode; it keeps the pre-existing commit semantics exactly.
        afterModelValidatedBeforeCommit: async ({ journalId }) => {
          appliedJournalId = journalId;
          // Recorded while the journal is still pending, before a ledger append can commit it.
          if (transitionBase && journalId) await recordModelTransitionEvidence(this.localStore, root, journalId, transitionBase);
          // Checked on the stored draft, not the approved copy: `approve` spreads it into a fresh object.
          if (journalId && this.context.projectionPlannedDrafts.has(draft)) await this.localStore.recordChangeSetProjectionOwner(journalId);
          if (input.projectionApplyReceipt) {
            if (!journalId) throw new Error("projection apply receipt requires a durable ChangeSet journal");
            await this.localStore.recordProjectionApplyReceipt(journalId, input.projectionApplyReceipt);
          }
          if (writesLedger) {
            const appended = await this.appendAppliedChangeSetToArchitectureLedger(root, session, approved, journalId);
            ledgerAppend = {
              status: "appended",
              appendedEventCount: appended.appendedEvents.length,
              duplicateEventCount: appended.duplicateEvents.length,
              graphDigest: appended.graphDigest,
              entityCount: appended.entityCount,
              relationCount: appended.relationCount,
              constraintCount: appended.constraintCount
            };
          }
          return { journalCommitted: writesLedger && Boolean(journalId) };
        }
      });
      return okEnvelope("apply_update", {
        ...result,
        ...(appliedJournalId ? { journalId: appliedJournalId } : {}),
        architectureLedger: {
          ...this.architectureLedger,
          append: writesLedger ? ledgerAppend ?? { status: "not-appended" } : { status: "not-applicable" }
        }
      } as unknown as Json);
    });
  }

  private async appendAppliedChangeSetToArchitectureLedger(root: string, session: RepositorySession, draft: ChangeSetDraft, journalId?: string) {
    const paths = runtimeStatePaths(root);
    const scope = {
      repository: {
        repositoryId: session.workspace.repositoryId,
        storageRepositoryId: paths.storageRepositoryId
      },
      worktree: {
        workspaceId: paths.workspaceId,
        storageWorkspaceId: paths.storageWorkspaceId,
        branch: readCurrentBranch(root),
        headSha: session.workspace.headSha,
        worktreeDigest: computeWorktreeDigest(root)
      }
    };
    const plan = planChangeSetApplyToArchitectureLedgerEvent({
      ...scope,
      draft,
      files: listModelFiles(root),
      previousEvidenceState: await this.localStore.replayArchitectureLedgerEvidence(scope),
      createdAt: this.clock(),
      writeMode: this.architectureLedger.writeMode === "ledger-with-projection" ? "ledger-with-projection" : "dual",
      command: "archctx apply"
    });
    if (journalId) await this.localStore.recordChangeSetLedgerPlan(journalId, { event: plan.event });
    const appendInput = { writer: "runtime-daemon" as const, events: [plan.event] };
    const result = await this.appendArchitectureEventsWithFeed(root, appendInput, journalId);
    return result;
  }

  /**
   * Records an operator's acceptance of an ordered chain of committed YAML ChangeSets, without
   * promoting ledger graph authority. Without `approved` it only previews the acceptance plan.
   */
  async acceptCommittedChange(root: string, rawInput: RuntimeAcceptCommittedChangeInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: AcceptCommittedChangeRequest;
    try {
      input = decodeAcceptCommittedChangeInput(rawInput);
    } catch (error) {
      if (error instanceof AcceptCommittedChangeInputError) return errorEnvelope("ledger.accept-committed", "AC_SCHEMA_INVALID", error.message);
      throw error;
    }
    if (this.architectureLedger.readMode !== "yaml" || this.architectureLedger.writeMode !== "yaml") {
      return errorEnvelope("ledger.accept-committed", "AC_PRECONDITION_FAILED", "committed YAML acceptance requires YAML read and write authority");
    }
    return this.withWriter(async () => {
      try {
        const canonicalRoot = canonicalRepositoryRoot(root);
        const journals = [];
        for (const ref of input.journals) journals.push(await this.localStore.readCommittedChangeSet(canonicalRoot, ref.journalId));
        const model = loadNativeModelFromArchContext(canonicalRoot);
        const worktreeDigest = architectureDocumentationProjectionWorktreeDigest(canonicalRoot, model);
        const projection = buildArchitectureDocsProjection(this.projectionHost(), canonicalRoot, new Date(0).toISOString(), "repo-harness/v1");
        const scope = acceptedCommittedChangeScope(canonicalRoot, worktreeDigest, resolveAcceptanceHeadSha(canonicalRoot));
        const manifestWrite = await this.localStore.readLatestCommittedChangeSetFile(canonicalRoot, "docs/architecture/.projection-manifest.json");
        const acceptance = planCommittedChangeAcceptance(canonicalRoot, {
          requested: input.journals, journals, model, existingFiles: projection.loaded.existingFiles, latestJournaledManifest: manifestWrite,
          projection: projection.plan, currentEvidence: projection.snapshotEvidence, projectionWorktreeDigest: worktreeDigest, scope
        });
        // The preview never carries the accepted-change tuple: only an appended event can issue it.
        if (!input.approved) {
          return okEnvelope("ledger.accept-committed", { status: "preview", plan: acceptance.plan, acceptancePlanId: acceptance.acceptancePlanId, expectedWorktreeDigest: worktreeDigest } as unknown as Json);
        }
        if (input.expectedWorktreeDigest !== worktreeDigest) throw new Error("accepted ChangeSet expected worktree digest mismatch");
        if (input.acceptancePlanId !== acceptance.acceptancePlanId) throw new Error("accepted ChangeSet acceptance plan changed since preview");
        const accepted = (event: ArchitectureEventV1, replayed: boolean) => {
          const recorded = acceptedChangeFromEventV2(event);
          if (!recorded || !event.eventHash) throw new Error("committed ChangeSet acceptance readback failed");
          return okEnvelope("ledger.accept-committed", {
            status: "accepted", replayed, acceptedChange: recorded.acceptedChange, acceptancePlanId: recorded.acceptancePlanId,
            journalIds: input.journals.map((journal) => journal.journalId), eventHash: event.eventHash, fileSetDigest: acceptance.plan.fileSetDigest
          } as unknown as Json);
        };
        const existing = await this.localStore.readArchitectureEvent({ ...scope, eventId: acceptance.acceptedChange.eventId });
        if (existing) {
          // A retry of the same approved plan (for example after a crash past the append) gets the recorded tuple back.
          if (acceptedChangeFromEventV2(existing)?.acceptancePlanId === acceptance.acceptancePlanId) return accepted(existing, true);
          throw new Error(`committed ChangeSet already has a different acceptance event at this snapshot: ${existing.eventId}`);
        }
        const ledgerGraphDigest = architectureLedgerStateDigest(await this.localStore.readArchitectureLedgerState(scope));
        const event = acceptedCommittedChangeEventV2({ acceptance, scope, ledgerGraphDigest, timestamp: this.clock() });
        const appended = await this.appendArchitectureEventsWithFeed(canonicalRoot, { writer: "runtime-daemon", events: [event] });
        if (appended.appendedEvents.length !== 1) throw new Error("committed ChangeSet acceptance event was not appended");
        const readback = await this.localStore.readArchitectureEvent({ ...scope, eventId: event.eventId });
        if (!readback || readback.eventType !== event.eventType || readback.payloadVersion !== event.payloadVersion) {
          throw new Error("committed ChangeSet acceptance readback failed");
        }
        return accepted(readback, false);
      } catch (error) {
        return errorEnvelope("ledger.accept-committed", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
      }
    });
  }

  private assertRunning(): void {
    this.context.assertRunning();
  }

  private clock(): string {
    return this.context.clock();
  }

  private openSession(root: string): Promise<RepositorySession> {
    return this.context.openSession(root);
  }

  private withWriter<T>(fn: () => Promise<T>): Promise<T> {
    return this.context.withWriter(fn);
  }

  private appendArchitectureEventsWithFeed(root: string, input: ArchitectureLedgerAppendInput, journalId?: string): Promise<ArchitectureLedgerAppendResult> {
    return this.context.appendArchitectureEventsWithFeed(root, input, journalId);
  }

  private projectionHost(): ProjectionServiceHost {
    return this.context.projectionHost();
  }

  private projection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope> {
    return this.context.projection(root, input);
  }
}

export function runtimeWorktreeDigest(root: string, profile: RuntimeWorktreeDigestProfile): string {
  switch (profile) {
    case "repository":
      return computeWorktreeDigest(root);
    case "architecture-documentation-projection":
      return architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root));
    default:
      throw new RuntimeUpdateInputError(`unsupported worktree digest profile: ${String(profile)}`);
  }
}

function acceptedCommittedChangeScope(root: string, worktreeDigest: string, headSha: string): ArchitectureLedgerScope {
  const paths = runtimeStatePaths(root);
  return {
    repository: { repositoryId: repositoryFingerprint(root), storageRepositoryId: paths.storageRepositoryId },
    worktree: {
      workspaceId: projectionWorkspaceId(root),
      storageWorkspaceId: paths.storageWorkspaceId,
      branch: readCurrentBranch(root),
      headSha,
      worktreeDigest
    }
  };
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

function architectureLedgerWriteAppendsEvents(mode: RuntimeArchitectureLedgerWriteMode): boolean {
  return mode === "dual" || mode === "ledger-with-projection";
}
