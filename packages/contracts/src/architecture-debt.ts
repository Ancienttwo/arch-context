import { digestJson, type ArchContextError, type Json } from "./schema";

/** Measured architecture work, distinct from generated-file freshness and source byte stamps. */
export const ARCHITECTURE_DEBT_SCHEMA_VERSION = "archcontext.architecture-debt/v1" as const;
export const ARCHITECTURE_DEBT_KINDS = ["unowned-path", "ambiguous-owner", "undeclared-dependency", "flow-proof-failed", "stale-anchor", "practice-regression"] as const;
export type ArchitectureDebtKind = typeof ARCHITECTURE_DEBT_KINDS[number];
export const ARCHITECTURE_DEBT_CHECKS = ["ownership", "anchors", "dependencies", "flows", "practices"] as const;
export type ArchitectureDebtCheck = typeof ARCHITECTURE_DEBT_CHECKS[number];

export interface ArchitectureDebtItemV1 {
  /** Content identity, independent of absolute root, branch, timestamps and source byte stamps. */
  id: string;
  kind: ArchitectureDebtKind;
  /** Canonical producer identities. Empty for a source path with no owner. */
  nodeIds: string[];
  capabilityIds: string[];
  paths: string[];
  reasonCode: string;
  action: string;
  /** Bounded metadata only; never source bodies or arbitrary provider output. */
  details: Record<string, string | number | string[]>;
}

export interface ArchitectureDebtCheckV1 {
  check: ArchitectureDebtCheck;
  coverage: "complete" | "partial" | "unknown";
  reasonCodes: string[];
}

export interface ArchitectureDebtReportV1 {
  schemaVersion: typeof ARCHITECTURE_DEBT_SCHEMA_VERSION;
  scope: { kind: "repository" | "changed-paths"; changedPaths: string[]; capabilityIds: string[] };
  /** A partial/unknown report with no items does not prove absence of debt. */
  coverage: "complete" | "partial" | "unknown";
  coverageReasonCodes: string[];
  checks: ArchitectureDebtCheckV1[];
  items: ArchitectureDebtItemV1[];
  actionsRequired: string[];
  /** Binds the entire debt report. Checkpoint's existing resultDigest binds practice guidance only. */
  digest: string;
}

export interface ArchitectureDebtHookLogV1 {
  schemaVersion: "archcontext.hook-log/v1";
  event: string;
  elapsedMs: number;
  pathCount: number;
  changedPathDigest: string;
  reasonCode: string;
  failOpen: boolean;
  egress: "none";
  network: "forbidden";
}

/** Hook-only observation; it never advances the practice baseline. */
export interface ArchitectureDebtHookCheckpointV1 {
  schemaVersion: "archcontext.hook-debt-checkpoint/v1";
  debt: ArchitectureDebtReportV1;
  hookLog: ArchitectureDebtHookLogV1;
}

/** Unavailable observation, never a clean debt report. Invalid arguments remain errors. */
export interface ArchitectureDebtHookFailureV1 {
  schemaVersion: "archcontext.hook-checkpoint-fail-open/v1";
  accepted: false;
  failOpen: true;
  coverage: "unknown";
  reasonCode: string;
  error: ArchContextError;
  event: string;
  pathCount: number;
  egress: "none";
  network: "forbidden";
  hookLog: ArchitectureDebtHookLogV1;
}

export function architectureDebtReportIssues(report: ArchitectureDebtReportV1): string[] {
  const issues: string[] = [];
  const sorted = (name: string, values: string[]) => {
    if (values.some((v, i) => i > 0 && v <= values[i - 1]!)) issues.push(`${name} must be sorted and unique`);
  };
  if (report.schemaVersion !== ARCHITECTURE_DEBT_SCHEMA_VERSION) issues.push("unsupported schemaVersion");
  const { digest, ...body } = report;
  if (digest !== digestJson(body as unknown as Json)) issues.push("digest must bind the debt report");
  sorted("items", report.items.map(item => item.id));
  sorted("actionsRequired", report.actionsRequired);
  sorted("coverageReasonCodes", report.coverageReasonCodes);
  sorted("scope.changedPaths", report.scope.changedPaths);
  sorted("scope.capabilityIds", report.scope.capabilityIds);
  if (report.checks.length !== ARCHITECTURE_DEBT_CHECKS.length || ARCHITECTURE_DEBT_CHECKS.some((check, i) => report.checks[i]?.check !== check)) issues.push("checks must enumerate every producer in contract order");
  const coverage = report.checks.every(check => check.coverage === "complete") ? "complete"
    : report.checks.every(check => check.coverage === "unknown") ? "unknown" : "partial";
  if (report.coverage !== coverage) issues.push("coverage must describe all checks");
  const reasons = [...new Set(report.checks.flatMap(check => check.reasonCodes.map(reason => `${check.check}:${reason}`)))].sort();
  if (JSON.stringify(reasons) !== JSON.stringify(report.coverageReasonCodes)) issues.push("coverageReasonCodes must describe check gaps");
  for (const check of report.checks) {
    sorted(`${check.check}.reasonCodes`, check.reasonCodes);
    if ((check.coverage === "complete") !== (check.reasonCodes.length === 0)) issues.push(`${check.check} must name every coverage gap`);
  }
  if (report.coverage === "unknown" && report.items.length > 0) issues.push("unknown coverage cannot contain measured items");
  const actions = [...new Set(report.items.map(item => item.action))].sort();
  if (JSON.stringify(actions) !== JSON.stringify(report.actionsRequired)) issues.push("actionsRequired must name the measured debt actions");
  for (const item of report.items) {
    if (!ARCHITECTURE_DEBT_KINDS.includes(item.kind)) issues.push("unsupported debt kind");
    if (!item.action || !item.reasonCode) issues.push("every item needs a reason and action");
    sorted(`${item.id}.nodeIds`, item.nodeIds);
    sorted(`${item.id}.capabilityIds`, item.capabilityIds);
    sorted(`${item.id}.paths`, item.paths);
    const strings = [item.action, item.reasonCode, ...item.nodeIds, ...item.capabilityIds, ...item.paths,
      ...Object.values(item.details).flatMap(value => typeof value === "string" ? [value] : Array.isArray(value) ? value : [])];
    if (strings.some(value => value.length === 0 || value.length > 1024)) issues.push(`${item.id} contains invalid metadata strings`);
    if (new TextEncoder().encode(JSON.stringify(item.details)).byteLength > 4096) issues.push(`${item.id}.details exceeds metadata budget`);
  }
  return issues;
}
