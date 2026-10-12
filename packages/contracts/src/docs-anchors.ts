/**
 * `archctx docs anchors` (#298): a read-only signal for stale citations in human-owned text. It
 * reads the human-owned regions of module documents and node prose (`summary`,
 * `responsibilities`), and resolves each citation against the Git-visible tree and CodeGraph. It is
 * a signal, not a gate: findings never change `ok`, freshness or the projection result.
 */
export const DOCS_ANCHORS_REPORT_SCHEMA_VERSION = "archcontext.docs-anchors/v1" as const;

export const DOCS_ANCHOR_FINDING_KINDS = ["line-moved", "line-out-of-range", "missing-path", "missing-symbol"] as const;
export type DocsAnchorFindingKind = (typeof DOCS_ANCHOR_FINDING_KINDS)[number];

/** Why a citation was found but one of its checks could not run. */
export const DOCS_ANCHOR_UNCHECKED_REASON_CODES = ["codegraph-unavailable", "language-unsupported", "path-ambiguous"] as const;
export type DocsAnchorUncheckedReasonCode = (typeof DOCS_ANCHOR_UNCHECKED_REASON_CODES)[number];

export const DOCS_ANCHOR_CODEGRAPH_UNAVAILABLE_REASON_CODES = ["index-missing", "index-open-failed"] as const;
export type DocsAnchorCodeGraphUnavailableReasonCode = (typeof DOCS_ANCHOR_CODEGRAPH_UNAVAILABLE_REASON_CODES)[number];

/** Where the citation is written: a human-owned document line, or a field of the node. */
export type DocsAnchorOriginV1 =
  | { kind: "document"; path: string; line: number }
  | { kind: "node-summary" }
  | { kind: "node-responsibility"; index: number };

export interface DocsAnchorCitationV1 {
  /** The inline code span as written, without the backticks. */
  text: string;
  /** The cited path as written. */
  path?: string;
  /** The Git-visible file or directory the path resolved to, when it differs from `path`. */
  resolvedPath?: string;
  line?: number;
  endLine?: number;
  symbol?: string;
}

export interface DocsAnchorFindingV1 {
  kind: DocsAnchorFindingKind;
  origin: DocsAnchorOriginV1;
  citation: DocsAnchorCitationV1;
  /** `line-out-of-range` only: the current line count of the cited file. */
  lineCount?: number;
  /** `line-moved` only: the current start lines of the cited symbol, sorted. */
  currentLines?: number[];
}

export interface DocsAnchorUncheckedV1 {
  reasonCode: DocsAnchorUncheckedReasonCode;
  origin: DocsAnchorOriginV1;
  citation: DocsAnchorCitationV1;
}

export interface DocsAnchorsNodeV1 {
  nodeId: string;
  /** The node's module document, when the active layout has one and it exists. */
  documentPath?: string;
  citationCount: number;
  findings: DocsAnchorFindingV1[];
  unchecked: DocsAnchorUncheckedV1[];
}

export type DocsAnchorsCodeGraphV1 =
  | { availability: "ready" }
  | { availability: "unavailable"; reasonCode: DocsAnchorCodeGraphUnavailableReasonCode };

export interface DocsAnchorsReportV1 {
  schemaVersion: typeof DOCS_ANCHORS_REPORT_SCHEMA_VERSION;
  profile: "default" | "repo-harness/v1";
  codeGraph: DocsAnchorsCodeGraphV1;
  summary: {
    /** Model nodes whose prose and module document were read. */
    nodes: number;
    /** Module documents read. */
    documents: number;
    citations: number;
    findings: number;
    unchecked: number;
    byKind: Record<DocsAnchorFindingKind, number>;
  };
  /** Nodes with at least one citation, sorted by `nodeId`. */
  nodes: DocsAnchorsNodeV1[];
}

export function docsAnchorsReportIssues(report: DocsAnchorsReportV1): string[] {
  const issues: string[] = [];
  const ids = report.nodes.map((node) => node.nodeId);
  const sorted = [...new Set(ids)].sort();
  if (sorted.length !== ids.length || sorted.some((id, index) => id !== ids[index])) issues.push("nodes.nodeId must be sorted and unique");
  const findings = report.nodes.flatMap((node) => node.findings);
  const unchecked = report.nodes.flatMap((node) => node.unchecked);
  if (report.summary.citations !== report.nodes.reduce((total, node) => total + node.citationCount, 0)) issues.push("summary.citations must equal the sum of nodes[].citationCount");
  if (report.summary.findings !== findings.length) issues.push("summary.findings must equal the number of findings");
  if (report.summary.unchecked !== unchecked.length) issues.push("summary.unchecked must equal the number of unchecked citations");
  for (const kind of DOCS_ANCHOR_FINDING_KINDS) {
    if (report.summary.byKind[kind] !== findings.filter((finding) => finding.kind === kind).length) issues.push(`summary.byKind.${kind} must equal the number of ${kind} findings`);
  }
  for (const [index, node] of report.nodes.entries()) {
    if (node.citationCount === 0) issues.push(`nodes[${index}] must have at least one citation`);
    for (const [findingIndex, finding] of node.findings.entries()) {
      issues.push(...docsAnchorFindingIssues(finding, `nodes[${index}].findings[${findingIndex}]`));
    }
  }
  if (report.codeGraph.availability === "ready" && unchecked.some((entry) => entry.reasonCode === "codegraph-unavailable")) {
    issues.push("codegraph-unavailable is reported only when codeGraph.availability is unavailable");
  }
  return issues;
}

function docsAnchorFindingIssues(finding: DocsAnchorFindingV1, prefix: string): string[] {
  const issues: string[] = [];
  const { citation } = finding;
  if (finding.kind === "missing-path" && citation.path === undefined) issues.push(`${prefix} missing-path must name citation.path`);
  if (finding.kind === "missing-symbol" && citation.symbol === undefined) issues.push(`${prefix} missing-symbol must name citation.symbol`);
  if (finding.kind === "line-out-of-range" && (citation.line === undefined || finding.lineCount === undefined)) {
    issues.push(`${prefix} line-out-of-range must name citation.line and lineCount`);
  }
  if ((finding.lineCount !== undefined) !== (finding.kind === "line-out-of-range")) issues.push(`${prefix}.lineCount is present only on line-out-of-range`);
  if (finding.kind === "line-moved") {
    const lines = finding.currentLines ?? [];
    if (citation.line === undefined || citation.symbol === undefined) issues.push(`${prefix} line-moved must name citation.line and citation.symbol`);
    if (lines.length === 0 || lines.some((line, index) => index > 0 && line <= lines[index - 1]!)) issues.push(`${prefix}.currentLines must be non-empty, sorted and unique`);
  } else if (finding.currentLines !== undefined) {
    issues.push(`${prefix}.currentLines is present only on line-moved`);
  }
  return issues;
}
