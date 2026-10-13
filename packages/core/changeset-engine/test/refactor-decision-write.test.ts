import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, refactorDecisionPath, type RefactorDecisionV1 } from "@archcontext/contracts";
import { initializeArchContextModel, listModelFiles, planGeneratedProjection, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { ChangeSetEngine, isRefactorDecisionOnly, type ChangeOperation, type ChangeSetJournalFile, type ChangeSetJournalPort } from "../src/index";

const BODY = readFileSync(join(import.meta.dir, "../../../contracts/fixtures/valid/refactor-decision.json"), "utf8");
const DECISION = JSON.parse(BODY) as RefactorDecisionV1;
const PATH = refactorDecisionPath(DECISION.recommendationId);
const DIGEST = `sha256:${"a".repeat(64)}`;

function tempModelRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "archctx-refactor-decision-"));
  initializeArchContextModel(dir, "Refactor Decision Test");
  return dir;
}

class RecordingJournal implements ChangeSetJournalPort {
  files: ChangeSetJournalFile[] = [];
  committed: string[] = [];
  aborted: string[] = [];
  async beginChangeSet(): Promise<string> { return "journal.decision"; }
  async recordChangeSetFile(_journalId: string, file: ChangeSetJournalFile): Promise<void> { this.files.push(file); }
  async commitChangeSet(journalId: string): Promise<void> { this.committed.push(journalId); }
  async completeChangeSetCleanup(): Promise<void> {}
  async abortChangeSet(journalId: string): Promise<void> { this.aborted.push(journalId); }
  recoverPendingChangeSets(): number { return 0; }
}

function engineWith(journal: ChangeSetJournalPort, projected: string[] = []) {
  return new ChangeSetEngine({
    modelStore: new YamlModelStore(),
    projection: {
      planGeneratedProjection: (root: string) => {
        projected.push(root);
        return planGeneratedProjection(root);
      }
    },
    journal
  });
}

function decisionOperation(overrides: Partial<ChangeOperation> = {}): ChangeOperation {
  return { op: "write_refactor_decision", path: PATH, expectedHash: "missing", body: BODY, ...overrides };
}

function plan(engine: ChangeSetEngine, operations: ChangeOperation[]) {
  return engine.plan({
    id: "changeset.refactor-decision",
    base: { headSha: "abc", worktreeDigest: DIGEST, modelDigest: DIGEST },
    reason: { taskSessionId: "task.refactor-decision" },
    operations
  });
}

function treeSnapshot(root: string, directory: string): Record<string, string> {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return {};
  const files: Record<string, string> = {};
  for (const entry of readdirSync(absolute, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files[join(entry.parentPath, entry.name)] = readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return files;
}

describe("write_refactor_decision (ADR-0046)", () => {
  test("only the refactor-decision scope reaches the decision directory; the default allowlist does not", () => {
    const root = tempModelRoot();
    try {
      const engine = engineWith(new RecordingJournal());
      expect(plan(engine, [decisionOperation()]).postconditions).toEqual(["schema-valid-after", "refactor-decision-written"]);
      expect(engine.preview(root, plan(engine, [decisionOperation()]))).toMatchObject({ allowed: true, findings: [] });
      const generic = engine.preview(root, plan(engine, [{ op: "write_policy", path: PATH, expectedHash: "missing", body: BODY }]));
      expect(generic.allowed).toBe(false);
      expect(generic.findings.join("\n")).toContain("outside ArchContext write allowlist");
      const elsewhere = engine.preview(root, plan(engine, [decisionOperation({ path: ".archcontext/decisions/x.json" })]));
      expect(elsewhere.allowed).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a body that is not the canonical decision for its path, or a draft mixing other operations, is refused before any write", () => {
    const root = tempModelRoot();
    try {
      const engine = engineWith(new RecordingJournal());
      const findings = (operations: ChangeOperation[]) => engine.preview(root, plan(engine, operations)).findings.join("\n");
      expect(findings([decisionOperation({ body: BODY.replace("\"rejected\"", "\"open\"") })])).toContain("refactor-decision-invalid");
      expect(findings([decisionOperation({ body: JSON.stringify(DECISION) })])).toContain("canonical serialization");
      expect(findings([decisionOperation({ path: refactorDecisionPath("recommendation.0000000000000000") })])).toContain("named after its recommendationId");
      expect(findings([decisionOperation(), { op: "write_policy", path: ".archcontext/policies/p.yaml", expectedHash: "missing", body: "x: 1\n" }]))
        .toContain("must not be combined");
      expect(isRefactorDecisionOnly([decisionOperation()])).toBe(true);
      expect(isRefactorDecisionOnly([])).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a decision-only apply writes the file, plans no projection and leaves docs and modelDigest unchanged", async () => {
    const root = tempModelRoot();
    try {
      const journal = new RecordingJournal();
      const projected: string[] = [];
      const engine = engineWith(journal, projected);
      const store = new YamlModelStore();
      const before = await store.validateModel({ root, repositoryId: "repo", headSha: "abc" });
      const docsBefore = treeSnapshot(root, "docs");
      const modelFilesBefore = listModelFiles(root).map((file) => file.digest);
      const applied = await engine.apply(root, plan(engine, [decisionOperation()]), { approved: true });
      expect(applied.status).toBe("applied");
      expect(readFileSync(join(root, PATH), "utf8")).toBe(BODY);
      expect(projected).toEqual([]);
      expect(treeSnapshot(root, "docs")).toEqual(docsBefore);
      expect(listModelFiles(root).map((file) => file.digest)).toEqual(modelFilesBefore);
      const after = await store.validateModel({ root, repositoryId: "repo", headSha: "abc" });
      expect(after.modelDigest).toBe(before.modelDigest);
      expect(journal.files).toEqual([expect.objectContaining({ path: PATH, existed: false, operation: "write_refactor_decision", bodyHash: digestJson({ body: BODY }) })]);
      expect(journal.committed).toEqual(["journal.decision"]);

      // A second decision on the same generation names the file it replaces.
      const deferred = BODY.replace("\"rejected\"", "\"deferred\"");
      await expect(engine.apply(root, plan(engine, [decisionOperation({ body: deferred })]), { approved: true })).rejects.toThrow(/Expected hash mismatch/);
      await engine.apply(root, plan(engine, [decisionOperation({ body: deferred, expectedHash: digestJson({ body: BODY }) })]), { approved: true });
      expect(readFileSync(join(root, PATH), "utf8")).toBe(deferred);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a failure in the commit hook rolls the decision file back and aborts the journal", async () => {
    const root = tempModelRoot();
    try {
      const journal = new RecordingJournal();
      const engine = engineWith(journal);
      await expect(engine.apply(root, plan(engine, [decisionOperation()]), {
        approved: true,
        afterModelValidatedBeforeCommit: async () => {
          throw new Error("ledger append failed");
        }
      })).rejects.toThrow("ledger append failed");
      expect(existsSync(join(root, PATH))).toBe(false);
      expect(journal.committed).toEqual([]);
      expect(journal.aborted).toEqual(["journal.decision"]);

      // An existing decision is restored byte for byte.
      mkdirSync(join(root, ".archcontext/refactor-decisions"), { recursive: true });
      writeFileSync(join(root, PATH), BODY);
      const deferred = BODY.replace("\"rejected\"", "\"deferred\"");
      await expect(engine.apply(root, plan(engine, [decisionOperation({ body: deferred, expectedHash: digestJson({ body: BODY }) })]), {
        approved: true,
        afterModelValidatedBeforeCommit: async () => {
          throw new Error("ledger append failed");
        }
      })).rejects.toThrow("ledger append failed");
      expect(readFileSync(join(root, PATH), "utf8")).toBe(BODY);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a symlinked decision directory is refused, never followed", async () => {
    const root = tempModelRoot();
    const outside = mkdtempSync(join(tmpdir(), "archctx-refactor-decision-outside-"));
    try {
      symlinkSync(outside, join(root, ".archcontext/refactor-decisions"));
      const engine = engineWith(new RecordingJournal());
      expect(engine.preview(root, plan(engine, [decisionOperation()])).allowed).toBe(false);
      await expect(engine.apply(root, plan(engine, [decisionOperation()]), { approved: true })).rejects.toThrow();
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
