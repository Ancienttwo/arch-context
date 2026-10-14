import { canonicalize, errorEnvelope, type ArchContextErrorCode, type Json, type JsonEnvelope } from "./schema";
import { jsonSchemaResolver, validateJsonSchema, type JsonSchemaResolver } from "./validator";

export const NATIVE_CONTEXT_SCHEMA_VERSION = "archcontext.native-context-export/v1" as const;
export const NATIVE_CONTEXT_PROFILE = "repo-harness/v1" as const;
export const NATIVE_CONTEXT_LIMITS = Object.freeze({
  inputFiles: 10_000,
  fileBytes: 8 * 1024 * 1024,
  inputBytes: 32 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024,
  treeListingBytes: 32 * 1024 * 1024,
  gitTimeoutMs: 10_000,
  batchOverheadBytes: 2 * 1024 * 1024
});

export const NATIVE_CONTEXT_REASONS = [
  "git-worktree-required", "native-context-arguments-invalid", "native-context-profile-invalid",
  "native-context-model-missing", "native-context-model-invalid", "native-context-budget-invalid",
  "native-context-profile-incomplete", "native-context-text-invalid", "native-context-input-ambiguous",
  "native-context-path-unsafe", "native-context-entry-kind-unsupported", "native-context-ref-unsafe",
  "native-context-ref-unavailable", "native-context-blob-unavailable", "native-context-input-missing",
  "native-context-input-unreadable", "native-context-input-changed", "native-document-marker-invalid",
  "native-document-section-ambiguous", "native-context-limit-exceeded", "native-context-git-read-failed"
] as const;
export type NativeContextReasonCode = (typeof NATIVE_CONTEXT_REASONS)[number];
export type NativeModelRecord = Record<string, Json>;
export interface NativeContextModel {
  nodes: NativeModelRecord[];
  relations: NativeModelRecord[];
  flows: NativeModelRecord[];
  sourcePaths: { nodes: Record<string, string>; relations: Record<string, string>; flows: Record<string, string> };
}
export interface NativeContextInput {
  path: string;
  role: "manifest" | "node" | "relation" | "flow" | "contract" | "document";
  requirement: "required" | "declared" | "optional";
  presence: "present" | "missing";
  mode: "100644" | "100755" | null;
  byteLength: number | null;
  contentDigest: string | null;
}
export interface NativeTextRange {
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
}
export interface NativeHumanRegion extends NativeTextRange { text: string }
export interface NativeDocumentSection {
  state: "missing" | "absent" | "empty" | "present";
  heading: { text: string; range: NativeTextRange } | null;
  bodyRanges: NativeTextRange[];
  body: string | null;
}
export interface NativeContextDocument {
  path: string;
  targetId: string;
  capabilityNodeIds: string[];
  presence: "present" | "missing";
  markerState: "present" | "absent" | "missing";
  humanRegions: NativeHumanRegion[];
  section3: NativeDocumentSection;
  backlog: NativeDocumentSection;
}
export interface NativeCapabilityProfile {
  nodeId: string;
  status: string;
  domain: string;
  name: string;
  modulePath: string;
  contractFiles: { agents: string; claude: string };
  includeAnchors: string[];
  lspProfile: string | null;
  verification: string[] | null;
  directChildNodeIds: string[];
  componentNodeIds: string[];
}
export interface NativeContextContract {
  path: string;
  roles: ("agents" | "claude")[];
  capabilityNodeIds: string[];
  presence: "present" | "missing";
  text: string | null;
  byteLength: number | null;
  byteDigest: string | null;
}
export type NativeContextSnapshot =
  | { source: "ref"; commitSha: string; treeOid: string; validation: "immutable-tree" }
  | { source: "worktree"; headSha: string; headTreeOid: string; validation: "stable-read" };
export interface NativeContextExportV1 {
  schemaVersion: typeof NATIVE_CONTEXT_SCHEMA_VERSION;
  profile: typeof NATIVE_CONTEXT_PROFILE;
  snapshot: NativeContextSnapshot;
  inputDigest: string;
  inputs: NativeContextInput[];
  allowedNodeKinds: string[];
  contextBudgetBytes: number;
  model: NativeContextModel;
  capabilityProfiles: NativeCapabilityProfile[];
  contracts: NativeContextContract[];
  documents: NativeContextDocument[];
}

const PATH_REASONS = new Set<NativeContextReasonCode>(["native-context-path-unsafe", "native-context-entry-kind-unsupported", "native-context-ref-unsafe"]);
const PRECONDITION_REASONS = new Set<NativeContextReasonCode>(["native-context-ref-unavailable", "native-context-blob-unavailable", "native-context-input-missing", "native-context-input-unreadable", "native-context-input-changed", "native-context-limit-exceeded", "native-context-git-read-failed"]);

export class NativeContextError extends Error {
  readonly code: ArchContextErrorCode;
  constructor(readonly reasonCode: NativeContextReasonCode, readonly details: Record<string, Json> = {}) {
    super(reasonCode);
    this.name = "NativeContextError";
    this.code = reasonCode === "git-worktree-required" ? "AC_REPO_NOT_FOUND"
      : reasonCode === "native-context-model-missing" ? "AC_MODEL_ADOPTION_REQUIRED"
      : PATH_REASONS.has(reasonCode) ? "AC_PATH_DENIED"
      : PRECONDITION_REASONS.has(reasonCode) ? "AC_PRECONDITION_FAILED" : "AC_SCHEMA_INVALID";
  }
}

export function nativeContextErrorEnvelope(error: NativeContextError): JsonEnvelope {
  const envelope = errorEnvelope("export.native", error.code, error.reasonCode, error.reasonCode, error.details);
  envelope.error!.retryable = error.reasonCode === "native-context-input-changed";
  envelope.error!.action = error.reasonCode === "native-context-input-changed" ? "rerun-native-export"
    : error.code === "AC_REPO_NOT_FOUND" ? "open-correct-repository"
    : error.code === "AC_PATH_DENIED" ? "repair-native-input-path"
    : error.reasonCode === "native-context-limit-exceeded" ? "reduce-native-input-size" : "repair-native-input";
  return envelope;
}

export function assertNativeContextLimit(limit: keyof typeof NATIVE_CONTEXT_LIMITS, observed: number): void {
  if (!Number.isSafeInteger(observed) || observed < 0 || observed > NATIVE_CONTEXT_LIMITS[limit]) {
    throw new NativeContextError("native-context-limit-exceeded", { limit, maximum: NATIVE_CONTEXT_LIMITS[limit], observed });
  }
}

/** A lexical contract. It does not expand globs, resolve ownership or open any path. */
export function isNativeContextPath(path: string): boolean {
  return path.length > 0 && !/^[A-Za-z]:/.test(path) && !path.startsWith("/")
    && Buffer.from(path, "utf8").toString("utf8") === path
    && !/[\\\u0000-\u001f\u007f-\u009f]/.test(path)
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

export function assertNativeContextPath(path: string): void {
  if (!isNativeContextPath(path)) throw new NativeContextError("native-context-path-unsafe", { path });
}

export function nativeByteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

type SchemaDocument = Parameters<typeof validateJsonSchema>[0];
export interface NativeContextSchemas { node: SchemaDocument; relation: SchemaDocument; flow: SchemaDocument }
export interface NativeModelIssue { entityId: string; field: string; invariant: string }

/** Fixed canonical documents are supplied by the bundled reader, never by repository input. */
export function nativeContextSchemaResolver(schemas: NativeContextSchemas): JsonSchemaResolver {
  return jsonSchemaResolver([schemas.node, schemas.relation, schemas.flow]);
}

export function nativeAllowedNodeKinds(schemas: NativeContextSchemas): string[] {
  const kinds = schemas.node.properties?.kind?.enum;
  if (!kinds || kinds.some(kind => typeof kind !== "string")) throw new Error("canonical-node-kind-enum-unavailable");
  return [...kinds] as string[];
}

/** Complete native shape/reference validation; no filesystem, symbols, runtime or mutation. */
export function nativeContextModelIssues(model: NativeContextModel, schemas: NativeContextSchemas): NativeModelIssue[] {
  const issues: NativeModelIssue[] = [];
  const add = (entityId: string, field: string, invariant: string) => issues.push({ entityId, field, invariant });
  const resolveSchema = nativeContextSchemaResolver(schemas);
  const ids = new Set<string>();
  for (const [kind, records] of [["node", model.nodes], ["relation", model.relations], ["flow", model.flows]] as const) {
    for (const record of records) {
      const id = typeof record.id === "string" ? record.id : "(undeclared)";
      const schema = kind === "node" ? schemas.node : kind === "relation" ? schemas.relation : schemas.flow;
      for (const issue of validateJsonSchema(schema, record, { resolveSchema }).issues) add(id, issue.path, issue.message);
      if (ids.has(id)) add(id, "id", "duplicate-entity-id");
      ids.add(id);
    }
  }
  // Invalid shapes cannot safely participate in reference validation.
  if (issues.length > 0) return issues;
  for (const kind of ["nodes", "relations", "flows"] as const) {
    const expected = new Set(model[kind].map(entity => entity.id as string));
    for (const id of expected) if (!Object.hasOwn(model.sourcePaths[kind], id)) add(id, `sourcePaths.${kind}`, "source-path-index-incomplete");
    for (const [id, path] of Object.entries(model.sourcePaths[kind])) {
      if (!expected.has(id)) add(id, `sourcePaths.${kind}`, "source-path-index-unknown-entity");
      if (!isNativeContextPath(path)) add(id, `sourcePaths.${kind}`, "path-unsafe");
    }
  }
  const nodes = new Map(model.nodes.map(node => [node.id as string, node]));
  const checked = new Set<string>();
  for (const node of model.nodes) {
    const id = node.id as string;
    const chain = new Set<string>();
    let cursor: NativeModelRecord | undefined = node;
    while (cursor) {
      const current = cursor.id as string;
      if (chain.has(current)) { add(id, "parent", "parent-cycle"); break; }
      if (checked.has(current)) break;
      chain.add(current);
      if (cursor.parent === undefined) break;
      const parent = nodes.get(cursor.parent as string);
      if (!parent) { add(current, "parent", "parent-node-missing"); break; }
      cursor = parent;
    }
    for (const current of chain) checked.add(current);
  }
  const selectors = new Set<string>();
  for (const node of model.nodes) {
    const source = node.source as { include?: string[]; exclude?: string[]; entrypoints?: Array<{ id: string; path: string; symbols: Array<{ name: string; sinks: Array<{ id: string; path: string; symbol: string }> }> }> } | undefined;
    for (const path of [...source?.include ?? [], ...source?.exclude ?? []]) if (!isNativeContextPath(path)) add(node.id as string, "source", "path-unsafe");
    for (const entry of source?.entrypoints ?? []) {
      if (!isNativeContextPath(entry.path)) add(node.id as string, "source.entrypoints.path", "path-unsafe");
      for (const symbol of entry.symbols) {
        for (const sink of symbol.sinks) {
          if (!isNativeContextPath(sink.path)) add(node.id as string, "source.entrypoints.symbols.sinks.path", "path-unsafe");
          const selector = JSON.stringify([entry.id, symbol.name, sink.id]);
          if (selectors.has(selector)) add(node.id as string, "source.entrypoints.symbols.sinks.id", "selector-ambiguous");
          selectors.add(selector);
        }
      }
    }
  }
  for (const relation of model.relations) {
    for (const field of ["source", "target", "via"] as const) if (relation[field] !== undefined && !nodes.has(relation[field] as string)) add(relation.id as string, field, "relation-node-missing");
  }
  for (const flow of model.flows) {
    const id = flow.id as string;
    if (nodes.get(flow.capabilityId as string)?.kind !== "capability") add(id, "capabilityId", "flow-capability-missing");
    if (flow.applicability !== "required") continue;
    const participants = flow.participants as Array<{ id: string; nodeId: string }>;
    const participantIds = new Set<string>();
    for (const participant of participants) {
      if (participantIds.has(participant.id)) add(id, "participants.id", "participant-id-ambiguous");
      participantIds.add(participant.id);
      if (!nodes.has(participant.nodeId)) add(id, "participants.nodeId", "participant-node-missing");
    }
    const definitions = new Map<string, string>();
    const outcomes = flow.outcomes as Array<{ id: string; steps: NativeModelRecord[]; terminal: { participant: string } }>;
    const outcomeIds = new Set<string>();
    for (const outcome of outcomes) {
      if (outcomeIds.has(outcome.id)) add(id, "outcomes.id", "outcome-id-ambiguous");
      outcomeIds.add(outcome.id);
      if (!participantIds.has(outcome.terminal.participant)) add(id, "outcomes.terminal", "terminal-participant-missing");
    }
    for (const step of [...flow.steps as NativeModelRecord[], ...outcomes.flatMap(outcome => outcome.steps)]) {
      if (!participantIds.has(step.from as string) || !participantIds.has(step.to as string)) add(id, "steps", "step-participant-missing");
      const definition = canonicalize(step);
      if (definitions.has(step.id as string) && definitions.get(step.id as string) !== definition) add(id, "steps.id", "step-definition-ambiguous");
      definitions.set(step.id as string, definition);
      const selector = step.evidence as { entrypointId: string; sourceSymbol: string; sinkId: string };
      if (!selectors.has(JSON.stringify([selector.entrypointId, selector.sourceSymbol, selector.sinkId]))) add(id, "steps.evidence", "selector-missing");
    }
  }
  return issues;
}
