import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  architectureCandidateDeltaPolicyDecisionDigest,
  architectureCandidateDeltaPolicyEvaluationDigest,
  digestJson,
  type ArchitectureCandidateChangeV1,
  type ArchitectureCandidateDeltaV1,
  type EvidenceItemV2,
  type Json
} from "@archcontext/contracts";
import {
  assertAllowedArchContextPath,
  evaluateArchitectureCandidateDeltaPolicy,
  evaluateChangeSetPaths,
  validateCompatibilityContract
} from "../src/index";

describe("@archcontext/core/policy-engine", () => {
  test("requires durable compatibility contract fields", () => {
    expect(validateCompatibilityContract()).toContainEqual(
      expect.objectContaining({ id: "compatibility-contract-required", severity: "error" })
    );
    expect(validateCompatibilityContract({ reason: "just in case" }).map((finding) => finding.id)).toContain(
      "compatibility-reason"
    );
    expect(
      validateCompatibilityContract({
        kind: "external-contract",
        reason: "mobile app version 2.1 still consumes this route",
        owner: "team.billing",
        consumers: ["mobile-app"],
        removalConditions: ["mobile app 2.1 unsupported"],
        reviewAt: "2026-07-01"
      })
    ).toEqual([]);
  });

  test("allows only repo-relative ArchContext paths", () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-policy-"));
      try {
        expect(() => assertAllowedArchContextPath(root, ".archcontext/policies/review.yaml")).not.toThrow();
        expect(() => assertAllowedArchContextPath(root, ".archcontext/practices/compatibility.yaml")).not.toThrow();
        expect(evaluateChangeSetPaths(root, ["src/app.ts"])[0].id).toBe("path-denied:src/app.ts");
        expect(() => assertAllowedArchContextPath(root, "../escape.yaml")).toThrow("Repository path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("classifies candidate architecture deltas before ChangeSet promotion", () => {
    const delta = candidateDelta([
      candidateChange({
        id: "auto",
        targetKind: "node",
        changeKind: "added",
        confidence: "high",
        evidenceIds: ["evidence.complete"]
      }),
      candidateChange({
        id: "checkpoint",
        targetKind: "node",
        changeKind: "materially_changed",
        confidence: "medium",
        evidenceIds: ["evidence.partial"]
      }),
      candidateChange({
        id: "migration",
        targetKind: "migration-state",
        stateDimension: "migration-state",
        changeKind: "renamed",
        confidence: "high",
        evidenceIds: ["evidence.complete"]
      }),
      candidateChange({
        id: "proof",
        targetKind: "relation",
        changeKind: "moved",
        confidence: "low",
        ambiguityIds: ["ambiguity.policy-test"],
        evidenceIds: ["evidence.complete"]
      }),
      candidateChange({
        id: "missing",
        targetKind: "node",
        changeKind: "moved",
        confidence: "high",
        evidenceIds: []
      }),
      candidateChange({
        id: "human",
        targetKind: "owner",
        changeKind: "materially_changed",
        confidence: "high",
        evidenceIds: ["evidence.complete"]
      })
    ]);

    const evaluation = evaluateArchitectureCandidateDeltaPolicy({
      delta,
      evaluatedAt: "2026-06-26T00:00:00.000Z"
    });
    const decisionsByCandidate = new Map(evaluation.decisions.map((decision) => [decision.candidateChangeId, decision]));

    expect(decisionsByCandidate.get("candidate_change.auto")?.action).toBe("auto-accept");
    expect(decisionsByCandidate.get("candidate_change.auto")?.reasonCodes).toEqual(["high-confidence-complete-evidence"]);
    expect(decisionsByCandidate.get("candidate_change.checkpoint")?.action).toBe("require-checkpoint");
    expect(decisionsByCandidate.get("candidate_change.checkpoint")?.reasonCodes).toEqual(["medium-confidence", "partial-evidence"]);
    expect(decisionsByCandidate.get("candidate_change.migration")?.action).toBe("require-checkpoint");
    expect(decisionsByCandidate.get("candidate_change.migration")?.reasonCodes).toEqual(["migration-state-progress"]);
    expect(decisionsByCandidate.get("candidate_change.proof")?.action).toBe("require-proof");
    expect(decisionsByCandidate.get("candidate_change.proof")?.reasonCodes).toEqual(["mapping-ambiguity", "low-confidence"]);
    expect(decisionsByCandidate.get("candidate_change.missing")?.action).toBe("require-proof");
    expect(decisionsByCandidate.get("candidate_change.missing")?.reasonCodes).toEqual(["missing-evidence"]);
    expect(decisionsByCandidate.get("candidate_change.human")?.action).toBe("require-human-approval");
    expect(decisionsByCandidate.get("candidate_change.human")?.reasonCodes).toEqual(["owner-authority-change"]);
    expect(evaluation.summary).toEqual({
      candidateChanges: 6,
      autoAccept: 1,
      requireCheckpoint: 2,
      requireProof: 2,
      requireHumanApproval: 1,
      mappingAmbiguities: 1
    });
    expect(evaluation.evaluationDigest).toBe(architectureCandidateDeltaPolicyEvaluationDigest(evaluation));
    expect(evaluation.decisions.every((decision) => decision.digest === architectureCandidateDeltaPolicyDecisionDigest(decision))).toBe(true);
  });
});

function candidateDelta(candidateChanges: ArchitectureCandidateChangeV1[]): ArchitectureCandidateDeltaV1 {
  return {
    schemaVersion: "archcontext.architecture-candidate-delta/v1",
    deltaId: "delta.policy-test",
    repository: {
      repositoryId: "repo.policy-test",
      storageRepositoryId: "repo.storage.policy-test"
    },
    worktree: {
      workspaceId: "workspace.policy-test.main",
      storageWorkspaceId: "workspace.storage.policy-test.main",
      branch: "main",
      headSha: "head-001",
      worktreeDigest: digestJson({ worktree: "policy-test" } as unknown as Json)
    },
    changeCursor: {
      source: "git",
      changeSource: "commit",
      baseSha: "head-000",
      headSha: "head-001",
      pathCount: 1,
      metadataDigest: digestJson({ metadata: "policy-test" } as unknown as Json),
      codeFactsDigest: digestJson({ codeFacts: "policy-test" } as unknown as Json)
    },
    subjectSelectors: [],
    changedSubjects: [],
    rawFacts: [],
    interpretations: [],
    declaredSubjectMappings: [],
    mappingAmbiguities: [
      {
        ambiguityId: "ambiguity.policy-test",
        subjectSelectorId: "subject.policy-test",
        reasonCode: "multiple-declared-targets",
        candidateTargets: [],
        evidenceIds: [],
        summary: "Policy summary records ambiguity count without accepting an invented target.",
        digest: digestJson({ ambiguity: "policy-test" } as unknown as Json)
      }
    ],
    candidateChanges,
    evidenceItems: [
      evidenceItem("evidence.complete", "complete"),
      evidenceItem("evidence.partial", "partial")
    ],
    evidenceBindings: [],
    summary: {
      added: 0,
      removed: 0,
      moved: 0,
      renamed: 0,
      materiallyChanged: 0,
      unresolved: 1,
      mapped: 0,
      ambiguous: 1,
      candidateChanges: candidateChanges.length,
      targetStateChanges: candidateChanges.filter((change) => change.stateDimension === "target-state").length,
      migrationStateProgress: candidateChanges.filter((change) => change.stateDimension === "migration-state").length,
      mappingCoverage: {
        totalChangedSubjects: 1,
        mappedSubjects: 0,
        unresolvedSubjects: 1,
        ambiguousSubjects: 1,
        coveragePercent: 0
      },
      unresolvedSubjects: {
        total: 1,
        byReason: {
          "declared-graph-unavailable": 0,
          "no-declared-target": 0,
          "multiple-declared-targets": 1,
          "relation-endpoint-unmapped": 0
        },
        subjectSelectorIds: ["subject.policy-test"]
      },
      evidenceStrengthDistribution: {
        heuristic: 0,
        declared: 0,
        observed: 2,
        verified: 0
      }
    },
    deltaDigest: digestJson({ candidateChanges: candidateChanges.map((change) => change.candidateChangeId) } as unknown as Json)
  };
}

function candidateChange(input: {
  id: string;
  targetKind: ArchitectureCandidateChangeV1["target"]["kind"];
  stateDimension?: ArchitectureCandidateChangeV1["stateDimension"];
  changeKind: ArchitectureCandidateChangeV1["changeKind"];
  confidence: ArchitectureCandidateChangeV1["confidence"];
  ambiguityIds?: string[];
  evidenceIds: string[];
}): ArchitectureCandidateChangeV1 {
  const draft = {
    candidateChangeId: `candidate_change.${input.id}`,
    kind: candidateChangeKind(input.targetKind, input.changeKind),
    target: {
      kind: input.targetKind,
      id: input.targetKind === "migration-state" ? `module.${input.id}:migration-state` : `module.${input.id}`
    },
    stateDimension: input.stateDimension ?? "target-state",
    changeKind: input.changeKind,
    subjectSelectorIds: [`subject.${input.id}`],
    mappingIds: [`mapping.${input.id}`],
    ambiguityIds: input.ambiguityIds ?? [],
    evidenceIds: input.evidenceIds,
    confidence: input.confidence,
    heuristic: true as const,
    summary: `Policy test candidate ${input.id}.`,
    digest: ""
  };
  return {
    ...draft,
    digest: digestJson(draft as unknown as Json)
  };
}

function candidateChangeKind(
  targetKind: ArchitectureCandidateChangeV1["target"]["kind"],
  changeKind: ArchitectureCandidateChangeV1["changeKind"]
): ArchitectureCandidateChangeV1["kind"] {
  const suffix = changeKind === "materially_changed" ? "materially-changed" : changeKind;
  return `${targetKind}-${suffix}` as ArchitectureCandidateChangeV1["kind"];
}

function evidenceItem(evidenceId: string, coverage: EvidenceItemV2["coverage"]["level"]): EvidenceItemV2 {
  const draft = {
    schemaVersion: "archcontext.evidence-item/v2" as const,
    evidenceId,
    kind: "policy-test",
    strength: "observed" as const,
    polarity: "positive" as const,
    origin: "codegraph" as const,
    subject: "subject.policy-test",
    selector: {
      kind: "path" as const,
      id: "subject.policy-test",
      path: "src/policy-test.ts"
    },
    summary: "Policy test evidence without source body or diff body.",
    coverage: {
      level: coverage,
      scope: "policy-test"
    },
    supports: ["recommendation" as const, "checkpoint" as const],
    provenance: {
      producer: "policy-engine-test",
      command: "evaluateArchitectureCandidateDeltaPolicy",
      inputDigest: digestJson({ input: evidenceId } as unknown as Json)
    },
    createdAt: "2026-06-26T00:00:00.000Z",
    digest: ""
  };
  return {
    ...draft,
    digest: digestJson(draft as unknown as Json)
  };
}
