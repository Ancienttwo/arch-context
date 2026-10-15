import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { architectureDocsProjectionCompatibilityIssues, architectureDocsProjectionManifestIssues, serializeArchitectureDocsProjectionManifest, validateJsonSchema, type ArchitectureDocsProjectionManifestV3 } from "../src";

const fixture = () => JSON.parse(readFileSync(new URL("../fixtures/valid/projection-manifest.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../../../schemas/runtime/projection-manifest.schema.json", import.meta.url), "utf8"));
const engine = { rendererVersion: "archcontext.docs-renderer/v6", protocolVersion: "archcontext.projection-request/v1" };

test("optional manifest floors are compatible with exact or newer engines and preserve serialization", () => {
  const value: ArchitectureDocsProjectionManifestV3 = fixture();
  const withoutFloors = serializeArchitectureDocsProjectionManifest(value);
  expect(architectureDocsProjectionCompatibilityIssues(value, engine)).toEqual([]);
  value.minimumRendererVersion = "archcontext.docs-renderer/v6";
  value.minimumProtocolVersion = "archcontext.projection-request/v1";
  expect(architectureDocsProjectionManifestIssues(value)).toEqual([]);
  expect(validateJsonSchema(schema, value as any).valid).toBe(true);
  for (const supported of [engine, { rendererVersion: "archcontext.docs-renderer/v12", protocolVersion: "archcontext.projection-request/v2" }]) {
    expect(architectureDocsProjectionCompatibilityIssues(value, supported)).toEqual([]);
  }
  const rendered = serializeArchitectureDocsProjectionManifest(value);
  expect(JSON.parse(rendered)).toEqual(value);
  expect(rendered.split("\n").filter(line => !line.includes('"minimum')).join("\n")).toBe(withoutFloors);
});

test("each minimum floor refuses an older engine and malformed version families", () => {
  for (const [key, values] of [
    ["minimumRendererVersion", ["archcontext.docs-renderer/v7", "v7", "archcontext.docs-renderer/v01", "archcontext.docs-renderer/v9007199254740992", "", null]],
    ["minimumProtocolVersion", ["archcontext.projection-request/v2", "archcontext.docs-renderer/v1", "archcontext.projection-request/v0", "", null]]
  ] as const) {
    for (const floor of values) {
      const value = { ...fixture(), [key]: floor };
      expect(architectureDocsProjectionCompatibilityIssues(value, engine).length).toBeGreaterThan(0);
    }
  }
});

test("future manifests refuse even without floors; old documented rebaseline versions remain distinguishable", () => {
  expect(architectureDocsProjectionCompatibilityIssues({ minimumRendererVersion: "archcontext.docs-renderer/v6" }, engine).length).toBeGreaterThan(0);
  for (const version of ["archcontext.architecture-docs-projection-manifest/v4", "archcontext.architecture-docs-projection-manifest/v999"]) {
    expect(architectureDocsProjectionCompatibilityIssues({ ...fixture(), schemaVersion: version }, engine).length).toBeGreaterThan(0);
  }
  for (const version of ["archcontext.architecture-docs-projection-manifest/v1", "archcontext.architecture-docs-projection-manifest/v2"]) {
    expect(architectureDocsProjectionCompatibilityIssues({ schemaVersion: version }, engine)).toEqual([]);
  }
});
