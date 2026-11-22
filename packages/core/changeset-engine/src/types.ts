import type { Json, ModelStorePort } from "@archcontext/contracts";

export interface AdrReferenceReplacement { from: string; to: string }
export interface ManifestUpdateFields { "content.decisions"?: "docs/adr"; "model.layers"?: string[] }

export type ChangeSetStatus = "proposed" | "approved" | "applied" | "rolled-back" | "rejected";
export type ChangeOperationKind =
  | "create_entity"
  | "update_entity_fields"
  | "delete_entity"
  | "update_manifest_fields"
  | "update_adr_references"
  | "write_policy"
  | "write_waiver"
  | "render_projection"
  | "render_agent_context"
  | "write_refactor_decision";

export interface ChangeSetBase {
  headSha: string;
  worktreeDigest: string;
  modelDigest: string;
}

export interface ChangeSetReason {
  taskSessionId: string;
  interventionId?: string;
}

export interface ChangeOperation {
  op: ChangeOperationKind;
  path?: string;
  entityId?: string;
  expectedHash: string;
  body?: string;
  fields?: ManifestUpdateFields;
  references?: AdrReferenceReplacement[];
  projectionFiles?: Array<ChangeSetProjectionFile | ChangeSetProjectionDelete | ChangeSetProjectionGuard>;
}

export interface ChangeSetProjectionFile {
  path: string;
  expectedHash: string;
  body: string;
}

/**
 * Removes one projection-owned file inside the same explicit write set. Only `render_projection`
 * accepts it, and only for a file that exists with exactly `expectedHash`; the journal records it
 * as a delete, like a generated-projection delete.
 */
export interface ChangeSetProjectionDelete {
  path: string;
  expectedHash: string;
  delete: true;
}

/**
 * Binds one projection-owned file the write set depends on but does not write: a document a
 * partial apply carries forward unchanged. Only `render_projection` accepts it, only with the exact
 * hash of the bytes the render read, and only for a path no write of the same draft touches. The
 * apply writes and journals nothing for it; it verifies the file still exists with `expectedHash`
 * immediately before the commit, and any other state fails the whole apply.
 */
export interface ChangeSetProjectionGuard {
  path: string;
  expectedHash: string;
  guard: true;
}

export interface ChangeSetDraft {
  schemaVersion: "archcontext.changeset/v1";
  id: string;
  status: ChangeSetStatus;
  base: ChangeSetBase;
  reason: ChangeSetReason;
  operations: ChangeOperation[];
  preconditions: string[];
  postconditions: string[];
  requiresConfirmation: boolean;
  idempotencyKey: string;
}

export interface ApplyOptions {
  approved?: boolean;
  faultAfterOperations?: number;
  afterModelValidatedBeforeCommit?: (input: {
    root: string;
    draft: ChangeSetDraft;
    journalId?: string;
  }) => Promise<{ journalCommitted?: boolean } | void> | { journalCommitted?: boolean } | void;
}

export interface ProjectionRebuilderPort {
  planGeneratedProjection(root: string): {
    path: string;
    expectedHash: string;
    body: string;
    operation: "render_projection" | "delete_entity";
  }[];
}

export interface ChangeSetJournalFile {
  path: string;
  tempPath?: string;
  backupPath?: string;
  existed: boolean;
  operation: ChangeOperationKind;
  /**
   * `digestJson({ body })` of the bytes this operation wrote, or `"missing"` for a delete. The
   * journal is the only durable record of what a committed ChangeSet actually wrote: the draft
   * metadata keeps `expectedHash` (the preimage) and drops projection bodies entirely, so without
   * this a later reader cannot name the committed content.
   */
  bodyHash: string;
}

export interface ChangeSetJournalPort {
  beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string>;
  recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void>;
  commitChangeSet(journalId: string): Promise<void>;
  completeChangeSetCleanup(journalId: string): Promise<void>;
  abortChangeSet(journalId: string, reason: string): Promise<void>;
  recoverPendingChangeSets(): number;
}

/**
 * Derives the exact repo paths a `render_agent_context` operation may write, from the model on
 * disk at the moment of the preview or apply. Re-deriving per call (rather than trusting a path set
 * carried in the ChangeSet) means a model change between plan and apply narrows the write surface
 * instead of leaving a stale widening in place.
 */
export interface AgentContextScopePort {
  derive(root: string): ReadonlySet<string>;
  /** Mandatory for existing root contracts; verifies canonical marker-only rendering. */
  validateRootWrite?(root: string, file: ChangeSetProjectionFile): void;
}

export interface ChangeSetEngineDeps {
  modelStore: ModelStorePort;
  projection: ProjectionRebuilderPort;
  journal?: ChangeSetJournalPort;
  agentContextScope?: AgentContextScopePort;
}
