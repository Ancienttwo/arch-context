import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, type Json } from "../../contracts/src/index";
import { rebuildGeneratedProjection, YamlModelStore } from "../../model-store-yaml/src/index";
import { assertAllowedArchContextPath, evaluateChangeSetPaths } from "../../policy-engine/src/index";

export type ChangeSetStatus = "proposed" | "approved" | "applied" | "rolled-back" | "rejected";

export interface ChangeOperation {
  op: "write_file" | "delete_file";
  path: string;
  expectedHash: string;
  body?: string;
}

export interface ChangeSetDraft {
  schemaVersion: "archcontext.changeset/v1";
  id: string;
  status: ChangeSetStatus;
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

export class ChangeSetEngine {
  private readonly states = new Map<string, ChangeSetDraft>();

  plan(input: { id: string; operations: ChangeOperation[]; requiresConfirmation?: boolean }): ChangeSetDraft {
    const draft: ChangeSetDraft = {
      schemaVersion: "archcontext.changeset/v1",
      id: input.id,
      status: "proposed",
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
    const paths = draft.operations.map((operation) => operation.path);
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
    const backups: { path: string; backupPath: string; existed: boolean }[] = [];
    let applied = 0;
    try {
      for (const operation of draft.operations) {
        assertSafeTarget(root, operation.path);
        const absolute = resolve(root, operation.path);
        const existed = existsSync(absolute);
        const backupPath = `${absolute}.archctx-backup`;
        if (existed) {
          assertExpectedHash(absolute, operation.expectedHash);
          renameSync(absolute, backupPath);
        } else if (operation.expectedHash !== "missing") {
          throw new Error(`Expected missing file hash for new path: ${operation.path}`);
        }
        backups.push({ path: absolute, backupPath, existed });
        if (operation.op === "write_file") {
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, operation.body ?? "", "utf8");
        } else {
          rmSync(absolute, { force: true });
        }
        applied += 1;
        if (options.faultAfterOperations && applied >= options.faultAfterOperations) throw new Error("fault-injection");
      }
      rebuildGeneratedProjection(root);
      await new YamlModelStore().validateModel({ root, repositoryId: "repo.apply", headSha: "apply" });
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
