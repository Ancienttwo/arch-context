import {
  Const,
  CountSchema,
  OneOf,
  PositiveIntSchema,
  RawEnum,
  Ref,
  RepoPathSchema,
  SchemaDocument,
  StrictObject,
  Type,
  type Static
} from "./schema-kit";

/**
 * `archctx docs anchors` (#298): a read-only signal for stale citations in human-owned text. It
 * reads the human-owned regions of module documents and node prose (`summary`,
 * `responsibilities`), and resolves each citation against the Git-visible tree and CodeGraph. It is
 * a signal, not a gate: findings never change `ok`, freshness or the projection result.
 */
export const DOCS_ANCHORS_REPORT_SCHEMA_VERSION = "archcontext.docs-anchors/v1" as const;

export const DOCS_ANCHOR_FINDING_KINDS = ["line-moved", "line-out-of-range", "missing-path", "missing-symbol", "unknown-selector"] as const;
export type DocsAnchorFindingKind = (typeof DOCS_ANCHOR_FINDING_KINDS)[number];

/** Why a citation was found but one of its checks could not run. */
export const DOCS_ANCHOR_UNCHECKED_REASON_CODES = ["codegraph-unavailable", "language-unsupported", "path-ambiguous"] as const;
export type DocsAnchorUncheckedReasonCode = (typeof DOCS_ANCHOR_UNCHECKED_REASON_CODES)[number];

export const DOCS_ANCHOR_CODEGRAPH_UNAVAILABLE_REASON_CODES = ["index-missing", "index-open-failed"] as const;
export type DocsAnchorCodeGraphUnavailableReasonCode = (typeof DOCS_ANCHOR_CODEGRAPH_UNAVAILABLE_REASON_CODES)[number];

const DocsAnchorOriginBodySchema = OneOf([
  StrictObject({
    kind: Const("document"),
    path: Ref<string>("#/$defs/repoPath"),
    line: Ref<number>("#/$defs/line")
  }),
  StrictObject({ kind: Const("node-summary") }),
  StrictObject({ kind: Const("node-responsibility"), index: Type.Integer({ minimum: 0 }) })
]);
export type DocsAnchorOriginV1 = Static<typeof DocsAnchorOriginBodySchema>;

const DocsAnchorCitationBodySchema = StrictObject({
  /** The inline code span as written, without the backticks. */
  text: Type.String({ minLength: 1 }),
  /** The cited path as written. */
  path: Type.Optional(Type.String({ minLength: 1 })),
  /** The Git-visible file or directory the path resolved to, when it differs from `path`. */
  resolvedPath: Type.Optional(Ref<string>("#/$defs/repoPath")),
  line: Type.Optional(Ref<number>("#/$defs/line")),
  endLine: Type.Optional(Ref<number>("#/$defs/line")),
  symbol: Type.Optional(Type.String({ minLength: 1 }))
});
export type DocsAnchorCitationV1 = Static<typeof DocsAnchorCitationBodySchema>;

const DocsAnchorFindingBodySchema = StrictObject({
  kind: RawEnum(DOCS_ANCHOR_FINDING_KINDS),
  origin: Ref<DocsAnchorOriginV1>("#/$defs/origin"),
  citation: Ref<DocsAnchorCitationV1>("#/$defs/citation"),
  /** `line-out-of-range` only: the current line count of the cited file. */
  lineCount: Type.Optional(Ref<number>("#/$defs/count")),
  /** `line-moved` only: the current start lines of the cited symbol, sorted. */
  currentLines: Type.Optional(
    Type.Array(Ref<number>("#/$defs/line"), { minItems: 1, uniqueItems: true })
  )
});
export type DocsAnchorFindingV1 = Static<typeof DocsAnchorFindingBodySchema>;

const DocsAnchorUncheckedBodySchema = StrictObject({
  reasonCode: RawEnum(DOCS_ANCHOR_UNCHECKED_REASON_CODES),
  origin: Ref<DocsAnchorOriginV1>("#/$defs/origin"),
  citation: Ref<DocsAnchorCitationV1>("#/$defs/citation")
});
export type DocsAnchorUncheckedV1 = Static<typeof DocsAnchorUncheckedBodySchema>;

export const DocsAnchorsCodeGraphSchema = OneOf([
  StrictObject({ availability: Const("ready") }),
  StrictObject({
    availability: Const("unavailable"),
    reasonCode: RawEnum(DOCS_ANCHOR_CODEGRAPH_UNAVAILABLE_REASON_CODES)
  })
]);

export const DocsAnchorsNodeSchema = StrictObject({
  nodeId: Type.String({ minLength: 1 }),
  /** The node's module document, when the active layout has one and it exists. */
  documentPath: Type.Optional(Ref<string>("#/$defs/repoPath")),
  citationCount: Type.Integer({ minimum: 1 }),
  findings: Type.Array(Ref<DocsAnchorFindingV1>("#/$defs/finding")),
  unchecked: Type.Array(Ref<DocsAnchorUncheckedV1>("#/$defs/unchecked"))
});

export const DocsAnchorsReportBodySchema = StrictObject({
  schemaVersion: Const(DOCS_ANCHORS_REPORT_SCHEMA_VERSION),
  profile: RawEnum(["default", "repo-harness/v1"] as const),
  codeGraph: DocsAnchorsCodeGraphSchema,
  summary: StrictObject({
    /** Model nodes whose prose and module document were read. */
    nodes: Ref<number>("#/$defs/count"),
    /** Module documents read. */
    documents: Ref<number>("#/$defs/count"),
    citations: Ref<number>("#/$defs/count"),
    findings: Ref<number>("#/$defs/count"),
    unchecked: Ref<number>("#/$defs/count"),
    byKind: StrictObject({
      "line-moved": Ref<number>("#/$defs/count"),
      "line-out-of-range": Ref<number>("#/$defs/count"),
      "missing-path": Ref<number>("#/$defs/count"),
      "missing-symbol": Ref<number>("#/$defs/count"),
      "unknown-selector": Ref<number>("#/$defs/count")
    })
  }),
  /** Nodes with at least one citation, sorted by `nodeId`. */
  nodes: Type.Array(DocsAnchorsNodeSchema)
});

export const DocsAnchorsReportSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/docs-anchors.schema.json",
  title: "DocsAnchorsReportV1",
  description: "Read-only result of `archctx docs anchors`: stale citations in human-owned module document regions and node prose. A signal, not a gate.",
  schema: DocsAnchorsReportBodySchema,
  $defs: {
    count: CountSchema,
    line: PositiveIntSchema,
    repoPath: RepoPathSchema,
    origin: DocsAnchorOriginBodySchema,
    citation: DocsAnchorCitationBodySchema,
    finding: DocsAnchorFindingBodySchema,
    unchecked: DocsAnchorUncheckedBodySchema
  }
});

/** Where the citation is written: a human-owned document line, or a field of the node. */
export type DocsAnchorsNodeV1 = Static<typeof DocsAnchorsNodeSchema>;
export type DocsAnchorsCodeGraphV1 = Static<typeof DocsAnchorsCodeGraphSchema>;
export type DocsAnchorsReportV1 = Static<typeof DocsAnchorsReportSchema>;

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
  if (finding.kind === "unknown-selector" && citation.symbol === undefined) issues.push(`${prefix} unknown-selector must name citation.symbol`);
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
