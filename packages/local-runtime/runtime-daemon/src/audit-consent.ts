import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { digestJson, errorEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { INVESTIGATION_ENV_ALLOWED_PREFIXES, INVESTIGATION_ENV_ALLOWLIST } from "./investigation-transport";

/**
 * Issue #161: three separate authorization boundaries guard the local audit flow.
 *
 * 1. The repository manifest (`audit.githubIssues.enabled`) only declares that the capability is
 *    supported. It is repository-controlled, so a cloned third-party repository can set it.
 * 2. This module: a user-level consent record, stored in the user state directory (never inside
 *    the repository), bound to the repository identity and to the audit egress policy below.
 *    `audit run` / `audit approve` fail closed until it exists.
 * 3. Publishing a specific issue keeps its own PAT + confirmation gates (ADR-0042).
 */

export const AUDIT_CONSENT_SCHEMA_VERSION = "archcontext.audit-consent/v1";
export const AUDIT_CONSENT_REQUIRED_REASON_CODE = "audit-user-consent-required";
export const AUDIT_CONSENT_GRANT_COMMAND = "archctx audit consent";
const AUDIT_CONSENT_FILE = "audit-consent.json";

/**
 * What the user consents to. Folded into the consent record as a digest, so widening the egress
 * (another destination, more forwarded env) invalidates earlier consent instead of silently
 * inheriting it.
 */
export const AUDIT_EGRESS_POLICY = {
  schemaVersion: "archcontext.audit-egress-policy/v1",
  destination: "model-provider",
  runner: "claude --print",
  data: "repository content the runner reads, plus the ArchContext ledger context bundle",
  runnerEnvAllowlist: [...INVESTIGATION_ENV_ALLOWLIST],
  runnerEnvAllowedPrefixes: [...INVESTIGATION_ENV_ALLOWED_PREFIXES]
} as const;

export const AUDIT_EGRESS_POLICY_DIGEST = digestJson(AUDIT_EGRESS_POLICY as unknown as Json);

export interface AuditConsentRecordV1 {
  schemaVersion: typeof AUDIT_CONSENT_SCHEMA_VERSION;
  storageRepositoryId: string;
  repositoryAnchor: string;
  originUrl: string | null;
  egressPolicyDigest: string;
  grantedAt: string;
}

export type AuditConsentMissingReason = "not-granted" | "unreadable" | "repository-mismatch" | "origin-mismatch" | "egress-policy-changed";

export type AuditConsentStatus =
  | { granted: true; path: string; record: AuditConsentRecordV1 }
  | { granted: false; path: string; reason: AuditConsentMissingReason };

type Env = Record<string, string | undefined>;

interface AuditConsentBinding {
  path: string;
  storageRepositoryId: string;
  repositoryAnchor: string;
  originUrl: string | null;
}

function auditConsentBinding(root: string, env: Env): AuditConsentBinding {
  const paths = runtimeStatePaths(root, env);
  return {
    path: join(paths.repositoryStateDir, AUDIT_CONSENT_FILE),
    storageRepositoryId: paths.storageRepositoryId,
    repositoryAnchor: paths.repositoryAnchor,
    originUrl: readOriginUrl(paths.repositoryRoot)
  };
}

function readOriginUrl(repositoryRoot: string): string | null {
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return url === "" ? null : url;
  } catch {
    return null;
  }
}

/**
 * Consent is keyed by the repository's storage identity (its canonical git common dir, shared by
 * all of its worktrees) and additionally bound to the `origin` URL, so replacing the checkout at
 * the same path with a different repository does not inherit the earlier consent.
 */
export function readAuditConsent(root: string, env: Env = process.env): AuditConsentStatus {
  const binding = auditConsentBinding(root, env);
  if (!existsSync(binding.path)) return { granted: false, path: binding.path, reason: "not-granted" };
  let record: Partial<AuditConsentRecordV1>;
  try {
    record = JSON.parse(readFileSync(binding.path, "utf8")) as Partial<AuditConsentRecordV1>;
  } catch {
    return { granted: false, path: binding.path, reason: "unreadable" };
  }
  if (record === null || typeof record !== "object" || record.schemaVersion !== AUDIT_CONSENT_SCHEMA_VERSION) {
    return { granted: false, path: binding.path, reason: "unreadable" };
  }
  if (record.storageRepositoryId !== binding.storageRepositoryId || record.repositoryAnchor !== binding.repositoryAnchor) {
    return { granted: false, path: binding.path, reason: "repository-mismatch" };
  }
  if ((record.originUrl ?? null) !== binding.originUrl) return { granted: false, path: binding.path, reason: "origin-mismatch" };
  if (record.egressPolicyDigest !== AUDIT_EGRESS_POLICY_DIGEST) return { granted: false, path: binding.path, reason: "egress-policy-changed" };
  return { granted: true, path: binding.path, record: record as AuditConsentRecordV1 };
}

export function grantAuditConsent(root: string, env: Env = process.env, now: string = new Date().toISOString()): { path: string; record: AuditConsentRecordV1 } {
  const binding = auditConsentBinding(root, env);
  const record: AuditConsentRecordV1 = {
    schemaVersion: AUDIT_CONSENT_SCHEMA_VERSION,
    storageRepositoryId: binding.storageRepositoryId,
    repositoryAnchor: binding.repositoryAnchor,
    originUrl: binding.originUrl,
    egressPolicyDigest: AUDIT_EGRESS_POLICY_DIGEST,
    grantedAt: now
  };
  mkdirSync(dirname(binding.path), { recursive: true, mode: 0o700 });
  writeFileSync(binding.path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { path: binding.path, record };
}

export function revokeAuditConsent(root: string, env: Env = process.env): { path: string; revoked: boolean } {
  const binding = auditConsentBinding(root, env);
  const existed = existsSync(binding.path);
  rmSync(binding.path, { force: true });
  return { path: binding.path, revoked: existed };
}

/** Typed fail-closed error shared by the CLI fast-fail check and the daemon's own gate. */
export function auditConsentRequiredEnvelope(requestId: "audit.run" | "audit.approve", reason: AuditConsentMissingReason): JsonEnvelope {
  const command = requestId === "audit.run" ? "archctx audit run" : "archctx audit approve";
  return errorEnvelope(
    requestId,
    "AC_USER_CONFIRMATION_REQUIRED",
    `${command} requires user-level consent for this repository (${reason}); the repository manifest only declares the capability. ` +
      `An audit sends repository content read by the \`claude\` runner to its configured model provider. ` +
      `To allow that for this repository, run: ${AUDIT_CONSENT_GRANT_COMMAND}`,
    AUDIT_CONSENT_REQUIRED_REASON_CODE
  );
}
