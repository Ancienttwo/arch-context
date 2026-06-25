import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARCHITECTURE_CANDIDATE_DELTA_POLICY_SCHEMA_VERSION,
  ARCHITECTURE_CANDIDATE_DELTA_SCHEMA_VERSION,
  architectureEventHash,
  digestJson,
  validateJsonSchema,
  type ArchitectureCandidateDeltaPolicyEvaluationV1,
  type ArchitectureCandidateDeltaV1
} from "@archcontext/contracts";
import { initializeArchContextModel, rebuildGeneratedProjection, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import {
  ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION,
  ChangeSetEngine,
  planArchitectureCandidateChangeSet,
  type ChangeSetDraft,
  type ChangeSetJournalFile,
  type ChangeSetJournalPort
} from "../src/index";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const digest = `sha256:${"a".repeat(64)}`;

function readJson(path: string) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function tempModelRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "archctx-changeset-"));
  initializeArchContextModel(dir, "ChangeSet Test");
  return dir;
}

function yamlChangeSetEngine(journal?: ChangeSetJournalPort): ChangeSetEngine {
  return new ChangeSetEngine({
    modelStore: new YamlModelStore(),
    projection: { rebuildGeneratedProjection },
    journal
  });
}

describe("@archcontext/core/changeset-engine", () => {
  test("plans schema-valid changesets and previews allowlist findings", () => {
    const engine = new ChangeSetEngine();
    const draft = engine.plan({
      id: "changeset.test",
      base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
      reason: { taskSessionId: "task.test" },
      operations: [
        { op: "write_policy", path: ".archcontext/policies/new.yaml", expectedHash: "missing", body: "schemaVersion: archcontext.policy/v1\n" },
        { op: "write_waiver", path: ".archcontext/waivers/cycle-waiver.json", expectedHash: "missing", body: "{}\n" }
      ]
    });

    expect(validateJsonSchema(readJson("schemas/runtime/changeset.schema.json") as any, draft as any).valid).toBe(true);
    expect(engine.preview("/tmp/repo", draft)).toMatchObject({ allowed: true, paths: [".archcontext/policies/new.yaml", ".archcontext/waivers/cycle-waiver.json"] });

    const denied = engine.plan({
      id: "changeset.denied",
      base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
      reason: { taskSessionId: "task.test" },
      operations: [{ op: "write_policy", path: "src/app.ts", expectedHash: "missing", body: "" }]
    });
    expect(engine.preview("/tmp/repo", denied).allowed).toBe(false);
  });

  test("plans accepted architecture candidates as previewable changesets and ledger event batches", () => {
    const repository = { repositoryId: "repo.arch-context", storageRepositoryId: "git:arch-context" };
    const worktree = {
      workspaceId: "workspace.local",
      storageWorkspaceId: "worktree:local",
      branch: "codex/test",
      headSha: "abc",
      worktreeDigest: digest
    };
    const delta: ArchitectureCandidateDeltaV1 = {
      schemaVersion: ARCHITECTURE_CANDIDATE_DELTA_SCHEMA_VERSION,
      deltaId: "delta.accepted-candidates",
      repository,
      worktree,
      changeCursor: {
        source: "git",
        changeSource: "worktree",
        headSha: "abc",
        pathCount: 2,
        metadataDigest: digest,
        codeFactsDigest: digest
      },
      subjectSelectors: [],
      changedSubjects: [],
      rawFacts: [],
      interpretations: [],
      declaredSubjectMappings: [],
      mappingAmbiguities: [],
      candidateChanges: [
        {
          candidateChangeId: "candidate.node.added",
          kind: "node-added",
          target: { kind: "node", id: "entity.api" },
          stateDimension: "target-state",
          changeKind: "added",
          subjectSelectorIds: ["selector.api"],
          mappingIds: ["mapping.api"],
          ambiguityIds: [],
          evidenceIds: ["evidence.api"],
          confidence: "high",
          heuristic: true,
          summary: "API module added with complete evidence",
          digest: digestJson({ candidate: "candidate.node.added" })
        },
        {
          candidateChangeId: "candidate.node.moved",
          kind: "node-moved",
          target: { kind: "node", id: "entity.worker" },
          stateDimension: "target-state",
          changeKind: "moved",
          subjectSelectorIds: ["selector.worker"],
          mappingIds: [],
          ambiguityIds: [],
          evidenceIds: [],
          confidence: "low",
          heuristic: true,
          summary: "Worker module moved without proof",
          digest: digestJson({ candidate: "candidate.node.moved" })
        }
      ],
      evidenceItems: [],
      evidenceBindings: [],
      summary: {
        added: 1,
        removed: 0,
        moved: 1,
        renamed: 0,
        materiallyChanged: 0,
        unresolved: 1,
        mapped: 1,
        ambiguous: 0,
        candidateChanges: 2,
        targetStateChanges: 2,
        migrationStateProgress: 0
      },
      deltaDigest: digestJson({ delta: "accepted-candidates" })
    };
    const policyEvaluation: ArchitectureCandidateDeltaPolicyEvaluationV1 = {
      schemaVersion: ARCHITECTURE_CANDIDATE_DELTA_POLICY_SCHEMA_VERSION,
      evaluationId: "candidate-policy.eval.accepted-candidates",
      deltaId: delta.deltaId,
      repository,
      worktree,
      deltaDigest: delta.deltaDigest,
      policyVersion: "candidate-delta-policy/v1",
      evaluatedAt: "2026-06-26T00:00:00.000Z",
      decisions: [
        {
          decisionId: "candidate-policy.decision.auto",
          candidateChangeId: "candidate.node.added",
          target: { kind: "node", id: "entity.api" },
          stateDimension: "target-state",
          changeKind: "added",
          confidence: "high",
          action: "auto-accept",
          reasonCodes: ["high-confidence-complete-evidence"],
          evidenceIds: ["evidence.api"],
          digest: digestJson({ decision: "auto" })
        },
        {
          decisionId: "candidate-policy.decision.proof",
          candidateChangeId: "candidate.node.moved",
          target: { kind: "node", id: "entity.worker" },
          stateDimension: "target-state",
          changeKind: "moved",
          confidence: "low",
          action: "require-proof",
          reasonCodes: ["low-confidence"],
          evidenceIds: [],
          digest: digestJson({ decision: "proof" })
        }
      ],
      summary: {
        candidateChanges: 2,
        autoAccept: 1,
        requireCheckpoint: 0,
        requireProof: 1,
        requireHumanApproval: 0,
        mappingAmbiguities: 0
      },
      evaluationDigest: digestJson({ evaluation: "accepted-candidates" })
    };

    const plan = planArchitectureCandidateChangeSet({
      delta,
      policyEvaluation,
      base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
      reason: { taskSessionId: "task.al5-11" }
    });

    expect(plan.schemaVersion).toBe(ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION);
    expect(plan.acceptedCandidateChangeIds).toEqual(["candidate.node.added"]);
    expect(plan.deferredCandidateChanges).toMatchObject([{ candidateChangeId: "candidate.node.moved", action: "require-proof" }]);
    expect(validateJsonSchema(readJson("schemas/runtime/changeset.schema.json") as any, plan.changeSet as any).valid).toBe(true);

    const preview = new ChangeSetEngine().preview("/tmp/repo", plan.changeSet);
    expect(preview).toMatchObject({ allowed: true, paths: [] });

    const operation = plan.changeSet.operations[0] as unknown as Record<string, unknown>;
    expect(operation).toMatchObject({
      op: "create_entity",
      entityId: "entity.api",
      expectedHash: "missing",
      candidateChangeId: "candidate.node.added",
      targetKind: "node",
      targetId: "entity.api"
    });
    expect(operation.body).toBeUndefined();

    const event = plan.eventBatch[0];
    expect(event.eventType).toBe("architecture_candidate_changeset_planned");
    expect(event.payloadVersion).toBe(ARCHITECTURE_CANDIDATE_CHANGESET_PLAN_SCHEMA_VERSION);
    expect(event.eventHash).toBe(architectureEventHash(event));
    expect(() =>
      planArchitectureCandidateChangeSet({
        delta,
        policyEvaluation: {
          ...policyEvaluation,
          decisions: [{ ...policyEvaluation.decisions[0]!, target: { kind: "node", id: "entity.wrong" } }, policyEvaluation.decisions[1]!]
        },
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.al5-11" }
      })
    ).toThrow("Policy decision target mismatch");

    const repeated = planArchitectureCandidateChangeSet({
      delta,
      policyEvaluation,
      base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
      reason: { taskSessionId: "task.al5-11" }
    });
    expect(repeated.changeSet.id).toBe(plan.changeSet.id);
    expect(repeated.eventBatch[0]?.eventHash).toBe(event.eventHash);
    expect(repeated.planDigest).toBe(plan.planDigest);
  });

  test("applies approved changes and rebuilds generated projection", async () => {
    const modelRoot = tempModelRoot();
    try {
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(
        engine.plan({
          id: "changeset.apply",
          base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
          reason: { taskSessionId: "task.test", interventionId: "intervention.test" },
          operations: [
            {
              op: "write_policy",
              path: ".archcontext/policies/compatibility.yaml",
              expectedHash: "missing",
              body: "schemaVersion: archcontext.policy/v1\nid: policy.compatibility\n"
            },
            {
              op: "write_waiver",
              path: ".archcontext/waivers/cycle-waiver.json",
              expectedHash: "missing",
              body: "{\"schemaVersion\":\"archcontext.practice-waiver/v1\"}\n"
            }
          ]
        })
      );

      await expect(engine.apply(modelRoot, draft)).resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(join(modelRoot, ".archcontext/policies/compatibility.yaml"), "utf8")).toContain("policy.compatibility");
      expect(readFileSync(join(modelRoot, ".archcontext/waivers/cycle-waiver.json"), "utf8")).toContain("archcontext.practice-waiver/v1");
      expect(readFileSync(join(modelRoot, ".archcontext/generated/ARCHITECTURE.md"), "utf8")).toContain("Generated by ArchContext");
      expect(journal.records[0]).toMatchObject({ status: "committed" });
      expect(journal.records[0].files[0]).toMatchObject({
        path: ".archcontext/policies/compatibility.yaml",
        existed: false,
        operation: "write_policy"
      });
      expect(journal.records[0].files[1]).toMatchObject({
        path: ".archcontext/waivers/cycle-waiver.json",
        existed: false,
        operation: "write_waiver"
      });
      expect(journal.records[0].files[0].tempPath).toContain(".archctx-tmp-");
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("rolls back file writes when apply is interrupted", async () => {
    const modelRoot = tempModelRoot();
    try {
      const original = readFileSync(join(modelRoot, ".archcontext/policies/review.yaml"), "utf8");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(
        engine.plan({
          id: "changeset.rollback",
          base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
          reason: { taskSessionId: "task.test" },
          operations: [
            {
              op: "update_entity_fields",
              path: ".archcontext/policies/review.yaml",
              expectedHash: digestJson({ body: original }),
              body: "schemaVersion: archcontext.policy/v1\nid: policy.changed\n"
            }
          ]
        })
      );

      await expect(engine.apply(modelRoot, draft, { faultAfterOperations: 1 })).rejects.toThrow("fault-injection");
      expect(readFileSync(join(modelRoot, ".archcontext/policies/review.yaml"), "utf8")).toBe(original);
      expect(journal.records[0]).toMatchObject({ status: "aborted", reason: "fault-injection" });
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("requires approval before applying", async () => {
    const modelRoot = tempModelRoot();
    try {
      const engine = new ChangeSetEngine();
      const draft = engine.plan({
        id: "changeset.unapproved",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "write_policy", path: ".archcontext/policies/new.yaml", expectedHash: "missing", body: "" }]
      });

      await expect(engine.apply(modelRoot, draft)).rejects.toThrow("approved");
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });
});

class RecordingChangeSetJournal implements ChangeSetJournalPort {
  readonly records: { id: string; root: string; draft: ChangeSetDraft; files: ChangeSetJournalFile[]; status: "pending" | "committed" | "aborted"; reason?: string }[] = [];

  async beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string> {
    const id = `journal_${this.records.length + 1}`;
    this.records.push({ id, root, draft, files: [], status: "pending" });
    return id;
  }

  async recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void> {
    this.record(journalId).files.push(file);
  }

  async commitChangeSet(journalId: string): Promise<void> {
    this.record(journalId).status = "committed";
  }

  async abortChangeSet(journalId: string, reason: string): Promise<void> {
    const record = this.record(journalId);
    record.status = "aborted";
    record.reason = reason;
  }

  recoverPendingChangeSets(): number {
    return this.records.filter((record) => record.status === "pending").length;
  }

  private record(journalId: string) {
    const record = this.records.find((candidate) => candidate.id === journalId);
    if (!record) throw new Error(`Journal not found: ${journalId}`);
    return record;
  }
}
