import { FailureError, knownFailure, toEnvelope, unclassifiedFailure } from "./failure";
import { canonicalize, errorEnvelope, type ArchContextErrorCode, type Json, type JsonEnvelope } from "./schema";
import { runtimeTopologyModelIssues } from "./runtime-topology";
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
  role: "manifest" | "node" | "relation" | "flow" | "contract" | "document" | "decision";
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
export interface NativeContextDecision {
  id: string; title: string; status: string | null; decidedAt: string | null;
  appliesTo: string[]; supersedes: string[]; path: string;
}
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
  decisions: NativeContextDecision[];
}

const PATH_REASONS = new Set<NativeContextReasonCode>(["native-context-path-unsafe", "native-context-entry-kind-unsupported", "native-context-ref-unsafe"]);
const PRECONDITION_REASONS = new Set<NativeContextReasonCode>(["native-context-ref-unavailable", "native-context-blob-unavailable", "native-context-input-missing", "native-context-input-unreadable", "native-context-input-changed", "native-context-limit-exceeded", "native-context-git-read-failed"]);

/** Compatible native class, backed by the single strict failure authority. */
export class NativeContextError extends FailureError {
  constructor(reasonCode: NativeContextReasonCode, details: Record<string, Json> = {}) {
    let failure;
    try {
      const code: ArchContextErrorCode = reasonCode === "git-worktree-required" ? "AC_REPO_NOT_FOUND"
        : reasonCode === "native-context-model-missing" ? "AC_MODEL_ADOPTION_REQUIRED"
        : PATH_REASONS.has(reasonCode) ? "AC_PATH_DENIED"
        : PRECONDITION_REASONS.has(reasonCode) ? "AC_PRECONDITION_FAILED" : "AC_SCHEMA_INVALID";
      failure = knownFailure(code, reasonCode, details);
    } catch { failure = unclassifiedFailure("failure-metadata"); }
    super(failure.code, failure.reasonCode, failure.details, failure);
    this.name = "NativeContextError";
  }
}

export function nativeContextErrorEnvelope(error: NativeContextError): JsonEnvelope {
  return toEnvelope("export.native", error, "native-export") as JsonEnvelope;
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
export interface NativeModelIssue { entityId: string; field: string; invariant: string; path?: string }

/** Fixed canonical documents are supplied by the bundled reader, never by repository input. */
export function nativeContextSchemaResolver(schemas: NativeContextSchemas): JsonSchemaResolver {
  return jsonSchemaResolver([schemas.node, schemas.relation, schemas.flow]);
}

export function nativeAllowedNodeKinds(schemas: NativeContextSchemas): string[] {
  const kinds = schemas.node.properties?.kind?.enum;
  if (!kinds || kinds.some(kind => typeof kind !== "string")) throw new Error("canonical-node-kind-enum-unavailable");
  return [...kinds] as string[];
}

/** Complete native shape/reference validation; optional paths bind parsed records, never IDs. */
export function nativeContextModelIssues(model: NativeContextModel, schemas: NativeContextSchemas, recordPaths?: ReadonlyMap<NativeModelRecord, string>): NativeModelIssue[] {
  const issues: NativeModelIssue[] = [];
  const add = (record: NativeModelRecord | string, field: string, invariant: string) => {
    const entityId = typeof record === "string" ? record : typeof record.id === "string" ? record.id : "(undeclared)";
    const path = typeof record === "string" ? undefined : recordPaths?.get(record);
    issues.push({ entityId, field, invariant, ...(path === undefined ? {} : { path }) });
  };
  const resolveSchema = nativeContextSchemaResolver(schemas);
  const ids = new Set<string>();
  for (const [kind, records] of [["node", model.nodes], ["relation", model.relations], ["flow", model.flows]] as const) {
    for (const record of records) {
      const id = typeof record.id === "string" ? record.id : "(undeclared)";
      // JSON Schema validates own data properties. Reject values the shared subset parser
      // cannot represent losslessly as JSON, rather than serializing inherited fields away
      // or coercing non-finite numbers to null. The shared parser itself is unchanged.
      const pending: Array<{ value: unknown; field: string; exit?: boolean }> = [{ value: record, field: "$" }];
      const active = new Set<object>();
      const done = new Set<object>();
      let jsonInvalid = false;
      while (pending.length > 0) {
        const item = pending.pop()!;
        const value = item.value;
        if (item.exit) { active.delete(value as object); done.add(value as object); continue; }
        if (typeof value === "number" && !Number.isFinite(value)) { add(record, item.field, "non-json-number"); jsonInvalid = true; break; }
        if (value === null || typeof value !== "object") continue;
        if (active.has(value)) { add(record, item.field, "non-json-cycle"); jsonInvalid = true; break; }
        if (done.has(value)) continue;
        const prototype = Object.getPrototypeOf(value);
        if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype) { add(record, item.field, "non-json-prototype"); jsonInvalid = true; break; }
        active.add(value); pending.push({ value, field: item.field, exit: true });
        for (const [key, child] of Object.entries(value)) pending.push({ value: child, field: `${item.field}.${key}` });
      }
      if (jsonInvalid) continue;
      const schema = kind === "node" ? schemas.node : kind === "relation" ? schemas.relation : schemas.flow;
      for (const issue of validateJsonSchema(schema, record, { resolveSchema }).issues) add(record, issue.path, issue.message);
      if (ids.has(id)) add(record, "id", "duplicate-entity-id");
      ids.add(id);
    }
  }
  // Invalid shapes cannot safely participate in reference validation.
  if (issues.length > 0) return issues;
  for (const kind of ["nodes", "relations", "flows"] as const) {
    const expected = new Map(model[kind].map(entity => [entity.id as string, entity]));
    for (const [id, entity] of expected) if (!Object.hasOwn(model.sourcePaths[kind], id)) add(entity, `sourcePaths.${kind}`, "source-path-index-incomplete");
    for (const [id, path] of Object.entries(model.sourcePaths[kind])) {
      if (!expected.has(id)) add(id, `sourcePaths.${kind}`, "source-path-index-unknown-entity");
      if (!isNativeContextPath(path)) add(expected.get(id) ?? id, `sourcePaths.${kind}`, "path-unsafe");
    }
  }
  const nodes = new Map(model.nodes.map(node => [node.id as string, node]));
  const checked = new Set<string>();
  for (const node of model.nodes) {
    const chain = new Set<string>();
    let cursor: NativeModelRecord | undefined = node;
    while (cursor) {
      const current = cursor.id as string;
      if (chain.has(current)) { add(node, "parent", "parent-cycle"); break; }
      if (checked.has(current)) break;
      chain.add(current);
      if (cursor.parent === undefined) break;
      const parent = nodes.get(cursor.parent as string);
      if (!parent) { add(cursor, "parent", "parent-node-missing"); break; }
      cursor = parent;
    }
    for (const current of chain) checked.add(current);
  }
  const selectors = new Set<string>();
  for (const node of model.nodes) {
    const source = node.source as { include?: string[]; exclude?: string[]; entrypoints?: Array<{ id: string; path: string; symbols: Array<{ name: string; sinks: Array<{ id: string; path: string; symbol: string }> }> }> } | undefined;
    for (const path of [...source?.include ?? [], ...source?.exclude ?? []]) if (!isNativeContextPath(path)) add(node, "source", "path-unsafe");
    for (const entry of source?.entrypoints ?? []) {
      if (!isNativeContextPath(entry.path)) add(node, "source.entrypoints.path", "path-unsafe");
      for (const symbol of entry.symbols) {
        for (const sink of symbol.sinks) {
          if (!isNativeContextPath(sink.path)) add(node, "source.entrypoints.symbols.sinks.path", "path-unsafe");
          const selector = JSON.stringify([entry.id, symbol.name, sink.id]);
          if (selectors.has(selector)) add(node, "source.entrypoints.symbols.sinks.id", "selector-ambiguous");
          selectors.add(selector);
        }
      }
    }
  }
  for (const relation of model.relations) {
    for (const field of ["source", "target", "via"] as const) if (relation[field] !== undefined && !nodes.has(relation[field] as string)) add(relation, field, "relation-node-missing");
  }
  const relations = new Map(model.relations.map(relation => [relation.id as string, relation]));
  for (const issue of runtimeTopologyModelIssues(model)) {
    add(relations.get(issue.entityId) ?? nodes.get(issue.entityId) ?? issue.entityId, issue.field, issue.invariant);
  }
  for (const flow of model.flows) {
    if (nodes.get(flow.capabilityId as string)?.kind !== "capability") add(flow, "capabilityId", "flow-capability-missing");
    if (flow.applicability !== "required") continue;
    const participants = flow.participants as Array<{ id: string; nodeId: string }>;
    const participantIds = new Set<string>();
    for (const participant of participants) {
      if (participantIds.has(participant.id)) add(flow, "participants.id", "participant-id-ambiguous");
      participantIds.add(participant.id);
      if (!nodes.has(participant.nodeId)) add(flow, "participants.nodeId", "participant-node-missing");
    }
    const definitions = new Map<string, string>();
    const outcomes = flow.outcomes as Array<{ id: string; steps: NativeModelRecord[]; terminal: { participant: string } }>;
    const outcomeIds = new Set<string>();
    for (const outcome of outcomes) {
      if (outcomeIds.has(outcome.id)) add(flow, "outcomes.id", "outcome-id-ambiguous");
      outcomeIds.add(outcome.id);
      if (!participantIds.has(outcome.terminal.participant)) add(flow, "outcomes.terminal", "terminal-participant-missing");
    }
    for (const step of [...flow.steps as NativeModelRecord[], ...outcomes.flatMap(outcome => outcome.steps)]) {
      if (!participantIds.has(step.from as string) || !participantIds.has(step.to as string)) add(flow, "steps", "step-participant-missing");
      const definition = canonicalize(step);
      if (definitions.has(step.id as string) && definitions.get(step.id as string) !== definition) add(flow, "steps.id", "step-definition-ambiguous");
      definitions.set(step.id as string, definition);
      const selector = step.evidence as { entrypointId: string; sourceSymbol: string; sinkId: string };
      if (!selectors.has(JSON.stringify([selector.entrypointId, selector.sourceSymbol, selector.sinkId]))) add(flow, "steps.evidence", "selector-missing");
    }
  }
  return issues;
}
