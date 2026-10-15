import { ERROR_CATALOG, canonicalize, type ArchContextErrorCode, type Json, type Severity } from "./schema";

/** Only selected entrypoints support transport failures; the legacy AC-only envelope is unchanged. */
export type FailureCode = ArchContextErrorCode | "RPC_TIMEOUT" | "RPC_ABORTED";
export const FAILURE_STAGES = Object.freeze(["debt", "complete", "practice-checkpoint", "cli", "mcp", "hook-checkpoint", "failure-metadata"] as const);
export type FailureStage = typeof FAILURE_STAGES[number];
export interface StrictFailure<C extends FailureCode = FailureCode> {
  code: C;
  message: string;
  severity: Severity;
  retryable: boolean;
  action: string;
  reasonCode: string;
  details: { [key: string]: Json };
}
export interface FailureEnvelope<C extends FailureCode = FailureCode> {
  schemaVersion: "archcontext.envelope/v1";
  ok: false;
  requestId: string;
  data?: never;
  error: StrictFailure<C>;
}
type Policy = { code: FailureCode; message: string; fields?: readonly string[]; action?: string };
/** Each reason has a closed fact vocabulary. No source text or recovery binding is a summary fact. */
const policies: Record<string, Policy> = {
  "git-worktree-required": { code: "AC_REPO_NOT_FOUND", message: "This operation requires a Git worktree.", fields: ["checks"] },
  "model-missing": { code: "AC_MODEL_ADOPTION_REQUIRED", message: "Architecture debt requires an adopted model.", fields: ["checks"] },
  "changed-path-invalid": { code: "AC_SCHEMA_INVALID", message: "Changed paths must be an array of repository-relative POSIX paths.", fields: ["checks"] },
  "debt-report-invalid": { code: "AC_SCHEMA_INVALID", message: "Architecture debt evidence violates its contract.", fields: ["checks"] },
  "projection-manifest-upgrade-required": { code: "AC_PRECONDITION_FAILED", message: "The committed projection manifest requires supported re-baselining." },
  "projection-manifest-invalid": { code: "AC_PRECONDITION_FAILED", message: "The committed projection manifest violates its contract." },
  "projection-footprint-uncovered": { code: "AC_PRECONDITION_FAILED", message: "Declared source footprints lack a projection target." },
  "index-missing": { code: "AC_CODE_FACTS_UNAVAILABLE", message: "Required code facts have no available index. Run codegraph init." },
  "checkpoint-input-invalid": { code: "AC_SCHEMA_INVALID", message: "Checkpoint arguments violate the declared input schema.", fields: ["issueCount"], action: "correct-command-arguments" },
  "cli-input-invalid": { code: "AC_SCHEMA_INVALID", message: "Command arguments violate the declared input contract.", action: "correct-command-arguments" },
  "complete-input-invalid": { code: "AC_SCHEMA_INVALID", message: "Completion input violates the caller authority contract.", action: "correct-command-arguments" },
  "hook-event-invalid": { code: "AC_SCHEMA_INVALID", message: "Hook event violates the declared input contract.", action: "correct-command-arguments" },
  "egress-policy-denied": { code: "AC_POLICY_VIOLATION", message: "Local policy refused this operation." },
  "runtime-version-unsupported": { code: "AC_RUNTIME_VERSION_UNSUPPORTED", message: "The connected runtime version is unsupported." },
  "rpc-timeout": { code: "RPC_TIMEOUT", message: "The runtime RPC deadline elapsed without a response; a mutation outcome is unknown.", fields: ["method", "timeoutMs", "elapsedMs", "mutationOutcome"], action: "reconcile-before-retry" },
  "rpc-aborted": { code: "RPC_ABORTED", message: "The runtime RPC caller aborted without a response; a mutation outcome is unknown.", fields: ["method", "timeoutMs", "elapsedMs", "mutationOutcome"], action: "reconcile-before-retry" },
  "failure-unclassified": { code: "AC_UNCLASSIFIED_FAILURE", message: "The operation failed without a classified cause. Inspect local diagnostics before retrying.", action: "inspect-diagnostics" },
};
for (const policy of Object.values(policies)) {
  if (policy.fields) Object.freeze(policy.fields);
  Object.freeze(policy);
}
export const FAILURE_POLICIES: Readonly<Record<string, Readonly<Policy>>> = Object.freeze(policies);
const catalogDefaults = Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, value]) => [code, Object.freeze({ severity: value.severity, retryable: value.retryable, action: value.action })])) as Readonly<Record<ArchContextErrorCode, Readonly<Pick<StrictFailure, "severity" | "retryable" | "action">>>>;
const actions = new Set([...Object.values(catalogDefaults).map(value => value.action), "correct-command-arguments", "inspect-diagnostics", "reconcile-before-retry"]);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const criticalKey = (key: string) => /id$|digest|receipt|binding|readback|lookupkey/i.test(key);
/** Read a single own data value without executing accessors or accepting prototype metadata. */
function ownData(input: unknown, key: string): unknown {
  if (!record(input)) throw new Error("Failure metadata must be an object");
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) {
    if (key in input) throw new Error("Failure metadata must use own data properties");
    return undefined;
  }
  if (!("value" in descriptor)) throw new Error("Failure metadata cannot use accessors");
  return descriptor.value;
}

function fact(key: string, value: unknown): Json | undefined {
  if (key === "stage") return typeof value === "string" && (FAILURE_STAGES as readonly string[]).includes(value) ? value : undefined;
  if (key === "checks") {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 32) return undefined;
    const checks: string[] = [];
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry || !("value" in entry) || (entry.value !== "ownership" && entry.value !== "anchors")) return undefined;
      checks.push(entry.value);
    }
    return checks;
  }
  if (key === "issueCount") return finiteNonnegative(value) && Number.isSafeInteger(value) ? value : undefined;
  if (key === "method") return typeof value === "string" && ["health", "practiceCheckpoint", "completeTask"].includes(value) ? value : undefined;
  if (key === "timeoutMs" || key === "elapsedMs") return finiteNonnegative(value) ? value : undefined;
  if (key === "mutationOutcome") return value === "unknown" ? value : undefined;
  return undefined;
}
function detailsFor(policy: Policy, input: unknown): { [key: string]: Json } {
  const result: { [key: string]: Json } = {};
  if (!record(input)) throw new Error("Failure details must be an object");
  let omitted = 0;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (criticalKey(key)) throw new Error("Failure metadata contains an unsupported critical binding");
    if (key === "omittedCount" && policy.code !== "AC_UNCLASSIFIED_FAILURE" && finiteNonnegative(descriptor.value) && Number.isSafeInteger(descriptor.value)) {
      omitted += descriptor.value;
      continue;
    }
    if (key === "stage" || policy.fields?.includes(key)) {
      const value = "value" in descriptor ? fact(key, descriptor.value) : undefined;
      if (value !== undefined) { result[key] = value; continue; }
    }
    // Unknown compound facts may hide an essential recovery binding. Refuse without traversing caller data.
    if ("value" in descriptor && descriptor.value !== null && typeof descriptor.value === "object") throw new Error("Failure metadata contains an unsupported compound fact");
    omitted++;
  }
  if (omitted > 0 && policy.code !== "AC_UNCLASSIFIED_FAILURE") result.omittedCount = Math.min(omitted, 1_000_000);
  return result;
}
function budgetIssues(value: unknown, depth = 0): string[] {
  if (depth > 4) return ["details depth exceeds four"];
  if (typeof value === "string") return bytes(value) <= 256 ? [] : ["detail string exceeds UTF-8 budget"];
  if (typeof value === "number") return Number.isFinite(value) ? [] : ["detail number is not finite"];
  if (Array.isArray(value)) return value.length <= 32 ? value.flatMap(item => budgetIssues(item, depth + 1)) : ["detail list exceeds 32"];
  if (record(value)) return Object.keys(value).length <= 16 ? Object.values(value).flatMap(item => budgetIssues(item, depth + 1)) : ["detail object exceeds 16 fields"];
  return value === null || typeof value === "boolean" ? [] : ["detail value is not JSON"];
}
type Attributes = Partial<Pick<StrictFailure, "action" | "severity" | "retryable">>;
export function knownFailure<C extends FailureCode>(code: C, reasonCode: string, details: unknown = {}, attributes: Attributes = {}): StrictFailure<C> {
  // TypeScript types do not protect this runtime boundary. Do not coerce policy keys.
  if (typeof code !== "string" || typeof reasonCode !== "string") throw new Error("Failure code/reason must be primitive strings");
  const suppliedAction = ownData(attributes, "action");
  const suppliedSeverity = ownData(attributes, "severity");
  const suppliedRetryable = ownData(attributes, "retryable");
  if ((suppliedAction !== undefined && typeof suppliedAction !== "string")
    || (suppliedSeverity !== undefined && typeof suppliedSeverity !== "string")
    || (suppliedRetryable !== undefined && typeof suppliedRetryable !== "boolean")) throw new Error("Invalid failure attribute types");
  const policy = Object.hasOwn(FAILURE_POLICIES, reasonCode) ? FAILURE_POLICIES[reasonCode] : undefined;
  if (!policy || policy.code !== code) throw new Error("Failure code/reason pair is not registered");
  const catalog = code === "RPC_TIMEOUT" || code === "RPC_ABORTED"
    ? { severity: "error" as const, retryable: false, action: "reconcile-before-retry" }
    : catalogDefaults[code as ArchContextErrorCode];
  const action = (suppliedAction as string | undefined) ?? policy.action ?? catalog.action;
  const severity = (suppliedSeverity as Severity | undefined) ?? catalog.severity;
  const retryable = (suppliedRetryable as boolean | undefined) ?? catalog.retryable;
  if (!actions.has(action) || !["notice", "warning", "error", "critical"].includes(severity) || typeof retryable !== "boolean") throw new Error("Invalid failure attributes");
  if ((code === "RPC_TIMEOUT" || code === "RPC_ABORTED") && retryable) throw new Error("Transport failures cannot request automatic retry");
  if (code === "AC_UNCLASSIFIED_FAILURE" && (action !== "inspect-diagnostics" || severity !== "error" || retryable)) throw new Error("Unclassified failure attributes are fixed");
  const safeDetails = detailsFor(policy, details);
  if (budgetIssues(safeDetails).length || bytes(JSON.stringify(safeDetails)) > 8192 || bytes(policy.message) > 1024) throw new Error("Failure metadata exceeds its UTF-8 budget");
  return { code, message: policy.message, severity, retryable, action, reasonCode, details: safeDetails };
}
/** Snapshot caller-owned fields once, before validation or use. Missing legacy details stay optional. */
function failureFromData<C extends FailureCode = FailureCode>(input: unknown): StrictFailure<C> {
  const code = ownData(input, "code");
  const reasonCode = ownData(input, "reasonCode");
  const details = ownData(input, "details");
  const action = ownData(input, "action");
  const severity = ownData(input, "severity");
  const retryable = ownData(input, "retryable");
  return knownFailure(code as C, reasonCode as string, details, {
    action: action as string | undefined, severity: severity as Severity | undefined, retryable: retryable as boolean | undefined
  });
}
export function unclassifiedFailure(stage?: FailureStage): StrictFailure<"AC_UNCLASSIFIED_FAILURE"> {
  return knownFailure("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", stage ? { stage } : {});
}
export function failureEnvelope<C extends FailureCode>(requestId: string, failure: StrictFailure<C>): FailureEnvelope<C> {
  // Revalidate/copy even typed metadata so caller mutation cannot bypass the closed contract.
  return { schemaVersion: "archcontext.envelope/v1", ok: false, requestId, error: failureFromData<C>(failure) };
}
/** Public value readers retain their success signature and throw this typed failure. */
export class FailureError<C extends FailureCode = ArchContextErrorCode> extends Error {
  readonly failure: StrictFailure<C>;
  constructor(code: C, reasonCode: string, details: unknown = {}, attributes: Attributes = {}) {
    const failure = knownFailure(code, reasonCode, details, attributes);
    super(failure.message);
    this.name = "FailureError";
    this.failure = failure;
  }
  get code(): C { return this.failure.code; }
  get reasonCode(): string { return this.failure.reasonCode; }
  get action(): string { return this.failure.action; }
  get severity(): Severity { return this.failure.severity; }
  get retryable(): boolean { return this.failure.retryable; }
  get details(): { [key: string]: Json } { return this.failure.details; }
}
export function toEnvelope(requestId: string, error: unknown, stage: FailureStage): FailureEnvelope {
  try {
    return failureEnvelope(requestId, error instanceof FailureError ? ownData(error, "failure") as StrictFailure : unclassifiedFailure(stage));
  } catch {
    return failureEnvelope(requestId, unclassifiedFailure("failure-metadata"));
  }
}
/** Successful results are returned by identity. Only selected surface callers use this adapter. */
export function normalizeFailureResult<T>(result: T, stage: FailureStage, requestId = "failure"): T | FailureEnvelope {
  if (!record(result)) return result;
  try {
    if (ownData(result, "ok") !== false) return result;
    return failureEnvelope(requestId, failureFromData(ownData(result, "error")));
  } catch {
    return toEnvelope(requestId, undefined, "failure-metadata");
  }
}
/** Bounded JSON copy for strict validation; never stringify caller-owned objects or run their hooks. */
function jsonDataSnapshot(value: unknown, depth = 0): Json {
  if (depth > 4) throw new Error("Failure details exceed depth budget");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string" && bytes(value) <= 256) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length > 32 || Reflect.ownKeys(value).length !== length + 1) throw new Error("Failure details violate array contract");
    return Array.from({ length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new Error("Failure details cannot use accessors or sparse lists");
      return jsonDataSnapshot(descriptor.value, depth + 1);
    });
  }
  if (record(value)) {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length > 16 || Object.keys(value).length !== keys.length || keys.some(key => typeof key !== "string")) throw new Error("Failure details violate object contract");
    return Object.fromEntries((keys as string[]).map(key => [key, jsonDataSnapshot(ownData(value, key), depth + 1)]));
  }
  throw new Error("Failure details are not bounded JSON data");
}
export function failureIssues(value: unknown): string[] {
  try {
    if (!record(value)) return ["failure must be an object"];
    const fields = ["code", "message", "severity", "retryable", "action", "reasonCode", "details"];
    const keys = Reflect.ownKeys(value);
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== fields.length || Object.keys(value).length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) return ["failure must match its closed registered contract"];
    const data = Object.fromEntries(fields.map(key => [key, ownData(value, key)]));
    data.details = jsonDataSnapshot(data.details);
    if (typeof data.message !== "string" || bytes(data.message) > 1024 || bytes(JSON.stringify(data.details)) > 8192) return ["failure exceeds byte/shape budget"];
    const expected = failureFromData(data);
    return canonicalize(data as Json) === canonicalize(expected as unknown as Json) ? [] : ["failure must match its closed registered contract"];
  } catch { return ["failure violates its registered contract or budget"]; }
}
