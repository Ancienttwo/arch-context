import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  DEFAULT_GOVERNANCE_FEATURE_FLAGS,
  GITHUB_APP_PERMISSION_MANIFEST,
  GOVERNANCE_CHECK_NAMES,
  GOVERNANCE_REASON_CATALOG,
  ORGANIZATION_RUNNER_CHECK_NAME,
  RUNNER_IDENTITY_STATUS_TRANSITIONS,
  CALLER_PROVIDED_ATTESTATION_FIELDS,
  LLM_ADVISORY_FORBIDDEN_FIELDS,
  attestationV2Digest,
  assertCanTransitionChallenge,
  assertCanTransitionRunnerIdentityStatus,
  assertGovernanceFeatureFlagsAllow,
  assertNoLlmAdvisoryConclusionFields,
  assertRunnerIdentity,
  assertNoCallerProvidedAttestationFields,
  canTransitionChallenge,
  canTransitionCheckDelivery,
  canTransitionRunnerIdentityStatus,
  canonicalAttestationV2,
  checkNameForRequiredTrust,
  createAttestationV2,
  createRunnerIdentity,
  evaluateGovernanceFeatureFlags,
  findCallerProvidedAttestationFields,
  findLlmAdvisoryForbiddenFields,
  normalizeGovernanceFeatureFlags,
  requiredTrustForCheckName,
  runnerIdentityEffectiveScope,
  runnerIdentityKeyStatus,
  runnerIdentityMatchesScope,
  satisfiesRequiredTrust,
  transitionRunnerIdentityStatus,
  transitionReviewChallengeStatus,
  unsignedAttestationV2,
  type RunnerIdentity,
  type ReviewChallengeStatus,
  type ReviewChallengeV2
} from "../src/github-governance";
import {
  LEDGER_AUTHORITY_MATRIX,
  architectureEventHash,
  architectureSnapshotDigest
} from "../src/ledger";
import {
  ARCHCONTEXT_PACKAGE_MANAGER,
  ARCHCONTEXT_PRODUCT_VERSION,
  ARCHCONTEXT_SCHEMA_SET_VERSION,
  LOCAL_RUNTIME_RPC_SCHEMA_VERSION,
  productVersionManifest
} from "../src/product-version";
import { digestJson, errorEnvelope, okEnvelope, stableId, stableYaml, type Json } from "../src/schema";
import { validateJsonSchema } from "../src/validator";
import { EXPLORER_PROJECTION_CACHE_POLICY_SCHEMA_VERSION, type ExplorerProjectionCachePolicyV1 } from "../src/ports";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("Explorer cache policy contract keeps every retention and pin limit explicit", () => {
  const policy: ExplorerProjectionCachePolicyV1 = {
    schemaVersion: EXPLORER_PROJECTION_CACHE_POLICY_SCHEMA_VERSION,
    maxEntriesPerScope: 128,
    maxBytesPerScope: 64 * 1024 * 1024,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxPinnedEntriesPerScope: 8,
    maxPinTtlMs: 15 * 60 * 1000
  };
  expect(policy).toEqual(expect.objectContaining({
    schemaVersion: "archcontext.explorer-cache-policy/v1",
    maxPinnedEntriesPerScope: 8,
    maxPinTtlMs: 900_000
  }));
});
const schemaByFixture: Record<string, string> = {
  "architecture-node": "schemas/repo/architecture-node.schema.json",
  "architecture-relation": "schemas/repo/architecture-relation.schema.json",
  "cross-repo-relation": "schemas/repo/cross-repo-relation.schema.json",
  "landscape": "schemas/repo/landscape.schema.json",
  "constraint": "schemas/repo/constraint.schema.json",
  "architecture-intervention": "schemas/repo/architecture-intervention.schema.json",
  "compatibility-contract": "schemas/repo/compatibility-contract.schema.json",
  "practice": "schemas/repo/practices/practice.schema.json",
  "practice-profile": "schemas/repo/practices/practice-profile.schema.json",
  "practice-source": "schemas/repo/practices/practice-source.schema.json",
  "practice-policy": "schemas/repo/practices/practice-policy.schema.json",
  "practice-waiver": "schemas/repo/practices/practice-waiver.schema.json",
  "task-context": "schemas/runtime/task-context.schema.json",
  "changeset": "schemas/runtime/changeset.schema.json",
  "review-result": "schemas/runtime/review-result.schema.json",
  "explorer-projection-query-v2": "schemas/runtime/explorer-projection-query-v2.schema.json",
  "explorer-projection-v2": "schemas/runtime/explorer-projection-v2.schema.json",
  "explorer-delta-query": "schemas/runtime/explorer-delta-query.schema.json",
  "explorer-projection-delta": "schemas/runtime/explorer-projection-delta.schema.json",
  "explorer-service": "schemas/runtime/explorer-service.schema.json",
  "product-version-manifest": "schemas/runtime/product-version-manifest.schema.json",
  "external-document-resource": "schemas/runtime/external-document-resource.schema.json",
  "architecture-event": "schemas/runtime/architecture-event.schema.json",
  "architecture-snapshot": "schemas/runtime/architecture-snapshot.schema.json",
  "architecture-subject-selector": "schemas/runtime/architecture-subject-selector.schema.json",
  "architecture-candidate-delta": "schemas/runtime/architecture-candidate-delta.schema.json",
  "architecture-candidate-delta-policy": "schemas/runtime/architecture-candidate-delta-policy.schema.json",
  "projection-target": "schemas/runtime/projection-target.schema.json",
  "evidence-item": "schemas/runtime/evidence-item.schema.json",
  "evidence-binding": "schemas/runtime/evidence-binding.schema.json",
  "recommendation-run": "schemas/runtime/recommendation-run.schema.json",
  "recommendation": "schemas/runtime/recommendation.schema.json",
  "recommendation-feedback": "schemas/runtime/recommendation-feedback.schema.json",
  "agent-job": "schemas/runtime/agent-job.schema.json",
  "investigation-report": "schemas/runtime/investigation-report.schema.json",
  "practice-catalog-manifest": "schemas/runtime/practice-catalog-manifest.schema.json",
  "practice-match": "schemas/runtime/practice-match.schema.json",
  "practice-guidance": "schemas/runtime/practice-guidance.schema.json",
  "practice-check-result": "schemas/runtime/practice-check-result.schema.json",
  "practice-checkpoint": "schemas/runtime/practice-checkpoint.schema.json",
  "retrieval-config": "schemas/runtime/retrieval-config.schema.json",
  "retrieval-eval": "schemas/runtime/retrieval-eval.schema.json",
  "retrieval-decision": "schemas/runtime/retrieval-decision.schema.json",
  "notification-event": "schemas/runtime/notification-event.schema.json",
  "notification-provider": "schemas/runtime/notification-provider.schema.json",
  "likec4-mapping": "schemas/integrations/likec4-mapping.schema.json",
  "structurizr-mapping": "schemas/integrations/structurizr-mapping.schema.json",
  "adapter-fidelity": "schemas/integrations/adapter-fidelity.schema.json",
  "chatgpt-ga-tool": "schemas/integrations/chatgpt-ga-tool.schema.json",
  "attestation": "schemas/cloud/attestation.schema.json",
  "review-challenge-v2": "schemas/cloud/review-challenge-v2.schema.json",
  "attestation-v2": "schemas/cloud/attestation-v2.schema.json",
  "runner-identity": "schemas/cloud/runner-identity.schema.json",
  "device-identity": "schemas/cloud/device-identity.schema.json",
  "governance-key-status": "schemas/cloud/governance-key-status.schema.json",
  "check-delivery": "schemas/cloud/check-delivery.schema.json",
  "cloud-egress-envelope": "schemas/cloud/cloud-egress-envelope.schema.json",
  "org-runner-identity": "schemas/cloud/org-runner-identity.schema.json",
  "entitlement": "schemas/cloud/entitlement.schema.json"
};

function readJson(path: string): Json {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

describe("JSON schema contracts", () => {
  for (const [fixtureName, schemaPath] of Object.entries(schemaByFixture)) {
    test(`${fixtureName} accepts valid fixture`, () => {
      const schema = readJson(schemaPath);
      const fixture = readJson(`packages/contracts/fixtures/valid/${fixtureName}.json`);
      const result = validateJsonSchema(schema as any, fixture);
      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    });

    test(`${fixtureName} rejects unknown top-level fields`, () => {
      const schema = readJson(schemaPath);
      const fixture = readJson(`packages/contracts/fixtures/valid/${fixtureName}.json`) as Record<string, Json>;
      const result = validateJsonSchema(schema as any, { ...fixture, unexpectedField: true });
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.message.includes("additional property"))).toBe(true);
    });
  }

  test("boundary extensions are allowed only through extensions", () => {
    const schema = readJson("schemas/repo/architecture-node.schema.json");
    const fixture = readJson("packages/contracts/fixtures/boundary/architecture-node-extension.json");
    expect(validateJsonSchema(schema as any, fixture).valid).toBe(true);
  });

  test("all boundary fixtures are accepted by their schema", () => {
    const boundaryFixtures = readdirSync(join(root, "packages/contracts/fixtures/boundary"))
      .filter((file) => file.endsWith(".json"))
      .sort();

    for (const file of boundaryFixtures) {
      const fixture = readJson(`packages/contracts/fixtures/boundary/${file}`) as Record<string, Json>;
      const schemaPath = schemaByFixture[fixtureNameFromSchemaVersion(fixture.schemaVersion)];
      const result = validateJsonSchema(readJson(schemaPath) as any, fixture);
      expect(result.issues, file).toEqual([]);
      expect(result.valid, file).toBe(true);
    }
  });

  test("projection-target schema accepts the agent-context targetType (ADR-0043)", () => {
    const schema = readJson("schemas/runtime/projection-target.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/projection-target.json") as Record<string, Json>;

    const agentContextFixture = {
      ...fixture,
      type: "agent-context",
      scope: { kind: "entity", id: "capability.example.agent-context", entityKind: "capability" }
    };
    expect(validateJsonSchema(schema as any, agentContextFixture as Json).valid).toBe(true);
    expect(validateJsonSchema(schema as any, { ...fixture, type: "agent-contexts" } as Json).valid).toBe(false);
  });

  test("practice policy schema accepts explicit fail-open and fail-closed modes", () => {
    const schema = readJson("schemas/repo/practices/practice-policy.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/practice-policy.json") as Record<string, Json>;

    expect(validateJsonSchema(schema as any, { ...fixture, mode: "fail-open" } as Json).valid).toBe(true);
    expect(validateJsonSchema(schema as any, { ...fixture, mode: "fail-closed" } as Json).valid).toBe(true);
    expect(validateJsonSchema(schema as any, { ...fixture, mode: "enforce" } as Json).valid).toBe(false);
  });

  test("runner identity scope schema keeps repository and organization shapes disjoint", () => {
    const schema = readJson("schemas/cloud/runner-identity.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/runner-identity.json") as Record<string, Json>;
    expect(validateJsonSchema(schema as any, {
      ...fixture,
      scope: { kind: "repository", repositoryIds: [20001] }
    }).valid).toBe(true);
    expect(validateJsonSchema(schema as any, {
      ...fixture,
      repositoryIds: [],
      scope: { kind: "organization" }
    }).valid).toBe(true);
    expect(validateJsonSchema(schema as any, {
      ...fixture,
      repositoryIds: [],
      scope: { kind: "organization", repositoryIds: [20001] }
    }).valid).toBe(false);
    expect(validateJsonSchema(schema as any, {
      ...fixture,
      scope: { kind: "repository" }
    }).valid).toBe(false);
  });

  test("Attestation v2 schema requires workflow run metadata for organization execution only", () => {
    const schema = readJson("schemas/cloud/attestation-v2.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/attestation-v2.json") as Record<string, Json>;
    const organizationExecution = {
      trustLevel: "organization",
      source: "organization-runner-checkout",
      principalId: "runner_0001",
      publicKeyId: "key_runner_0001",
      runnerId: "runner_0001",
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      runId: "1234567890",
      runAttempt: 1
    };

    expect(validateJsonSchema(schema as any, {
      ...fixture,
      execution: organizationExecution
    } as Json).valid).toBe(true);
    expect(validateJsonSchema(schema as any, {
      ...fixture,
      execution: {
        ...organizationExecution,
        runId: undefined
      }
    } as unknown as Json).valid).toBe(false);
    expect(validateJsonSchema(schema as any, {
      ...fixture,
      execution: {
        ...(fixture.execution as Record<string, Json>),
        runnerId: "runner_0001"
      }
    } as Json).valid).toBe(false);
  });

  test("LLM Advisory contract rejects conclusion and Attestation-shaping fields", () => {
    expect(LLM_ADVISORY_FORBIDDEN_FIELDS).toEqual([
      "result",
      "reviewDigest",
      "policyDigest",
      "modelDigest",
      "signature",
      "practiceEnforcement",
      "practiceViolations",
      "waiversApplied",
      "actionsRequired",
      "practiceCatalogDigest",
      "practicePolicyDigest",
      "practiceCheckResultDigest",
      "conclusion",
      "checkConclusion",
      "attestationResult"
    ]);
    const advisory = {
      architectureThesis: "Split the compatibility wrapper after the migration target is stable.",
      repairSteps: ["Remove the fallback after the last caller is migrated."],
      nested: {
        conclusion: "success",
        modelDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      }
    };

    expect(findLlmAdvisoryForbiddenFields(advisory)).toEqual(["modelDigest", "conclusion"]);
    expect(() => assertNoLlmAdvisoryConclusionFields(advisory)).toThrow(
      "llm-advisory-conclusion-field-forbidden: modelDigest,conclusion"
    );
    expect(() => assertNoLlmAdvisoryConclusionFields({
      architectureThesis: "This text is advisory only.",
      proofPointSuggestions: ["Inspect the compatibility contract evidence."]
    })).not.toThrow();
  });

  test("compatibility contract rejects non-contract reasons", () => {
    const schema = readJson("schemas/repo/compatibility-contract.schema.json");
    const fixture = readJson("packages/contracts/fixtures/invalid/compatibility-illegal-reason.json");
    expect(validateJsonSchema(schema as any, fixture).valid).toBe(false);
  });

  test("all invalid fixtures are rejected", () => {
    const invalidFixtures = readdirSync(join(root, "packages/contracts/fixtures/invalid"))
      .filter((file) => file.endsWith(".json"))
      .sort();

    expect(invalidFixtures.length).toBeGreaterThan(0);

    for (const file of invalidFixtures) {
      const fixture = readJson(`packages/contracts/fixtures/invalid/${file}`) as Record<string, Json>;
      const schemaPath = schemaByFixture[fixtureNameFromSchemaVersion(fixture.schemaVersion)];
      const result = validateJsonSchema(readJson(schemaPath) as any, fixture);
      expect(result.valid, file).toBe(false);
      expect(result.issues.length, file).toBeGreaterThan(0);
    }
  });

  test("all valid fixtures have a matching schema", () => {
    const fixtures = readdirSync(join(root, "packages/contracts/fixtures/valid"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => basename(file, ".json"))
      .sort();
    expect(fixtures).toEqual(Object.keys(schemaByFixture).sort());
  });

  test("notification event is a Check-level whitelist and rejects private content fields", () => {
    const schema = readJson("schemas/runtime/notification-event.schema.json") as any;
    const fixture = readJson("packages/contracts/fixtures/valid/notification-event.json") as Record<string, Json>;
    expect(Object.keys(schema.properties).sort()).toEqual([
      "commitSha",
      "eventId",
      "occurredAt",
      "prUrl",
      "result",
      "riskLevel",
      "runtimeVersion",
      "schemaVersion"
    ]);
    for (const field of ["code", "diff", "finding", "findings", "architectureBody", "modelBody"]) {
      expect(validateJsonSchema(schema, { ...fixture, [field]: "private content" }).valid).toBe(false);
    }
  });

  test("adapter fidelity contract keeps Native model as source of truth", () => {
    const schema = readJson("schemas/integrations/adapter-fidelity.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/adapter-fidelity.json") as Record<string, Json>;
    expect(validateJsonSchema(schema as any, fixture).valid).toBe(true);
    expect(fixture.nativeIsSourceOfTruth).toBe(true);
    expect(fixture.reverseSync).toBe("forbidden");
    expect(fixture.protectedNativeFields).toEqual(["evidence", "verification", "constraint", "intervention"]);
  });

  test("explorer projection contract is read-only and contains no SaaS egress fields", () => {
    const v2 = readJson("schemas/runtime/explorer-projection-v2.schema.json") as any;
    const v2RootProperties = Object.keys(v2.properties);
    for (const forbidden of ["operation", "operations", "changeset", "mutationEndpoint", "saasEndpoint", "remoteUrl", "sourceBody", "rawDiff", "codeGraphBody"]) {
      expect(v2RootProperties).not.toContain(forbidden);
    }
    expect(v2.properties.capabilities.properties.readOnly.const).toBe(true);
    expect(v2.properties.capabilities.properties.mutationMode.const).toBe("forbidden");
    expect(v2.properties.capabilities.properties.egress.const).toBe("none");

    const fixture = readJson("packages/contracts/fixtures/valid/explorer-projection-v2.json") as any;
    const ledgerWithoutCursor = structuredClone(fixture);
    ledgerWithoutCursor.cursor.authoritySource = "ledger";
    expect(validateJsonSchema(v2, ledgerWithoutCursor).valid).toBe(false);
    const unavailableRequired = structuredClone(fixture);
    unavailableRequired.inputManifest.inputDomains.graph = {
      requirement: "required", status: "unavailable", digest: null, reasonCode: "not-provided"
    };
    expect(validateJsonSchema(v2, unavailableRequired).valid).toBe(false);
    const notUsedOptional = structuredClone(fixture);
    notUsedOptional.inputManifest.inputDomains["event-backlinks"] = {
      requirement: "optional", status: "not-used", digest: null
    };
    expect(validateJsonSchema(v2, notUsedOptional).valid).toBe(false);
    const nestedUnknown = structuredClone(fixture);
    nestedUnknown.occurrences[0].inspector.sourceSelectors = [{ path: "src/runtime.ts", memo: "private body" }];
    expect(validateJsonSchema(v2, nestedUnknown).valid).toBe(false);
    const missingHistory = structuredClone(fixture);
    delete missingHistory.occurrences[0].inspector.historyEvents;
    expect(validateJsonSchema(v2, missingHistory).valid).toBe(false);
    const privateHistoryBody = structuredClone(fixture);
    privateHistoryBody.occurrences[0].inspector.historyEvents = [{ eventId: "event.private", eventBody: "private body" }];
    expect(validateJsonSchema(v2, privateHistoryBody).valid).toBe(false);
  });

  test("retrieval decision gate exposes machine-checkable thresholds", () => {
    const schema = readJson("schemas/runtime/retrieval-decision.schema.json") as any;
    expect(schema.properties.thresholds.required.sort()).toEqual([
      "maxIrrelevantRatio",
      "maxToolCallIncrease",
      "minConstraintRecallLift",
      "minContextRecallLift"
    ]);
    const fixture = readJson("packages/contracts/fixtures/valid/retrieval-decision.json") as any;
    expect(fixture.thresholds.minContextRecallLift).toBeGreaterThan(0);
    expect(fixture.decision).toBe("keep-lexical");
  });

  test("architecture ledger contracts freeze authority and digest rules", () => {
    expect(LEDGER_AUTHORITY_MATRIX.declared.writer).toContain("ChangeSet-approved Git projection");
    expect(LEDGER_AUTHORITY_MATRIX.observed.conflictPolicy).toContain("cannot overwrite declared facts");
    expect(LEDGER_AUTHORITY_MATRIX.proposed.conflictPolicy).toContain("non-authoritative");
    expect(LEDGER_AUTHORITY_MATRIX.projected.conflictPolicy).toContain("drift");

    const event = readJson("packages/contracts/fixtures/valid/architecture-event.json") as any;
    expect(architectureEventHash({ ...event, eventHash: `sha256:${"f".repeat(64)}` })).toBe(architectureEventHash(event));

    const snapshot = readJson("packages/contracts/fixtures/valid/architecture-snapshot.json") as any;
    expect(architectureSnapshotDigest({
      ...snapshot,
      snapshotId: "arch_snapshot.different_id",
      createdAt: "2026-06-25T01:00:00.000Z"
    })).toBe(architectureSnapshotDigest(snapshot));
  });

  test("architecture ledger schemas reject unsupported versions", () => {
    const schema = readJson("schemas/runtime/architecture-event.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/architecture-event.json") as Record<string, Json>;
    expect(validateJsonSchema(schema as any, { ...fixture, schemaVersion: "archcontext.architecture-event/v2" }).valid).toBe(false);
  });

  test("architecture event schema requires explicit V2 evidence lifecycle operations", () => {
    const schema = readJson("schemas/runtime/architecture-event.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/architecture-event.json") as Record<string, Json>;
    const evidenceItem = readJson("packages/contracts/fixtures/valid/evidence-item.json") as Record<string, Json>;
    const lifecycle = {
      ...fixture,
      payloadVersion: "archcontext.architecture-evidence-lifecycle/v2",
      payload: {
        ...(fixture.payload as Record<string, Json>),
        evidenceOperations: [{ target: "item", action: "create", evidenceId: evidenceItem.evidenceId, value: evidenceItem }]
      }
    };
    expect(validateJsonSchema(schema as any, lifecycle).valid).toBe(true);
    expect(validateJsonSchema(schema as any, {
      ...lifecycle,
      payloadVersion: "v1"
    }).valid).toBe(false);
    expect(validateJsonSchema(schema as any, {
      ...lifecycle,
      payload: {
        ...(lifecycle.payload as Record<string, Json>),
        evidenceOperations: [{ target: "item", action: "create", evidenceId: "evidence.api", value: {} }]
      }
    }).valid).toBe(false);
    expect(validateJsonSchema(schema as any, {
      ...lifecycle,
      payload: {
        ...(lifecycle.payload as Record<string, Json>),
        evidenceOperations: [{ target: "item", action: "remove", evidenceId: "evidence.api", reasonCode: "superseded" }]
      }
    }).valid).toBe(false);
  });

  test("Explorer Delta V2 grouped arrays enforce their authority class", () => {
    const schema = readJson("schemas/runtime/explorer-projection-delta.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/explorer-projection-delta.json") as Record<string, Json>;
    expect(validateJsonSchema(schema as any, fixture).valid).toBe(true);
    const factChanges = structuredClone(fixture.factChanges) as Array<Record<string, Json>>;
    factChanges[0] = { ...factChanges[0], deltaClass: "evidence" };
    expect(validateJsonSchema(schema as any, { ...fixture, factChanges }).valid).toBe(false);
  });

  test("recommendation feedback requires explicit local feedback and rejects raw private fields", () => {
    const schema = readJson("schemas/runtime/recommendation-feedback.schema.json");
    const fixture = readJson("packages/contracts/fixtures/valid/recommendation-feedback.json") as Record<string, Json>;
    expect(validateJsonSchema(schema as any, fixture).valid).toBe(true);
    expect(validateJsonSchema(schema as any, { ...fixture, implicitAcceptance: true }).valid).toBe(false);
    for (const field of ["sourceCode", "rawDiff", "prompt", "completion"]) {
      expect(validateJsonSchema(schema as any, { ...fixture, [field]: "private content" }).valid).toBe(false);
    }
  });
});

function fixtureNameFromSchemaVersion(schemaVersion: Json): string {
  if (typeof schemaVersion !== "string") throw new Error("Fixture schemaVersion must be a string");
  const byVersion: Record<string, string> = {
    "archcontext.node/v1": "architecture-node",
    "archcontext.relation/v1": "architecture-relation",
    "archcontext.cross-repo-relation/v1": "cross-repo-relation",
    "archcontext.landscape/v1": "landscape",
    "archcontext.constraint/v1": "constraint",
    "archcontext.intervention/v1": "architecture-intervention",
    "archcontext.compatibility/v1": "compatibility-contract",
    "archcontext.practice/v1": "practice",
    "archcontext.practice-profile/v1": "practice-profile",
    "archcontext.practice-source/v1": "practice-source",
    "archcontext.practice-enforcement-policy/v1": "practice-policy",
    "archcontext.practice-waiver/v1": "practice-waiver",
    "archcontext.practice-match/v1": "practice-match",
    "archcontext.practice-guidance/v1": "practice-guidance",
    "archcontext.practice-check-result/v1": "practice-check-result",
    "archcontext.task-context/v1": "task-context",
    "archcontext.changeset/v1": "changeset",
    "archcontext.review/v1": "review-result",
    "archcontext.explorer-projection-query/v2": "explorer-projection-query-v2",
    "archcontext.explorer-projection/v2": "explorer-projection-v2",
    "archcontext.explorer-delta-query/v2": "explorer-delta-query",
    "archcontext.explorer-projection-delta/v2": "explorer-projection-delta",
    "archcontext.explorer-service/v1": "explorer-service",
    "archcontext.product-version-manifest/v1": "product-version-manifest",
    "archcontext.practice-catalog-manifest/v1": "practice-catalog-manifest",
    "archcontext.architecture-event/v1": "architecture-event",
    "archcontext.architecture-snapshot/v2": "architecture-snapshot",
    "archcontext.projection-target/v1": "projection-target",
    "archcontext.evidence-item/v2": "evidence-item",
    "archcontext.evidence-binding/v1": "evidence-binding",
    "archcontext.architecture-candidate-delta-policy/v1": "architecture-candidate-delta-policy",
    "archcontext.recommendation-run/v1": "recommendation-run",
    "archcontext.recommendation/v2": "recommendation",
    "archcontext.recommendation-feedback/v1": "recommendation-feedback",
    "archcontext.agent-job/v1": "agent-job",
    "archcontext.investigation-report/v1": "investigation-report",
    "archcontext.retrieval-config/v1": "retrieval-config",
    "archcontext.retrieval-eval/v1": "retrieval-eval",
    "archcontext.retrieval-decision/v1": "retrieval-decision",
    "archcontext.notification-event/v1": "notification-event",
    "archcontext.notification-provider/v1": "notification-provider",
    "archcontext.likec4-mapping/v1": "likec4-mapping",
    "archcontext.structurizr-mapping/v1": "structurizr-mapping",
    "archcontext.adapter-fidelity/v1": "adapter-fidelity",
    "archcontext.chatgpt-ga-tool/v1": "chatgpt-ga-tool",
    "archcontext.attestation/v1": "attestation",
    "archcontext.review-challenge/v2": "review-challenge-v2",
    "archcontext.attestation/v2": "attestation-v2",
    "archcontext.runner-identity/v1": "runner-identity",
    "archcontext.device-identity/v1": "device-identity",
    "archcontext.governance-key-status/v1": "governance-key-status",
    "archcontext.check-delivery/v1": "check-delivery",
    "archcontext.cloud-egress/v1": "cloud-egress-envelope",
    "archcontext.org-runner-identity/v1": "org-runner-identity",
    "archcontext.entitlement/v1": "entitlement"
  };
  const fixtureName = byVersion[schemaVersion];
  if (!fixtureName) throw new Error(`Unknown schemaVersion: ${schemaVersion}`);
  return fixtureName;
}

describe("contract utilities", () => {
  test("digest canonicalization is key-order stable", () => {
    expect(digestJson({ b: 2, a: 1 })).toBe(digestJson({ a: 1, b: 2 }));
  });

  test("stable ID generation uses dot notation", () => {
    expect(stableId("Module", "Subscription API")).toBe("module.subscription-api");
  });

  test("stable YAML renderer keeps deterministic key order", () => {
    expect(stableYaml({ b: 2, a: 1 })).toBe("a: 1\nb: 2\n");
  });

  test("CLI envelope preserves success and error shape", () => {
    expect(okEnvelope("req_1", { value: "ok" }).schemaVersion).toBe("archcontext.envelope/v1");
    const failed = errorEnvelope("req_2", "AC_PATH_DENIED", "outside allowlist");
    expect(failed.ok).toBe(false);
    expect(failed.error?.retryable).toBe(false);
  });

  test("product version manifest aligns CLI, daemon, MCP, schema, and package versions", () => {
    const manifest = productVersionManifest();
    const schema = readJson("schemas/runtime/product-version-manifest.schema.json");
    const rootManifest = readJson("package.json") as any;
    const contractManifest = readJson("packages/contracts/package.json") as any;
    const runtimeManifest = readJson("packages/local-runtime/package.json") as any;
    const surfacesManifest = readJson("packages/surfaces/package.json") as any;

    expect(validateJsonSchema(schema as any, manifest as unknown as Json).valid).toBe(true);
    expect(manifest.product.version).toBe(rootManifest.version);
    expect(manifest.product.version).toBe(ARCHCONTEXT_PRODUCT_VERSION);
    expect(manifest.packageManager).toBe(ARCHCONTEXT_PACKAGE_MANAGER);
    expect(manifest.schemas.schemaSetVersion).toBe(ARCHCONTEXT_SCHEMA_SET_VERSION);
    expect(manifest.schemas.contractsPackageVersion).toBe(contractManifest.version);
    expect(manifest.surfaces.daemon.version).toBe(runtimeManifest.version);
    expect(manifest.surfaces.cli.version).toBe(surfacesManifest.version);
    expect(manifest.surfaces.mcp.version).toBe(surfacesManifest.version);
    expect(manifest.runtime.localRpc.schemaVersion).toBe(LOCAL_RUNTIME_RPC_SCHEMA_VERSION);
    expect(manifest.surfaces.daemon.rpcSchemaVersion).toBe(LOCAL_RUNTIME_RPC_SCHEMA_VERSION);
  });
});

describe("GitHub governance contracts", () => {
  test("freezes the GitHub App permission manifest", () => {
    expect(GITHUB_APP_PERMISSION_MANIFEST.schemaVersion).toBe("archcontext.github-app-permission-manifest/v1");
    expect(GITHUB_APP_PERMISSION_MANIFEST.repositoryPermissions).toEqual({
      metadata: "read",
      pull_requests: "read",
      checks: "write",
      statuses: "write",
      contents: "none"
    });
    expect(GITHUB_APP_PERMISSION_MANIFEST.forbiddenByDefault).toEqual([
      "actions",
      "administration",
      "deployments",
      "issues",
      "members",
      "secrets",
      "workflows"
    ]);
    expect(GITHUB_APP_PERMISSION_MANIFEST.conditionalPermissions.commit_statuses).toEqual({
      default: "none",
      implemented: "write",
      decisionGate: "FG2-02 / FG2-EG6",
      reason: "GitHub ruleset expected-source App binding requires statuses:write; runtime still publishes Checks, not commit statuses."
    });
    expect(GITHUB_APP_PERMISSION_MANIFEST.subscribedEvents).toEqual([
      "installation",
      "installation_repositories",
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.synchronize",
      "pull_request.closed",
      "check_run.rerequested"
    ]);
  });

  test("freezes separate Developer and Organization check contexts", () => {
    expect(GOVERNANCE_CHECK_NAMES).toEqual([
      "ArchContext / Developer Review",
      "ArchContext / Organization Runner"
    ]);
    expect(DEVELOPER_REVIEW_CHECK_NAME).not.toBe(ORGANIZATION_RUNNER_CHECK_NAME);

    const schema = readJson("schemas/cloud/check-delivery.schema.json") as any;
    expect(schema.properties.checkName.enum).toEqual([...GOVERNANCE_CHECK_NAMES]);
    const legacy = readJson("packages/contracts/fixtures/invalid/check-delivery-legacy-check-name.json");
    expect(validateJsonSchema(schema, legacy).valid).toBe(false);
    const exactLegacyName = ["ArchContext", "Architecture Review"].join(" / ");
    const validDelivery = readJson("packages/contracts/fixtures/valid/check-delivery.json") as Record<string, Json>;
    expect(validateJsonSchema(schema, { ...validDelivery, checkName: exactLegacyName }).valid).toBe(false);
  });

  test("requiredTrust rejects developer evidence for organization policy", () => {
    expect(satisfiesRequiredTrust("developer", "developer")).toBe(true);
    expect(satisfiesRequiredTrust("organization", "developer")).toBe(true);
    expect(satisfiesRequiredTrust("organization", "organization")).toBe(true);
    expect(satisfiesRequiredTrust("developer", "organization")).toBe(false);
  });

  test("feature flags gate Developer Check Organization Check and requiredTrust separately", () => {
    expect(DEFAULT_GOVERNANCE_FEATURE_FLAGS).toEqual({
      schemaVersion: "archcontext.governance-feature-flags/v1",
      developerCheck: true,
      organizationCheck: true,
      requiredTrust: true
    });
    expect(checkNameForRequiredTrust("developer")).toBe(DEVELOPER_REVIEW_CHECK_NAME);
    expect(checkNameForRequiredTrust("organization")).toBe(ORGANIZATION_RUNNER_CHECK_NAME);
    expect(requiredTrustForCheckName(DEVELOPER_REVIEW_CHECK_NAME)).toBe("developer");
    expect(requiredTrustForCheckName(ORGANIZATION_RUNNER_CHECK_NAME)).toBe("organization");

    const enabled = evaluateGovernanceFeatureFlags({ requiredTrust: "organization" });
    expect(enabled).toMatchObject({
      allowed: true,
      reason: "enabled",
      checkName: ORGANIZATION_RUNNER_CHECK_NAME
    });
    expect(enabled.metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evaluateGovernanceFeatureFlags({
      requiredTrust: "developer",
      flags: { developerCheck: false }
    })).toMatchObject({
      allowed: false,
      reason: "developer-check-disabled",
      disabledFlag: "developerCheck"
    });
    expect(evaluateGovernanceFeatureFlags({
      requiredTrust: "organization",
      flags: { organizationCheck: false }
    })).toMatchObject({
      allowed: false,
      reason: "organization-check-disabled",
      disabledFlag: "organizationCheck"
    });
    expect(evaluateGovernanceFeatureFlags({
      requiredTrust: "organization",
      flags: { requiredTrust: false }
    })).toMatchObject({
      allowed: false,
      reason: "required-trust-disabled",
      disabledFlag: "requiredTrust"
    });
    expect(normalizeGovernanceFeatureFlags({ developerCheck: false }).organizationCheck).toBe(true);
    expect(() => normalizeGovernanceFeatureFlags({ developerCheck: "false" as unknown as boolean })).toThrow("governance-feature-flag-developerCheck-invalid");
    expect(() => assertGovernanceFeatureFlagsAllow({
      requiredTrust: "organization",
      flags: { requiredTrust: false }
    })).toThrow("governance-feature-disabled: required-trust-disabled");
  });

  test("RunnerIdentity domain normalizes repository scope and enforces workflow binding", () => {
    const identity = createRunnerIdentity({
      runnerId: "runner_0001",
      installationId: 10001,
      repositoryIds: [20002, 20002, 20001],
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_0001",
      publicKeyFingerprint: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      status: "active",
      createdAt: "2026-06-20T09:00:00Z"
    });

    expect(identity.repositoryIds).toEqual([20001, 20002]);
    expect(runnerIdentityEffectiveScope(identity)).toEqual({ kind: "repository", repositoryIds: [20001, 20002] });
    expect(runnerIdentityMatchesScope(identity, {
      installationId: 10001,
      repositoryId: 20002,
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main"
    })).toBe(true);
    expect(runnerIdentityMatchesScope(identity, { installationId: 10001, repositoryId: 99999 })).toBe(false);
    expect(runnerIdentityMatchesScope(identity, { installationId: 99999, repositoryId: 20002 })).toBe(false);
    expect(runnerIdentityMatchesScope(identity, {
      installationId: 10001,
      repositoryId: 20002,
      workflowRef: "owner/repo/.github/workflows/other.yml@refs/heads/main"
    })).toBe(false);
    expect(() => assertRunnerIdentity({ ...identity, scope: { kind: "repository", repositoryIds: [99999] } })).toThrow("runner-identity-scope-repositoryIds-mismatch");
    expect(() => assertRunnerIdentity({ ...identity, repositoryIds: [] })).toThrow("runner-identity-repositoryIds-empty");
    expect(() => assertRunnerIdentity({ ...identity, workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@main" })).toThrow("runner-identity-workflowRef-invalid");
  });

  test("RunnerIdentity supports installation-level organization scope", () => {
    const identity = createRunnerIdentity({
      runnerId: "runner_org_0001",
      installationId: 10001,
      scope: { kind: "organization" },
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_org_0001",
      publicKeyFingerprint: "sha256:8888888888888888888888888888888888888888888888888888888888888888",
      status: "active",
      createdAt: "2026-06-20T09:00:00Z"
    });

    expect(identity.repositoryIds).toEqual([]);
    expect(runnerIdentityEffectiveScope(identity)).toEqual({ kind: "organization" });
    expect(runnerIdentityMatchesScope(identity, { installationId: 10001, repositoryId: 20002 })).toBe(true);
    expect(runnerIdentityMatchesScope(identity, { installationId: 10001, repositoryId: 99999 })).toBe(true);
    expect(runnerIdentityMatchesScope(identity, { installationId: 99999, repositoryId: 20002 })).toBe(false);
    expect(() => assertRunnerIdentity({ ...identity, repositoryIds: [20002] })).toThrow("runner-identity-organization-scope-repositoryIds-must-be-empty");
  });

  test("RunnerIdentity status transitions and key status are explicit", () => {
    expect(RUNNER_IDENTITY_STATUS_TRANSITIONS).toEqual({
      active: ["rotating", "revoked"],
      rotating: ["active", "revoked"],
      revoked: []
    });
    const active = readJson("packages/contracts/fixtures/valid/runner-identity.json") as unknown as RunnerIdentity;
    expect(canTransitionRunnerIdentityStatus("active", "rotating")).toBe(true);
    expect(canTransitionRunnerIdentityStatus("rotating", "active")).toBe(true);
    expect(canTransitionRunnerIdentityStatus("revoked", "active")).toBe(false);
    expect(() => assertCanTransitionRunnerIdentityStatus("revoked", "active")).toThrow("runner-identity-transition-invalid: revoked->active");

    const rotating = transitionRunnerIdentityStatus(active, "rotating", "2026-06-20T09:05:00Z");
    expect(rotating.status).toBe("rotating");
    expect(rotating.rotatedAt).toBe("2026-06-20T09:05:00Z");
    expect(rotating.revokedAt).toBeNull();
    const rotatedActive = transitionRunnerIdentityStatus(rotating, "active", "2026-06-20T09:06:00Z");
    expect(rotatedActive.status).toBe("active");
    expect(rotatedActive.rotatedAt).toBe("2026-06-20T09:06:00Z");
    const revoked = transitionRunnerIdentityStatus(rotatedActive, "revoked", "2026-06-20T09:07:00Z");
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe("2026-06-20T09:07:00Z");
    expect(runnerIdentityKeyStatus(revoked)).toEqual({
      schemaVersion: "archcontext.governance-key-status/v1",
      publicKeyId: "key_runner_0001",
      ownerKind: "runner",
      ownerId: "runner_0001",
      fingerprint: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      status: "revoked",
      createdAt: "2026-06-20T09:00:00Z",
      rotatedAt: "2026-06-20T09:06:00Z",
      revokedAt: "2026-06-20T09:07:00Z"
    });
  });

  test("freezes caller-provided Attestation field denylist for Agent CLI and MCP inputs", () => {
    expect(CALLER_PROVIDED_ATTESTATION_FIELDS).toEqual([
      "result",
      "reviewDigest",
      "policyDigest",
      "modelDigest",
      "signature",
      "practiceEnforcement",
      "practiceViolations",
      "waiversApplied",
      "actionsRequired",
      "practiceCatalogDigest",
      "practicePolicyDigest",
      "practiceCheckResultDigest"
    ]);
    const forged = {
      challengeId: "chal_1",
      result: "pass",
      digests: {
        reviewDigest: `sha256:${"1".repeat(64)}`,
        policyDigest: `sha256:${"2".repeat(64)}`,
        modelDigest: `sha256:${"3".repeat(64)}`,
        practiceCheckResultDigest: `sha256:${"4".repeat(64)}`
      },
      nested: {
        signature: { algorithm: "ed25519", value: "forged" },
        practiceViolations: []
      }
    };
    expect(findCallerProvidedAttestationFields(forged)).toEqual([
      "result",
      "reviewDigest",
      "policyDigest",
      "modelDigest",
      "signature",
      "practiceViolations",
      "practiceCheckResultDigest"
    ]);
    expect(() => assertNoCallerProvidedAttestationFields(forged, "agent")).toThrow(
      "agent-caller-provided-attestation-field-forbidden: result,reviewDigest,policyDigest,modelDigest,signature,practiceViolations,practiceCheckResultDigest"
    );
    expect(() => assertNoCallerProvidedAttestationFields({ challengeId: "chal_1", taskSessionId: "task_1" }, "agent")).not.toThrow();
  });

  test("Attestation v2 canonical signing payload excludes signature value", () => {
    const schema = readJson("schemas/cloud/attestation-v2.schema.json") as any;
    const fixture = readJson("packages/contracts/fixtures/valid/attestation-v2.json") as any;
    const { schemaVersion: _schemaVersion, attestationId: _attestationId, signature: _signature, ...input } = fixture;
    const signedA = createAttestationV2({
      ...input,
      signature: { algorithm: "ed25519", value: "signature_a" }
    });
    const signedB = createAttestationV2({
      ...input,
      signature: { algorithm: "ed25519", value: "signature_b" }
    });

    expect(validateJsonSchema(schema, signedA as unknown as Json).valid).toBe(true);
    expect(JSON.parse(canonicalAttestationV2(signedA))).toEqual(unsignedAttestationV2(signedA));
    expect(canonicalAttestationV2(signedA)).toBe(canonicalAttestationV2(signedB));
    expect(attestationV2Digest(signedA)).toBe(attestationV2Digest(signedB));
  });

  test("challenge and check delivery state machines reject illegal backward moves", () => {
    expect(canTransitionChallenge("PENDING", "LEASED")).toBe(true);
    expect(canTransitionChallenge("LEASED", "PENDING")).toBe(false);
    expect(canTransitionChallenge("VERIFIED", "REJECTED")).toBe(false);
    expect(() => assertCanTransitionChallenge("LEASED", "PENDING")).toThrow("challenge-transition-invalid: LEASED->PENDING");
    expect(() => assertCanTransitionChallenge("VERIFIED", "REJECTED")).toThrow("challenge-transition-invalid: VERIFIED->REJECTED");
    expect(() => assertCanTransitionChallenge("PENDING" as ReviewChallengeStatus, "PENDING")).toThrow("challenge-transition-invalid: PENDING->PENDING");

    expect(canTransitionCheckDelivery("PENDING", "RETRYING")).toBe(true);
    expect(canTransitionCheckDelivery("RETRYING", "PUBLISHED")).toBe(true);
    expect(canTransitionCheckDelivery("RETRYING", "DEAD_LETTER")).toBe(true);
    expect(canTransitionCheckDelivery("DEAD_LETTER", "PENDING")).toBe(true);
    expect(canTransitionCheckDelivery("PUBLISHED", "RETRYING")).toBe(false);
    expect(canTransitionCheckDelivery("PUBLISHED", "DEAD_LETTER")).toBe(false);
  });

  test("ReviewChallenge v2 transition returns a new value only for legal moves", () => {
    const challenge = readJson("packages/contracts/fixtures/valid/review-challenge-v2.json") as unknown as ReviewChallengeV2;
    const leased = transitionReviewChallengeStatus(challenge, "LEASED");
    expect(leased).toEqual({ ...challenge, status: "LEASED" });
    expect(challenge.status).toBe("PENDING");
    expect(transitionReviewChallengeStatus(leased, "SUBMITTED").status).toBe("SUBMITTED");
    expect(() => transitionReviewChallengeStatus(leased, "PENDING")).toThrow("challenge-transition-invalid: LEASED->PENDING");
    expect(() => transitionReviewChallengeStatus({ ...challenge, status: "VERIFIED" }, "EXPIRED")).toThrow("challenge-transition-invalid: VERIFIED->EXPIRED");
    expect(canTransitionChallenge("PENDING", "NOT_A_STATUS" as ReviewChallengeStatus)).toBe(false);
    expect(() => assertCanTransitionChallenge("NOT_A_STATUS" as ReviewChallengeStatus, "LEASED")).toThrow("challenge-status-invalid: NOT_A_STATUS");
  });

  test("reason catalog has retryability and user action for every reason code", () => {
    for (const [reason, entry] of Object.entries(GOVERNANCE_REASON_CATALOG)) {
      expect(typeof entry.retryable, reason).toBe("boolean");
      expect(entry.action.length, reason).toBeGreaterThan(0);
    }
    expect(GOVERNANCE_REASON_CATALOG.TRUST_LEVEL_MISMATCH.retryable).toBe(false);
    expect(GOVERNANCE_REASON_CATALOG.CHALLENGE_EXPIRED.retryable).toBe(true);
    expect(GOVERNANCE_REASON_CATALOG.ATTESTATION_SCHEMA_UNSUPPORTED.action).toBe("rerun-with-attestation-v2");
    expect(GOVERNANCE_REASON_CATALOG.RUNNER_REVOKED.action).toBe("register-replacement-runner-key");
  });

  test("cloud egress envelope schema rejects private content keys", () => {
    const schema = readJson("schemas/cloud/cloud-egress-envelope.schema.json") as any;
    const fixture = readJson("packages/contracts/fixtures/valid/cloud-egress-envelope.json") as Record<string, Json>;
    for (const field of ["source", "sourceCode", "diff", "patch", "filename", "filePath", "symbol", "finding", "prompt", "completion", "llmProvider"]) {
      expect(validateJsonSchema(schema, { ...fixture, [field]: "private content" }).valid, field).toBe(false);
    }
  });
});
