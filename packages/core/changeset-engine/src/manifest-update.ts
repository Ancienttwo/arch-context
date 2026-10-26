import { isMap, isScalar, parseDocument } from "yaml";
import { digestJson, orderedLayerIssues, validateJsonSchema, type Json } from "@archcontext/contracts";
import type { ChangeOperation } from "./index";

export const MANIFEST_UPDATE_PATH = ".archcontext/manifest.yaml";
export interface ManifestUpdateFields { "content.decisions"?: "docs/adr"; "model.layers"?: string[] }

/** Runtime source; the JSON ChangeSet schema is a checked projection of this branch. */
export const MANIFEST_UPDATE_OPERATION_SCHEMA: Parameters<typeof validateJsonSchema>[0] = {
  type: "object", additionalProperties: false, required: ["op", "path", "expectedHash", "fields"],
  properties: {
    op: { const: "update_manifest_fields" },
    path: { const: MANIFEST_UPDATE_PATH },
    expectedHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    fields: { type: "object", additionalProperties: false, anyOf: [{ required: ["content.decisions"] }, { required: ["model.layers"] }], properties: {
      "content.decisions": { const: "docs/adr" },
      "model.layers": { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" } }
    } }
  }
};

/** Configuration support follows actual readers; arbitrary ADR locations are not supported. */
export function assertManifestUpdateOperation(operation: ChangeOperation): asserts operation is ChangeOperation & { fields: ManifestUpdateFields } {
  const result = validateJsonSchema(MANIFEST_UPDATE_OPERATION_SCHEMA, operation as unknown as Json);
  if (!result.valid) throw new Error("Manifest update requires only the fixed manifest path, existing-file expectedHash and content.decisions = docs/adr or model.layers fields");
}

/** Edit the authoritative document, preserving comments and all unrelated values. */
export function renderManifestFieldsUpdate(body: string, fields: ManifestUpdateFields): string {
  const document = parseDocument(body, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new Error("Manifest YAML must be valid and unambiguous");
  if (!isMap(document.contents) || document.get("schemaVersion") !== "archcontext.manifest/v1") throw new Error("Manifest requires schemaVersion archcontext.manifest/v1");
  if (Object.keys(fields).length === 0 || Object.keys(fields).some(key => key !== "content.decisions" && key !== "model.layers")) throw new Error("Unsupported manifest fields");
  const before = JSON.parse(JSON.stringify(document.toJS())) as Record<string, Json>;
  if (fields["content.decisions"] !== undefined) {
    if (fields["content.decisions"] !== "docs/adr" || !isMap(document.get("content", true))) throw new Error("Manifest requires content mapping and decisions docs/adr");
    const decisions = document.getIn(["content", "decisions"], true);
    if (!isScalar(decisions) || typeof decisions.value !== "string") throw new Error("Manifest content.decisions must be an explicit string");
    document.setIn(["content", "decisions"], fields["content.decisions"]);
    (before.content as Record<string, Json>).decisions = fields["content.decisions"];
  }
  if (fields["model.layers"] !== undefined) {
    if (!isMap(document.get("model", true)) || orderedLayerIssues(fields["model.layers"]).length > 0) throw new Error("Manifest model.layers requires a non-empty unique ordered layer list");
    document.setIn(["model", "layers"], [...fields["model.layers"]]);
    (before.model as Record<string, Json>).layers = [...fields["model.layers"]];
  }
  const after = document.toJS() as Record<string, Json>;
  if (digestJson(before) !== digestJson(after)) throw new Error("Manifest update would change unrelated settings");
  const original = parseDocument(body).toJS() as Record<string, Json>;
  if (digestJson(original) === digestJson(after)) throw new Error("Manifest fields already have the requested values");
  return document.toString();
}
