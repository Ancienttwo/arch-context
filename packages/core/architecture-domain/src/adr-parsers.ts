import { parseDocument } from "yaml";
import type { Json } from "@archcontext/contracts";
import { isJsonRecord, parseJsonOrStableYaml, stripYamlComment, yamlBareId } from "./yaml-codec";

export const ADR_FILE_PATH = /^docs\/adr\/ADR-\d{4}-.+\.md$/;
export const MODEL_NODE_PATH_PREFIX = ".archcontext/model/nodes/";

export interface AdrAppliesToValidation {
  /** Every problem found: malformed `appliesTo` values and unknown node ids. */
  errors: string[];
  /** The subset of `errors` that are well-formed ids resolving to no node. */
  referenceErrors: string[];
}

/**
 * ADR frontmatter `appliesTo` holds architecture node ids. Checks every `docs/adr/ADR-NNNN-*.md`
 * in `files` against the ids of `.archcontext/model/nodes/*`; files are repo-relative model files
 * as loaded by a ModelStore. Only the top-level `appliesTo` key is read, so other frontmatter
 * never fails this check. No ADR files, or ADRs without `appliesTo`, produce no errors.
 */
export function validateAdrAppliesTo(files: readonly { path: string; body: string }[]): AdrAppliesToValidation {
  const nodeIds = modelNodeIds(readModelNodeRecords(files));
  const errors: string[] = [];
  const referenceErrors: string[] = [];
  for (const file of files) {
    if (!ADR_FILE_PATH.test(file.path)) continue;
    const appliesTo = readAdrAppliesTo(file.body);
    if (appliesTo.kind === "absent") continue;
    if (appliesTo.kind === "malformed") {
      errors.push(`${file.path}: ADR ${appliesTo.reason.startsWith("frontmatter") ? "" : "appliesTo "}${appliesTo.reason}`);
      continue;
    }
    for (const id of appliesTo.ids) {
      if (nodeIds.has(id)) continue;
      const error = `${file.path}: ADR appliesTo references unknown node ${id}`;
      errors.push(error);
      referenceErrors.push(error);
    }
  }
  return { errors, referenceErrors };
}

/** Shared frontmatter boundary and appliesTo reader for validation and native export. */
export function readAdrAppliesTo(body: string): AdrAppliesToExtraction {
  const frontmatter = adrFrontmatter(body);
  if (frontmatter === null) return /^---[ \t]*\r?\n/.test(body.replace(/^\uFEFF/, ""))
    ? { kind: "malformed", reason: "frontmatter has no closing --- delimiter" } : { kind: "absent" };
  return extractAdrAppliesTo(frontmatter);
}
function adrFrontmatter(body: string): string | null {
  const match = body.replace(/^\uFEFF/, "").match(/^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/);
  return match ? match[1] ?? "" : null;
}
export interface ArchitectureDecisionMetadata {
  id: string; title: string; status: string | null; decidedAt: string | null;
  appliesTo: string[]; supersedes: string[]; path: string;
}
/** Pure ADR parser. Projection and native readers supply bytes from their own source boundary. */
export function parseArchitectureDecisionRecord(path: string, body: string): ArchitectureDecisionMetadata {
  const frontmatter = adrFrontmatter(body);
  if (frontmatter === null) throw new Error(`${path}: ADR frontmatter is required`);
  const document = parseDocument(frontmatter);
  if (document.errors.length) throw new Error(`${path}: ADR frontmatter is invalid`);
  const metadata: unknown = document.toJS();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error(`${path}: ADR frontmatter must be an object`);
  const fields = metadata as Record<string, unknown>;
  const singleLine = (key: string, required = false): string | null => {
    const value = fields[key];
    if (value === undefined && !required) return null;
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error(`${path}: ADR frontmatter ${key} must be a non-empty single-line string`);
    return value.trim();
  };
  const appliesTo = readAdrAppliesTo(body);
  if (appliesTo.kind === "malformed") throw new Error(`${path}: ADR appliesTo ${appliesTo.reason}`);
  const supersedes = fields.supersedes ?? [];
  if (!Array.isArray(supersedes) || supersedes.some(id => typeof id !== "string" || !id.trim() || /[\r\n]/.test(id))) throw new Error(`${path}: ADR supersedes must be a list of ids`);
  return { id: singleLine("id") ?? path.slice("docs/adr/".length, -3), title: singleLine("title", true)!, status: singleLine("status"), decidedAt: singleLine("decidedAt"), appliesTo: appliesTo.kind === "ids" ? appliesTo.ids : [], supersedes: supersedes as string[], path };
}

export function manifestDecisionDiagnostics(files: readonly { path: string; body: string }[]): string[] {
  const file = files.find(file => file.path === ".archcontext/manifest.yaml");
  if (!file) return [];
  let manifest: Json;
  try { manifest = parseJsonOrStableYaml(file.body, file.path); } catch { return []; }
  const content = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.content : undefined;
  const decisions = content && typeof content === "object" && !Array.isArray(content) ? content.decisions : undefined;
  if (decisions === undefined || decisions === "docs/adr") return [];
  return ["manifest-decisions-unsupported: .archcontext/manifest.yaml content.decisions supports only docs/adr; run archctx manifest plan --id <changeset.id> --decisions docs/adr"];
}

/** Malformed node files are reported by schema validation. */
export function readModelNodeRecords(files: readonly { path: string; body: string }[]): { path: string; node: Record<string, Json> }[] {
  return files.flatMap(({ path, body }) => {
    if (!path.startsWith(MODEL_NODE_PATH_PREFIX)) return [];
    try {
      const node = parseJsonOrStableYaml(body, path);
      return isJsonRecord(node) ? [{ path, node }] : [];
    } catch {
      return [];
    }
  });
}

export function modelNodeIds(records: ReturnType<typeof readModelNodeRecords>): Set<string> {
  return new Set(records.flatMap(({ node }) => typeof node.id === "string" ? [node.id] : []));
}

export type AdrAppliesToExtraction =
  | { kind: "absent" }
  | { kind: "ids"; ids: string[] }
  | { kind: "malformed"; reason: string };

/**
 * Reads the top-level `appliesTo` of ADR frontmatter without parsing the rest of it, which is
 * hand-written YAML. Accepts an inline list (`appliesTo: [a, 'b']`) or a block list at any indent,
 * with `#` comments and single or double quotes around ids.
 */
function extractAdrAppliesTo(frontmatter: string): AdrAppliesToExtraction {
  const lines = frontmatter.split(/\r?\n/);
  const keyIndexes = lines.flatMap((line, index) => /^(["']?)appliesTo\1[ \t]*:(?:[ \t]|$)/.test(line) ? [index] : []);
  if (keyIndexes.length === 0) return { kind: "absent" };
  if (keyIndexes.length > 1) return { kind: "malformed", reason: "is declared more than once" };
  const keyIndex = keyIndexes[0]!;
  const inline = stripYamlComment(lines[keyIndex]!.slice(lines[keyIndex]!.indexOf(":") + 1)).trim();
  if (inline) {
    if (!inline.startsWith("[") || !inline.endsWith("]")) return { kind: "malformed", reason: "must be a list of node ids" };
    const body = inline.slice(1, -1).trim();
    if (!body) return { kind: "ids", ids: [] };
    const ids: string[] = [];
    for (const item of body.split(",")) {
      const id = yamlBareId(item);
      if (id === undefined) return { kind: "malformed", reason: `entry ${JSON.stringify(item.trim())} is not a node id` };
      ids.push(id);
    }
    return { kind: "ids", ids };
  }
  const ids: string[] = [];
  let itemIndent: number | undefined;
  for (const line of lines.slice(keyIndex + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(/^( *)-(?:[ \t]+(.*))?$/);
    const indent = line.match(/^ */)![0].length;
    if (!item) {
      if (indent === 0) break;
      return { kind: "malformed", reason: "must be a list of node ids" };
    }
    if (itemIndent === undefined) itemIndent = indent;
    if (indent !== itemIndent) return { kind: "malformed", reason: "list items must share one indent" };
    const id = yamlBareId(item[2] ?? "");
    if (id === undefined) return { kind: "malformed", reason: `entry ${JSON.stringify((item[2] ?? "").trim())} is not a node id` };
    ids.push(id);
  }
  return { kind: "ids", ids };
}
