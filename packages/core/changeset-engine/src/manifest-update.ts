import { isMap, isScalar, parseDocument } from "yaml";
import { digestJson, validateJsonSchema, type Json } from "@archcontext/contracts";
import type { ChangeOperation } from "./index";

export const MANIFEST_UPDATE_PATH = ".archcontext/manifest.yaml";
export interface ManifestUpdateFields { "content.decisions": "docs/adr" }

/** Runtime source; the JSON ChangeSet schema is a checked projection of this branch. */
export const MANIFEST_UPDATE_OPERATION_SCHEMA: Parameters<typeof validateJsonSchema>[0] = {
  type: "object", additionalProperties: false, required: ["op", "path", "expectedHash", "fields"],
  properties: {
    op: { const: "update_manifest_fields" },
    path: { const: MANIFEST_UPDATE_PATH },
    expectedHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    fields: { type: "object", additionalProperties: false, required: ["content.decisions"], properties: {
      "content.decisions": { const: "docs/adr" }
    } }
  }
};

/** Configuration support follows actual readers; arbitrary ADR locations are not supported. */
export function assertManifestUpdateOperation(operation: ChangeOperation): asserts operation is ChangeOperation & { fields: ManifestUpdateFields } {
  const result = validateJsonSchema(MANIFEST_UPDATE_OPERATION_SCHEMA, operation as unknown as Json);
  if (!result.valid) throw new Error("Manifest update requires only the fixed manifest path, existing-file expectedHash and content.decisions = docs/adr fields");
}

/** Edit the authoritative document, preserving comments and all unrelated values. */
export function renderManifestFieldsUpdate(body: string, fields: ManifestUpdateFields): string {
  const document = parseDocument(body, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new Error("Manifest YAML must be valid and unambiguous");
  if (!isMap(document.contents) || document.get("schemaVersion") !== "archcontext.manifest/v1" ||
      !isMap(document.get("content", true))) throw new Error("Manifest requires schemaVersion archcontext.manifest/v1 and a content mapping");
  const decisions = document.getIn(["content", "decisions"], true);
  if (!isScalar(decisions) || typeof decisions.value !== "string") throw new Error("Manifest content.decisions must be an explicit string");
  if (decisions.value === fields["content.decisions"]) throw new Error("Manifest content.decisions is already docs/adr");
  // Detach aliases before setting the expected value: mutating a shared JS object here
  // would otherwise also authorize changes to unrelated alias consumers.
  const before = JSON.parse(JSON.stringify(document.toJS())) as Record<string, Json>;
  document.setIn(["content", "decisions"], fields["content.decisions"]);
  const after = document.toJS() as Record<string, Json>;
  (before.content as Record<string, Json>).decisions = fields["content.decisions"];
  if (digestJson(before) !== digestJson(after)) throw new Error("Manifest update would change unrelated settings");
  return document.toString();
}
