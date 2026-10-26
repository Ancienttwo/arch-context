import { expect, test } from "bun:test";
import { digestJson } from "@archcontext/contracts";
import { changeSetBaseModelBlockingErrors, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { validateLedgerModelFiles } from "../src/index";

test("ledger validation retains exact structured layer repair metadata without hiding unrelated errors", () => {
  const file = (path: string, value: any) => ({ path, body: JSON.stringify(value), schemaVersion: value.schemaVersion, digest: digestJson(value) });
  const read = validateLedgerModelFiles([
    file(".archcontext/manifest.yaml", { schemaVersion: "archcontext.manifest/v1", model: { layers: ["cli"] } }),
    file(".archcontext/model/nodes/module.core.yaml", { schemaVersion: "archcontext.node/v2", id: "module.core", layer: "core" })
  ]);
  expect(read.layerOrderErrors).toEqual([".archcontext/manifest.yaml: architecture-node-layer-undeclared: module.core (core)"]);
  expect(read.errors).toContain(read.layerOrderErrors[0]);
  const draft = { operations: [{ op: "update_manifest_fields", path: ".archcontext/manifest.yaml", expectedHash: digestJson({}), fields: { "model.layers": ["cli", "core"] } }] } as unknown as ChangeSetDraft;
  expect(changeSetBaseModelBlockingErrors({ ...read, valid: false, modelDigest: digestJson({}) }, draft)).toEqual(["missing .archcontext/product.yaml"]);
  expect(changeSetBaseModelBlockingErrors({ ...read, valid: false, modelDigest: digestJson({}) }, { operations: [] } as unknown as ChangeSetDraft)).toEqual(read.errors);
});
