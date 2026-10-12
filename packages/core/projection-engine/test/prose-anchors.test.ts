import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docsAnchorsReportIssues, validateJsonSchema, type DocsAnchorsReportV1, type Json } from "@archcontext/contracts";
import {
  checkProseAnchors,
  humanOwnedMarkdownLines,
  type ProseAnchorCodeGraph,
  type ProseAnchorDeclaration,
  type ProseAnchorNodeInput,
  type ProseAnchorTree
} from "@archcontext/core/projection-engine";

const SCHEMA = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../schemas/runtime/docs-anchors.schema.json"), "utf8"));

/** A Git-visible tree held in memory: path to line count. */
function fakeTree(files: Record<string, number>, ignored: string[] = []): ProseAnchorTree {
  const paths = Object.keys(files).sort();
  const directories = new Set(paths.flatMap((path) => path.split("/").slice(0, -1).map((_, index, segments) => segments.slice(0, index + 1).join("/"))));
  return {
    kind: (path) => path in files ? "file" : directories.has(path) ? "directory" : undefined,
    hasTopLevelEntry: (segment) => paths.some((path) => path.split("/")[0] === segment),
    filesEndingWith: (suffix) => paths.filter((path) => path === suffix || path.endsWith(`/${suffix}`)),
    lineCount: (path) => files[path]!,
    isIgnored: (path) => ignored.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  };
}

/**
 * CodeGraph with declarations per file. Like the real word search over current source,
 * `appearsInSource` is true for every declared name and for `usedNames`. `staleNames` are
 * declarations that only a stale index still holds: they are not in the current source.
 */
function fakeCodeGraph(declarations: Record<string, Record<string, ProseAnchorDeclaration[]>>, usedNames: string[] = [], staleNames: string[] = []): ProseAnchorCodeGraph {
  const declaredNames = new Set(Object.values(declarations).flatMap((byName) => Object.keys(byName)));
  return {
    availability: "ready",
    symbols: {
      supportsPath: (path) => path.endsWith(".ts"),
      declarationsInFile: (path, name) => declarations[path]?.[name] ?? [],
      declarationsNamed: (name) => Object.values(declarations).flatMap((byName) => byName[name] ?? []),
      appearsInSource: (name) => usedNames.includes(name) || (declaredNames.has(name) && !staleNames.includes(name))
    }
  };
}

const TREE = fakeTree({
  "src/billing/charge.ts": 7,
  "src/billing/refund.ts": 20,
  "src/ledger/charge.ts": 5,
  "docs/architecture/modules/billing.md": 30
}, ["src/billing/cache"]);

const CODEGRAPH = fakeCodeGraph({
  "src/billing/charge.ts": {
    chargeCard: [{ qualifiedName: "chargeCard", startLine: 1, endLine: 3 }],
    retryCharge: [{ qualifiedName: "retryCharge", startLine: 5, endLine: 7 }],
    settle: [{ qualifiedName: "Gateway::settle", startLine: 6, endLine: 6 }]
  }
}, ["fetch"]);

function run(nodes: ProseAnchorNodeInput[], codeGraph: ProseAnchorCodeGraph = CODEGRAPH, tree: ProseAnchorTree = TREE): DocsAnchorsReportV1 {
  const report = checkProseAnchors({ profile: "default", nodes, tree, codeGraph });
  expect(docsAnchorsReportIssues(report)).toEqual([]);
  expect(validateJsonSchema(SCHEMA, report as unknown as Json).issues).toEqual([]);
  return report;
}

function documentNode(body: string): ProseAnchorNodeInput {
  return { nodeId: "capability.billing", document: { path: "docs/architecture/modules/billing.md", body } };
}

function findingSummary(report: DocsAnchorsReportV1) {
  return report.nodes.flatMap((node) => node.findings.map((finding) => ({
    kind: finding.kind,
    text: finding.citation.text,
    ...(finding.origin.kind === "document" ? { line: finding.origin.line } : { origin: finding.origin.kind }),
    ...(finding.currentLines ? { currentLines: finding.currentLines } : {}),
    ...(finding.lineCount === undefined ? {} : { lineCount: finding.lineCount })
  })));
}

describe("prose anchors (#298)", () => {
  test("valid citations produce no finding", () => {
    const report = run([documentNode([
      "# Billing",
      "Paths `src/billing/charge.ts`, `src/billing` and `./src/billing/refund.ts` exist.",
      "Lines `src/billing/charge.ts:2`, `src/billing/charge.ts:1-7` and `src/billing/charge.ts#L5` exist.",
      "Symbols `src/billing/charge.ts#chargeCard`, `src/billing/charge.ts#Gateway.settle` and `src/billing/charge.ts:6#retryCharge` resolve.",
      "A bound line inside the symbol: `src/billing/charge.ts:6` (`retryCharge`).",
      "Calls `retryCharge()` and `Gateway.settle()` are declared."
    ].join("\n"))]);
    expect(findingSummary(report)).toEqual([]);
    expect(report.nodes[0]!.unchecked).toEqual([]);
    expect(report.summary.citations).toBe(12);
    expect(report.summary.documents).toBe(1);
  });

  test("reports each finding kind with its document line", () => {
    const report = run([documentNode([
      "# Billing",
      "Missing path: `src/billing/legacy.ts` and `src/billing/charge.ts:3` is fine.",
      "Missing symbol: `src/billing/charge.ts#refundCard`.",
      "Out of range: `src/billing/charge.ts:40` and `src/billing/charge.ts:6-9`.",
      "Moved: `src/billing/charge.ts:12` (`retryCharge`) and `chargeCard` `src/billing/charge.ts:30`.",
      "Gone call: `removedRefund()`."
    ].join("\n"))]);
    expect(findingSummary(report)).toEqual([
      { kind: "missing-path", text: "src/billing/legacy.ts", line: 2 },
      { kind: "missing-symbol", text: "src/billing/charge.ts#refundCard", line: 3 },
      { kind: "line-out-of-range", text: "src/billing/charge.ts:40", line: 4, lineCount: 7 },
      { kind: "line-out-of-range", text: "src/billing/charge.ts:6-9", line: 4, lineCount: 7 },
      { kind: "line-moved", text: "src/billing/charge.ts:12", line: 5, currentLines: [5] },
      { kind: "line-moved", text: "src/billing/charge.ts:30", line: 5, currentLines: [1] },
      { kind: "missing-symbol", text: "removedRefund()", line: 6 }
    ]);
    const moved = report.nodes[0]!.findings.find((finding) => finding.kind === "line-moved")!;
    expect(moved.citation).toEqual({ text: "src/billing/charge.ts:12", path: "src/billing/charge.ts", line: 12, symbol: "retryCharge" });
    expect(report.summary.byKind).toEqual({ "line-moved": 2, "line-out-of-range": 2, "missing-path": 1, "missing-symbol": 2 });
  });

  test("ignores generated regions, fenced code and HTML comments", () => {
    const body = [
      "# Billing",
      "<!-- BEGIN ARCHCONTEXT:generated target=\"projection_target.entity.capability-billing\" sourceDigest=\"sha256:0\" -->",
      "Generated: `src/billing/generated-only.ts` and `src/billing/charge.ts:999` and `goneCall()`.",
      "<!-- END ARCHCONTEXT:generated target=\"projection_target.entity.capability-billing\" -->",
      "```ts",
      "import { x } from \"`src/billing/fenced.ts`\";",
      "```",
      "<!-- human note: `src/billing/commented.ts`",
      "still a comment `src/billing/commented-too.ts` -->",
      "Human: `src/billing/human-missing.ts`."
    ].join("\n");
    expect(humanOwnedMarkdownLines(body).map((line) => line.line)).toEqual([1, 10]);
    const report = run([documentNode(body)]);
    expect(findingSummary(report)).toEqual([{ kind: "missing-path", text: "src/billing/human-missing.ts", line: 10 }]);
  });

  test("a generated region without its END marker hides the rest of the document", () => {
    const body = "Human `src/billing/a-missing.ts`.\n<!-- BEGIN ARCHCONTEXT:generated target=\"t\" -->\n`src/billing/b-missing.ts`\n";
    expect(findingSummary(run([documentNode(body)]))).toEqual([{ kind: "missing-path", text: "src/billing/a-missing.ts", line: 1 }]);
  });

  test("checks node summary and responsibilities", () => {
    const report = run([{
      nodeId: "capability.billing",
      summary: "Charges go through `src/billing/charge.ts#chargeCard` and `src/billing/gone.ts`.",
      responsibilities: ["Retry through `retryCharge()`.", "Refund through `removedRefund()`."]
    }]);
    expect(findingSummary(report)).toEqual([
      { kind: "missing-path", text: "src/billing/gone.ts", origin: "node-summary" },
      { kind: "missing-symbol", text: "removedRefund()", origin: "node-responsibility" }
    ]);
    expect(report.nodes[0]!.findings[1]!.origin).toEqual({ kind: "node-responsibility", index: 1 });
    expect(report.nodes[0]!.documentPath).toBeUndefined();
    expect(report.nodes[0]!.citationCount).toBe(4);
  });

  test("stays conservative on tokens that are not citations", () => {
    const report = run([documentNode([
      "Media type `application/json`, package `@archcontext/contracts`, schema `archcontext.node/v2`.",
      "Globs `packages/**/src/**`, placeholders `docs/adr/ADR-NNNN-*.md` and `<id>`, commands `archctx docs drift`.",
      "Field names `staleNodes` and `reasonCodes`, values `noop`, dotted `source.include`, URL `https://example.test/a/b`.",
      "Gitignored runtime state `src/billing/cache/state.json`; ellipsis `src/billing/...`.",
      "An external call that the source uses: `fetch()`."
    ].join("\n"))]);
    expect(findingSummary(report)).toEqual([]);
    expect(report.nodes).toEqual([{ nodeId: "capability.billing", documentPath: "docs/architecture/modules/billing.md", citationCount: 1, findings: [], unchecked: [] }]);
  });

  test("resolves a basename by suffix and reports an ambiguous one as unchecked", () => {
    const resolved = run([{ ...documentNode("Basename `refund.ts:12` and `charge.ts:5` (`retryCharge`)."), footprint: ["src/billing/charge.ts", "src/billing/refund.ts"] }]);
    expect(findingSummary(resolved)).toEqual([]);
    expect(resolved.nodes[0]!.findings).toEqual([]);
    const ambiguous = run([documentNode("Two files: `charge.ts:5`. None: `nowhere.ts:1`.")]);
    expect(ambiguous.nodes[0]!.unchecked.map((entry) => [entry.reasonCode, entry.citation.text])).toEqual([["path-ambiguous", "charge.ts:5"]]);
    expect(findingSummary(ambiguous)).toEqual([{ kind: "missing-path", text: "nowhere.ts:1", line: 1 }]);
  });

  test("without CodeGraph, path and line checks still run and symbol checks are unchecked", () => {
    const report = run([documentNode([
      "Missing `src/billing/legacy.ts`; out of range `src/billing/charge.ts:40`.",
      "Bound `src/billing/charge.ts:12` (`retryCharge`); explicit `src/billing/charge.ts#refundCard`; call `removedRefund()`.",
      "Plain `chargeCard` is not counted without CodeGraph."
    ].join("\n"))], { availability: "unavailable", reasonCode: "index-missing" });
    expect(report.codeGraph).toEqual({ availability: "unavailable", reasonCode: "index-missing" });
    expect(findingSummary(report)).toEqual([
      { kind: "missing-path", text: "src/billing/legacy.ts", line: 1 },
      { kind: "line-out-of-range", text: "src/billing/charge.ts:40", line: 1, lineCount: 7 },
      { kind: "line-out-of-range", text: "src/billing/charge.ts:12", line: 2, lineCount: 7 }
    ]);
    expect(report.nodes[0]!.unchecked.map((entry) => [entry.reasonCode, entry.citation.text])).toEqual([
      ["codegraph-unavailable", "src/billing/charge.ts:12"],
      ["codegraph-unavailable", "src/billing/charge.ts#refundCard"],
      ["codegraph-unavailable", "removedRefund()"]
    ]);
    expect(report.summary.citations).toBe(5);
  });

  test("a symbol in a file CodeGraph cannot parse is unchecked, and its line is still checked", () => {
    const tree = fakeTree({ "scripts/run.sh": 4 });
    const report = run([documentNode("`scripts/run.sh:9` (`main`) and `scripts/run.sh#main`.")], CODEGRAPH, tree);
    expect(findingSummary(report)).toEqual([{ kind: "line-out-of-range", text: "scripts/run.sh:9", line: 1, lineCount: 4 }]);
    expect(report.nodes[0]!.unchecked.map((entry) => entry.reasonCode)).toEqual(["language-unsupported", "language-unsupported"]);
  });

  test("a line or symbol citation of a directory is a missing path", () => {
    expect(findingSummary(run([documentNode("`src/billing:3` and `src/billing#chargeCard`.")]))).toEqual([
      { kind: "missing-path", text: "src/billing:3", line: 1 },
      { kind: "missing-path", text: "src/billing#chargeCard", line: 1 }
    ]);
  });

  test("a call-shaped symbol that only a stale index declares is missing", () => {
    const stale = fakeCodeGraph({
      "src/billing/charge.ts": {
        retryCharge: [{ qualifiedName: "retryCharge", startLine: 5, endLine: 7 }],
        removedRefund: [{ qualifiedName: "removedRefund", startLine: 1, endLine: 3 }]
      }
    }, [], ["removedRefund"]);
    const report = run([documentNode(["# Billing", "Calls `retryCharge()` and `removedRefund()`."].join("\n"))], stale);
    expect(findingSummary(report)).toEqual([{ kind: "missing-symbol", text: "removedRefund()", line: 2 }]);
  });

  test("a backslash-escaped backtick does not open a code span", () => {
    const report = run([documentNode([
      "# Billing",
      "Literal syntax: \\`src/billing/legacy.ts` is not a citation.",
      "An escaped backslash: \\\\`src/billing/gone.ts` is a citation."
    ].join("\n"))]);
    expect(findingSummary(report)).toEqual([{ kind: "missing-path", text: "src/billing/gone.ts", line: 3 }]);
  });

  test("nodes are sorted and nodes without citations are left out", () => {
    const report = run([
      { nodeId: "capability.zeta", summary: "Uses `src/billing/charge.ts`." },
      { nodeId: "capability.alpha", summary: "Uses `src/ledger/charge.ts`." },
      { nodeId: "capability.empty", summary: "No citations here." }
    ]);
    expect(report.nodes.map((node) => node.nodeId)).toEqual(["capability.alpha", "capability.zeta"]);
    expect(report.summary.nodes).toBe(3);
  });
});
