import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json, type ModelStorePort } from "@archcontext/contracts";
import { assertAllowedArchContextPath, evaluateChangeSetPaths } from "@archcontext/policy-engine";

export type ChangeSetStatus = "proposed" | "approved" | "applied" | "rolled-back" | "rejected";
export type ChangeOperationKind = "create_entity" | "update_entity_fields" | "delete_entity" | "write_policy" | "render_projection";

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
}

export interface ProjectionRebuilderPort {
  rebuildGeneratedProjection(root: string): void;
}

export interface ChangeSetEngineDeps {
  modelStore: ModelStorePort;
  projection: ProjectionRebuilderPort;
}

export class ChangeSetEngine {
  private readonly states = new Map<string, ChangeSetDraft>();

  constructor(private readonly deps?: ChangeSetEngineDeps) {}

  plan(input: {
    id: string;
    base: ChangeSetBase;
    reason: ChangeSetReason;
    operations: ChangeOperation[];
    requiresConfirmation?: boolean;
  }): ChangeSetDraft {
    const draft: ChangeSetDraft = {
      schemaVersion: "archcontext.changeset/v1",
      id: input.id,
      status: "proposed",
      base: input.base,
      reason: input.reason,
      operations: input.operations,
      preconditions: ["schema-valid-before", "expected-digest-match"],
      postconditions: ["schema-valid-after", "projection-rebuilt"],
      requiresConfirmation: input.requiresConfirmation ?? true,
      idempotencyKey: `idem_${input.id}`
    };
    this.states.set(draft.id, draft);
    return draft;
  }

  preview(root: string, draft: ChangeSetDraft): { digest: string; paths: string[]; allowed: boolean; findings: string[] } {
    const paths = draft.operations.flatMap((operation) => operation.path ? [operation.path] : []);
    const findings = evaluateChangeSetPaths(root, paths).map((finding) => finding.message);
    return { digest: digestJson(draft as unknown as Json), paths, allowed: findings.length === 0, findings };
  }

  approve(draft: ChangeSetDraft): ChangeSetDraft {
    const approved = { ...draft, status: "approved" as const };
    this.states.set(approved.id, approved);
    return approved;
  }

  async apply(root: string, draft: ChangeSetDraft, options: ApplyOptions = {}): Promise<ChangeSetDraft> {
    const approved = options.approved || draft.status === "approved";
    if (!approved) throw new Error("ChangeSet must be approved before apply");
    const deps = this.requireDeps();
    const backups: { path: string; backupPath: string; existed: boolean }[] = [];
    let applied = 0;
    try {
      for (const operation of draft.operations) {
        if (operation.op === "render_projection") {
          this.rebuildGeneratedProjection(root, deps);
          applied += 1;
          if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
          continue;
        }
        if (!operation.path) throw new Error(`Change operation requires path: ${operation.op}`);
        assertSafeTarget(root, operation.path);
        const absolute = resolve(root, operation.path);
        const existed = existsSync(absolute);
        const backupPath = `${absolute}.archctx-backup`;
        if (existsSync(backupPath)) throw new Error(`Backup path already exists: ${operation.path}`);
        if (existed) {
          assertExpectedHash(absolute, operation.expectedHash);
          renameSync(absolute, backupPath);
        } else if (operation.expectedHash !== "missing") {
          throw new Error(`Expected missing file hash for new path: ${operation.path}`);
        }
        backups.push({ path: absolute, backupPath, existed });
        if (operation.op === "delete_entity") {
          rmSync(absolute, { force: true });
        } else {
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, operation.body ?? "", "utf8");
        }
        applied += 1;
        if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
      }
      this.rebuildGeneratedProjection(root, deps);
      await this.validateModel(root, deps);
      cleanupBackups(backups);
      const appliedDraft = { ...draft, status: "applied" as const };
      this.states.set(draft.id, appliedDraft);
      return appliedDraft;
    } catch (error) {
      rollback(backups);
      const rolledBack = { ...draft, status: "rolled-back" as const };
      this.states.set(draft.id, rolledBack);
      throw error;
    }
  }

  private rebuildGeneratedProjection(root: string, deps: ChangeSetEngineDeps): void {
    deps.projection.rebuildGeneratedProjection(root);
  }

  private async validateModel(root: string, deps: ChangeSetEngineDeps): Promise<void> {
    await deps.modelStore.validateModel({ root, repositoryId: "repo.apply", headSha: "apply" });
  }

  private requireDeps(): ChangeSetEngineDeps {
    if (!this.deps) throw new Error("ChangeSetEngine apply requires modelStore and projection dependencies");
    return this.deps;
  }
}

function assertSafeTarget(root: string, path: string): void {
  assertAllowedArchContextPath(root, path);
  const absolute = resolve(root, path);
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Refusing to write symlink target: ${path}`);
  }
}

function assertExpectedHash(path: string, expectedHash: string): void {
  const actual = digestJson({ body: readFileSync(path, "utf8") });
  if (expectedHash !== actual) throw new Error(`Expected hash mismatch: ${path}`);
}

function rollback(backups: { path: string; backupPath: string; existed: boolean }[]): void {
  for (const backup of backups.reverse()) {
    rmSync(backup.path, { recursive: true, force: true });
    if (backup.existed && existsSync(backup.backupPath)) renameSync(backup.backupPath, backup.path);
  }
}

function cleanupBackups(backups: { backupPath: string }[]): void {
  for (const backup of backups) rmSync(backup.backupPath, { recursive: true, force: true });
}
