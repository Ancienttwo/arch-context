import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { digestJson, errorEnvelope, okEnvelope, stableId, stableYaml, type Json } from "../src/schema";
import { validateJsonSchema } from "../src/validator";

const root = new URL("../../../", import.meta.url).pathname;
const schemaByFixture: Record<string, string> = {
  "architecture-node": "schemas/repo/architecture-node.schema.json",
  "architecture-relation": "schemas/repo/architecture-relation.schema.json",
  "constraint": "schemas/repo/constraint.schema.json",
  "architecture-intervention": "schemas/repo/architecture-intervention.schema.json",
  "compatibility-contract": "schemas/repo/compatibility-contract.schema.json",
  "task-context": "schemas/runtime/task-context.schema.json",
  "changeset": "schemas/runtime/changeset.schema.json",
  "review-result": "schemas/runtime/review-result.schema.json",
  "attestation": "schemas/cloud/attestation.schema.json"
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
});

function fixtureNameFromSchemaVersion(schemaVersion: Json): string {
  if (typeof schemaVersion !== "string") throw new Error("Fixture schemaVersion must be a string");
  const byVersion: Record<string, string> = {
    "archcontext.node/v1": "architecture-node",
    "archcontext.relation/v1": "architecture-relation",
    "archcontext.constraint/v1": "constraint",
    "archcontext.intervention/v1": "architecture-intervention",
    "archcontext.compatibility/v1": "compatibility-contract",
    "archcontext.task-context/v1": "task-context",
    "archcontext.changeset/v1": "changeset",
    "archcontext.review/v1": "review-result",
    "archcontext.attestation/v1": "attestation"
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
});
