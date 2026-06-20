import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  GITHUB_APP_PERMISSION_MANIFEST,
  GOVERNANCE_CHECK_NAMES,
  GOVERNANCE_REASON_CATALOG,
  ORGANIZATION_RUNNER_CHECK_NAME,
  canTransitionChallenge,
  canTransitionCheckDelivery,
  satisfiesRequiredTrust
} from "../src/github-governance";
import {
  ARCHCONTEXT_PACKAGE_MANAGER,
  ARCHCONTEXT_PRODUCT_VERSION,
  ARCHCONTEXT_SCHEMA_SET_VERSION,
  LOCAL_RUNTIME_RPC_SCHEMA_VERSION,
  productVersionManifest
} from "../src/product-version";
import { digestJson, errorEnvelope, okEnvelope, stableId, stableYaml, type Json } from "../src/schema";
import { validateJsonSchema } from "../src/validator";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const schemaByFixture: Record<string, string> = {
  "architecture-node": "schemas/repo/architecture-node.schema.json",
  "architecture-relation": "schemas/repo/architecture-relation.schema.json",
  "cross-repo-relation": "schemas/repo/cross-repo-relation.schema.json",
  "landscape": "schemas/repo/landscape.schema.json",
  "constraint": "schemas/repo/constraint.schema.json",
  "architecture-intervention": "schemas/repo/architecture-intervention.schema.json",
  "compatibility-contract": "schemas/repo/compatibility-contract.schema.json",
  "task-context": "schemas/runtime/task-context.schema.json",
  "changeset": "schemas/runtime/changeset.schema.json",
  "review-result": "schemas/runtime/review-result.schema.json",
  "explorer-projection": "schemas/runtime/explorer-projection.schema.json",
  "explorer-service": "schemas/runtime/explorer-service.schema.json",
  "product-version-manifest": "schemas/runtime/product-version-manifest.schema.json",
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
    const schema = readJson("schemas/runtime/explorer-projection.schema.json") as any;
    const rootProperties = Object.keys(schema.properties);
    for (const forbidden of ["operation", "operations", "changeset", "mutationEndpoint", "saasEndpoint", "remoteUrl"]) {
      expect(rootProperties).not.toContain(forbidden);
    }
    expect(schema.properties.capabilities.properties.readOnly.const).toBe(true);
    expect(schema.properties.capabilities.properties.mutationMode.enum).toEqual(["forbidden"]);
    expect(schema.properties.capabilities.properties.egress.enum).toEqual(["none"]);
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
    "archcontext.task-context/v1": "task-context",
    "archcontext.changeset/v1": "changeset",
    "archcontext.review/v1": "review-result",
    "archcontext.explorer-projection/v1": "explorer-projection",
    "archcontext.explorer-service/v1": "explorer-service",
    "archcontext.product-version-manifest/v1": "product-version-manifest",
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

  test("challenge and check delivery state machines reject illegal backward moves", () => {
    expect(canTransitionChallenge("PENDING", "LEASED")).toBe(true);
    expect(canTransitionChallenge("LEASED", "PENDING")).toBe(false);
    expect(canTransitionChallenge("VERIFIED", "REJECTED")).toBe(false);

    expect(canTransitionCheckDelivery("PENDING", "RETRYING")).toBe(true);
    expect(canTransitionCheckDelivery("RETRYING", "PUBLISHED")).toBe(true);
    expect(canTransitionCheckDelivery("PUBLISHED", "RETRYING")).toBe(false);
  });

  test("reason catalog has retryability and user action for every reason code", () => {
    for (const [reason, entry] of Object.entries(GOVERNANCE_REASON_CATALOG)) {
      expect(typeof entry.retryable, reason).toBe("boolean");
      expect(entry.action.length, reason).toBeGreaterThan(0);
    }
    expect(GOVERNANCE_REASON_CATALOG.TRUST_LEVEL_MISMATCH.retryable).toBe(false);
    expect(GOVERNANCE_REASON_CATALOG.CHALLENGE_EXPIRED.retryable).toBe(true);
  });

  test("cloud egress envelope schema rejects private content keys", () => {
    const schema = readJson("schemas/cloud/cloud-egress-envelope.schema.json") as any;
    const fixture = readJson("packages/contracts/fixtures/valid/cloud-egress-envelope.json") as Record<string, Json>;
    for (const field of ["source", "sourceCode", "diff", "patch", "filename", "filePath", "symbol", "finding", "prompt", "completion", "llmProvider"]) {
      expect(validateJsonSchema(schema, { ...fixture, [field]: "private content" }).valid, field).toBe(false);
    }
  });
});
