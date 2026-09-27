import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { validateJsonSchema, type Json } from "@archcontext/contracts";
import type { ChangeOperation } from "./index";

export interface AdrReferenceReplacement { from: string; to: string }
export const ADR_REFERENCE_OPERATION_SCHEMA: Parameters<typeof validateJsonSchema>[0] = {
  type: "object", additionalProperties: false, required: ["op", "path", "expectedHash", "references"],
  properties: {
    op: { const: "update_adr_references" },
    path: { type: "string", pattern: "^docs/adr/ADR-[0-9]{4}-[a-z0-9][a-z0-9-]*\\.md$" },
    expectedHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    references: { type: "array", minItems: 1, items: {
      type: "object", additionalProperties: false, required: ["from", "to"], properties: {
        from: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{2,127}$" },
        to: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{2,127}$" }
      }
    } }
  }
};

export function assertAdrReferenceOperation(operation: ChangeOperation): asserts operation is ChangeOperation & { path: string; references: AdrReferenceReplacement[] } {
  if (!validateJsonSchema(ADR_REFERENCE_OPERATION_SCHEMA, operation as unknown as Json).valid) {
    throw new Error("ADR reference update requires an existing ADR path, expectedHash and only typed reference replacements");
  }
  const seen = new Set<string>();
  for (const { from, to } of operation.references!) {
    if (from === to || seen.has(from)) throw new Error("ADR reference replacements must have unique sources and change each source");
    seen.add(from);
  }
}

/** Replace only explicit appliesTo scalar spans; all other frontmatter and prose bytes survive. */
export function renderAdrReferenceUpdate(body: string, references: AdrReferenceReplacement[]): string {
  const opening = /^---\r?\n/.exec(body);
  if (!opening) throw new Error("ADR requires YAML frontmatter");
  const closing = /^---\r?$/m.exec(body.slice(opening[0].length));
  if (!closing) throw new Error("ADR frontmatter closing delimiter is missing");
  const offset = opening[0].length;
  const document = parseDocument(body.slice(offset, offset + closing.index), { uniqueKeys: true });
  if (document.errors.length || document.warnings.length || !isMap(document.contents) || document.get("schemaVersion") !== "archcontext.adr/v1") {
    throw new Error("ADR frontmatter must be valid, unambiguous archcontext.adr/v1 YAML");
  }
  visit(document, (_key, node) => {
    if (isAlias(node) || ((isScalar(node) || isMap(node) || isSeq(node)) && node.anchor)) {
      throw new Error("ADR reference update does not allow aliases or anchors in frontmatter");
    }
  });
  const appliesTo = document.get("appliesTo", true);
  if (!isSeq(appliesTo)) throw new Error("ADR appliesTo must be an explicit sequence");
  const replacements = new Map(references.map(entry => [entry.from, entry.to]));
  const found = new Set<string>(), resultIds = new Set<string>();
  const patches: { start: number; end: number; text: string }[] = [];
  for (const item of appliesTo.items) {
    if (!isScalar(item) || typeof item.value !== "string" || !item.range || !["PLAIN", "QUOTE_SINGLE", "QUOTE_DOUBLE"].includes(item.type ?? "")) {
      throw new Error("ADR appliesTo requires explicit single-line string scalars");
    }
    const replacement = replacements.get(item.value);
    const resultId = replacement ?? item.value;
    if (resultIds.has(resultId)) throw new Error("ADR appliesTo would contain duplicate references");
    resultIds.add(resultId);
    if (replacement !== undefined) {
      found.add(item.value);
      const text = item.type === "QUOTE_SINGLE" ? `'${replacement}'` : item.type === "QUOTE_DOUBLE" ? JSON.stringify(replacement) : replacement;
      patches.push({ start: offset + item.range[0], end: offset + item.range[1], text });
    }
  }
  if (found.size !== replacements.size) throw new Error("ADR replacement source is absent from appliesTo");
  let rendered = body;
  for (const patch of patches.sort((a, b) => b.start - a.start)) rendered = rendered.slice(0, patch.start) + patch.text + rendered.slice(patch.end);
  return rendered;
}
