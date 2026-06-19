import { createHash } from "node:crypto";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type Severity = "notice" | "warning" | "error" | "critical";

export type ArchContextErrorCode =
  | "AC_REPO_NOT_FOUND"
  | "AC_RUNTIME_UNAVAILABLE"
  | "AC_CODEGRAPH_UNAVAILABLE"
  | "AC_INDEX_STALE"
  | "AC_CONTEXT_STALE"
  | "AC_SCHEMA_INVALID"
  | "AC_POLICY_VIOLATION"
  | "AC_PATH_DENIED"
  | "AC_PRECONDITION_FAILED"
  | "AC_INTERVENTION_REQUIRED"
  | "AC_PROOF_REQUIRED"
  | "AC_COMPAT_CONTRACT_REQUIRED"
  | "AC_USER_CONFIRMATION_REQUIRED"
  | "AC_ENTITLEMENT_REQUIRED"
  | "AC_ATTESTATION_REJECTED"
  | "AC_TUNNEL_SCOPE_DENIED";

export interface ArchContextError {
  code: ArchContextErrorCode;
  message: string;
  severity: Severity;
  retryable: boolean;
  action: string;
}

export interface JsonEnvelope<T extends Json = Json> {
  schemaVersion: "archcontext.envelope/v1";
  ok: boolean;
  requestId: string;
  data?: T;
  error?: ArchContextError;
}

export const ERROR_CATALOG: Record<ArchContextErrorCode, Omit<ArchContextError, "message">> = {
  AC_REPO_NOT_FOUND: { code: "AC_REPO_NOT_FOUND", severity: "error", retryable: false, action: "open-correct-repository" },
  AC_RUNTIME_UNAVAILABLE: { code: "AC_RUNTIME_UNAVAILABLE", severity: "error", retryable: true, action: "start-or-reconnect-runtime" },
  AC_CODEGRAPH_UNAVAILABLE: { code: "AC_CODEGRAPH_UNAVAILABLE", severity: "error", retryable: true, action: "run-diagnostics" },
  AC_INDEX_STALE: { code: "AC_INDEX_STALE", severity: "warning", retryable: true, action: "sync-codefacts" },
  AC_CONTEXT_STALE: { code: "AC_CONTEXT_STALE", severity: "warning", retryable: true, action: "prepare-task-again" },
  AC_SCHEMA_INVALID: { code: "AC_SCHEMA_INVALID", severity: "error", retryable: false, action: "repair-model" },
  AC_POLICY_VIOLATION: { code: "AC_POLICY_VIOLATION", severity: "error", retryable: false, action: "revise-plan" },
  AC_PATH_DENIED: { code: "AC_PATH_DENIED", severity: "critical", retryable: false, action: "do-not-bypass" },
  AC_PRECONDITION_FAILED: { code: "AC_PRECONDITION_FAILED", severity: "warning", retryable: true, action: "rebuild-plan" },
  AC_INTERVENTION_REQUIRED: { code: "AC_INTERVENTION_REQUIRED", severity: "error", retryable: false, action: "enter-intervention-sop" },
  AC_PROOF_REQUIRED: { code: "AC_PROOF_REQUIRED", severity: "warning", retryable: false, action: "execute-proof-point" },
  AC_COMPAT_CONTRACT_REQUIRED: { code: "AC_COMPAT_CONTRACT_REQUIRED", severity: "error", retryable: false, action: "delete-or-contract" },
  AC_USER_CONFIRMATION_REQUIRED: { code: "AC_USER_CONFIRMATION_REQUIRED", severity: "warning", retryable: true, action: "show-human-decision" },
  AC_ENTITLEMENT_REQUIRED: { code: "AC_ENTITLEMENT_REQUIRED", severity: "error", retryable: false, action: "login-or-subscribe" },
  AC_ATTESTATION_REJECTED: { code: "AC_ATTESTATION_REJECTED", severity: "error", retryable: false, action: "review-again" },
  AC_TUNNEL_SCOPE_DENIED: { code: "AC_TUNNEL_SCOPE_DENIED", severity: "error", retryable: false, action: "reduce-scope" }
};

export function okEnvelope<T extends Json>(requestId: string, data: T): JsonEnvelope<T> {
  return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId, data };
}

export function errorEnvelope(requestId: string, code: ArchContextErrorCode, message: string): JsonEnvelope {
  return {
    schemaVersion: "archcontext.envelope/v1",
    ok: false,
    requestId,
    error: { ...ERROR_CATALOG[code], message }
  };
}

export function canonicalize(value: Json): string {
  return JSON.stringify(sortJson(value));
}

export function digestJson(value: Json): string {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

export function stableId(...parts: string[]): string {
  return parts
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean)
    .join(".");
}

export function isRepoRelativePosixPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}

export function stableYaml(value: Json, indent = 0): string {
  const pad = " ".repeat(indent);
  if (value === null) return "null\n";
  if (typeof value !== "object") return `${formatScalar(value)}\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]\n";
    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          return `${pad}- ${stableYaml(item, indent + 2).trimStart()}`;
        }
        return `${pad}- ${formatScalar(item)}\n`;
      })
      .join("");
  }
  const keys = Object.keys(value).sort();
  if (keys.length === 0) return "{}\n";
  return keys
    .map((key) => {
      const entry = value[key];
      if (entry !== null && typeof entry === "object") {
        return `${pad}${key}:\n${stableYaml(entry, indent + 2)}`;
      }
      return `${pad}${key}: ${formatScalar(entry)}\n`;
    })
    .join("");
}

function sortJson(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortJson);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function formatScalar(value: Json): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}
