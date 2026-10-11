import {
  DOCS_ANCHORS_REPORT_SCHEMA_VERSION,
  DOCS_ANCHOR_FINDING_KINDS,
  type DocsAnchorCitationV1,
  type DocsAnchorCodeGraphUnavailableReasonCode,
  type DocsAnchorFindingV1,
  type DocsAnchorOriginV1,
  type DocsAnchorsNodeV1,
  type DocsAnchorsReportV1,
  type DocsAnchorUncheckedV1
} from "@archcontext/contracts";
import type { ArchitectureProjectionProfile } from "./layout";

// --- Prose anchors (#298) ---
//
// Human-owned text cites code: module document sections outside the generated region, and node
// `summary` / `responsibilities`. Nothing else re-reads those citations, so they go stale silently.
// This module extracts citations from that text and checks them against the current tree and
// CodeGraph. It is a read-only signal: it never writes, and it never changes projection freshness.
//
// What counts as a citation (only inline code spans; fenced code blocks and HTML comments are
// skipped, and generated regions are never read):
// - `path`, with a `/`: a Git-visible file or directory. It is reported missing only when its first
//   segment is a top-level entry of the tree, so `application/json` or a package name is ignored.
//   A path that Git ignores (runtime state, build output) is never a citation.
// - `path:line`, `path:start-end`, `path#L12`: the line must exist in the file.
// - `path#symbol` (also `path:line#symbol`): the file must declare the symbol.
// - A `path:line` span directly followed or preceded by an identifier span (`a.ts:12` (`run`)) binds
//   that symbol. When the bound line is outside every declaration of the symbol, it is `line-moved`.
//   A bare `path:line` has no symbol, so it can only be `line-out-of-range`.
// - A path in an explicit form (`:line`, `#L`, `#symbol`) that is not found at the root, such as a
//   basename `runtime.ts:277`, resolves by path suffix, first in the node's source footprint.
// - `name()` or `Type.name()`: a call-shaped identifier is a cited symbol. It is `missing-symbol`
//   only when CodeGraph declares no symbol with that name and no supported source file contains it.
// - A plain identifier `name` counts as a citation only when CodeGraph declares it. It is never
//   reported missing: plain identifiers are too often field names, values or prose terms.

export interface ProseAnchorTree {
  /** The Git-visible entry at this repo-relative path, if any. */
  kind(path: string): "file" | "directory" | undefined;
  /** True when this first path segment is a top-level entry of the Git-visible tree. */
  hasTopLevelEntry(segment: string): boolean;
  /** Git-visible files equal to `suffix` or ending with `/<suffix>`, sorted. */
  filesEndingWith(suffix: string): string[];
  lineCount(path: string): number;
  /** True when Git ignores this path, as a file or as a directory. */
  isIgnored(path: string): boolean;
}

export interface ProseAnchorDeclaration {
  qualifiedName: string;
  startLine: number;
  endLine: number;
}

export interface ProseAnchorSymbols {
  /** True when CodeGraph can extract declarations from this file. */
  supportsPath(path: string): boolean;
  /** Declarations with this simple name in the current content of a file. */
  declarationsInFile(path: string, name: string): ProseAnchorDeclaration[];
  /** Declarations with this simple name anywhere in the CodeGraph index. */
  declarationsNamed(name: string): ProseAnchorDeclaration[];
  /** True when a supported Git-visible source file contains this name as a whole word. */
  appearsInSource(name: string): boolean;
}

export type ProseAnchorCodeGraph =
  | { availability: "ready"; symbols: ProseAnchorSymbols }
  | { availability: "unavailable"; reasonCode: DocsAnchorCodeGraphUnavailableReasonCode };

export interface ProseAnchorNodeInput {
  nodeId: string;
  summary?: string;
  responsibilities?: string[];
  /** The node's source footprint, used to choose between files that share a path suffix. */
  footprint?: readonly string[];
  document?: { path: string; body: string };
}

export interface ProseAnchorCheckInput {
  profile: ArchitectureProjectionProfile;
  nodes: ProseAnchorNodeInput[];
  tree: ProseAnchorTree;
  codeGraph: ProseAnchorCodeGraph;
}

type ParsedCitation =
  | { form: "path"; text: string; path: string; directory: boolean; explicit: boolean; line?: number; endLine?: number; symbol?: string }
  | { form: "call"; text: string; symbol: string }
  | { form: "identifier"; text: string; symbol: string };

interface LocatedCitation {
  origin: DocsAnchorOriginV1;
  parsed: ParsedCitation;
}

const IDENTIFIER = "[A-Za-z_][A-Za-z0-9_$]*";
const QUALIFIED_IDENTIFIER = `${IDENTIFIER}(?:\\.${IDENTIFIER})*`;
const IDENTIFIER_PATTERN = new RegExp(`^${IDENTIFIER}$`);
const QUALIFIED_PATTERN = new RegExp(`^${QUALIFIED_IDENTIFIER}$`);
const CALL_PATTERN = new RegExp(`^(${QUALIFIED_IDENTIFIER})\\(\\)$`);
const PATH_PATTERN = /^[A-Za-z0-9_.@+\-/]+$/;
const LINE_FRAGMENT = /^L(\d+)(?:-L?(\d+))?$/;
const LINE_SUFFIX = /^(.*?):(\d+)(?:-(\d+))?$/;
const FILE_EXTENSION = /\.[A-Za-z0-9]+$/;
/** Text allowed between a `path:line` span and the identifier span it binds. */
const BINDING_GAP = /^\s*[([,:–—-]?\s*$/;
const GENERATED_BEGIN = /<!-- BEGIN ARCHCONTEXT:generated target="([^"]+)"[^>]*-->/;

export function checkProseAnchors(input: ProseAnchorCheckInput): DocsAnchorsReportV1 {
  const nodes: DocsAnchorsNodeV1[] = [];
  let documents = 0;
  // Code-unit order, the order `docsAnchorsReportIssues` checks.
  for (const node of [...input.nodes].sort((left, right) => left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0)) {
    if (node.document) documents += 1;
    const result = checkNode(node, input);
    if (result.citationCount > 0) nodes.push(result);
  }
  const findings = nodes.flatMap((node) => node.findings);
  const byKind = Object.fromEntries(DOCS_ANCHOR_FINDING_KINDS.map((kind) => [kind, findings.filter((finding) => finding.kind === kind).length])) as DocsAnchorsReportV1["summary"]["byKind"];
  return {
    schemaVersion: DOCS_ANCHORS_REPORT_SCHEMA_VERSION,
    profile: input.profile,
    codeGraph: input.codeGraph.availability === "ready"
      ? { availability: "ready" }
      : { availability: "unavailable", reasonCode: input.codeGraph.reasonCode },
    summary: {
      nodes: input.nodes.length,
      documents,
      citations: nodes.reduce((total, node) => total + node.citationCount, 0),
      findings: findings.length,
      unchecked: nodes.reduce((total, node) => total + node.unchecked.length, 0),
      byKind
    },
    nodes
  };
}

/** The citations written in a node's prose and in the human-owned regions of its document. */
function extractNodeProseCitations(node: Pick<ProseAnchorNodeInput, "summary" | "responsibilities" | "document">): LocatedCitation[] {
  const located: LocatedCitation[] = [];
  if (typeof node.summary === "string") {
    for (const line of node.summary.split(/\r?\n/)) {
      located.push(...parseLineCitations(line).map((parsed) => ({ origin: { kind: "node-summary" as const }, parsed })));
    }
  }
  for (const [index, responsibility] of (node.responsibilities ?? []).entries()) {
    if (typeof responsibility !== "string") continue;
    for (const line of responsibility.split(/\r?\n/)) {
      located.push(...parseLineCitations(line).map((parsed) => ({ origin: { kind: "node-responsibility" as const, index }, parsed })));
    }
  }
  if (node.document) {
    for (const { line, text } of humanOwnedMarkdownLines(node.document.body)) {
      located.push(...parseLineCitations(text).map((parsed) => ({ origin: { kind: "document" as const, path: node.document!.path, line }, parsed })));
    }
  }
  return located;
}

/**
 * The human-owned lines of a projected document, with their 1-based line numbers. Generated
 * regions (BEGIN to the matching END marker; to the end of the file when the END marker is
 * missing), fenced code blocks and HTML comments are left out.
 */
export function humanOwnedMarkdownLines(body: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let generatedEnd: string | undefined;
  let fence: { char: string; length: number } | undefined;
  let inComment = false;
  for (const [index, raw] of body.split(/\r?\n/).entries()) {
    if (generatedEnd !== undefined) {
      if (raw.includes(generatedEnd)) generatedEnd = undefined;
      continue;
    }
    const begin = GENERATED_BEGIN.exec(raw);
    if (begin) {
      const end = `<!-- END ARCHCONTEXT:generated target="${begin[1]}" -->`;
      if (!raw.slice(begin.index + begin[0].length).includes(end)) generatedEnd = end;
      continue;
    }
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (open && !inComment) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      continue;
    }
    const stripped = stripHtmlComments(raw, inComment);
    inComment = stripped.inComment;
    if (stripped.text.trim() !== "") lines.push({ line: index + 1, text: stripped.text });
  }
  return lines;
}

function stripHtmlComments(raw: string, inComment: boolean): { text: string; inComment: boolean } {
  let text = "";
  let rest = raw;
  let open = inComment;
  while (rest.length > 0) {
    if (open) {
      const close = rest.indexOf("-->");
      if (close < 0) return { text, inComment: true };
      rest = rest.slice(close + 3);
      open = false;
      continue;
    }
    const start = rest.indexOf("<!--");
    if (start < 0) return { text: text + rest, inComment: false };
    text += rest.slice(0, start);
    rest = rest.slice(start + 4);
    open = true;
  }
  return { text, inComment: open };
}

/** The inline code spans of one line, CommonMark style: a closing run must match the opening run. */
function inlineCodeSpans(text: string): { content: string; start: number; end: number }[] {
  const spans: { content: string; start: number; end: number }[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    if (precedingBackslashes(text, index) % 2 === 1) {
      // A backslash-escaped backtick is literal text, not a code span delimiter.
      index += 1;
      continue;
    }
    let runEnd = index;
    while (text[runEnd] === "`") runEnd += 1;
    const ticks = runEnd - index;
    let cursor = runEnd;
    let close = -1;
    while (cursor < text.length) {
      if (text[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let closeEnd = cursor;
      while (text[closeEnd] === "`") closeEnd += 1;
      if (closeEnd - cursor === ticks) {
        close = cursor;
        break;
      }
      cursor = closeEnd;
    }
    if (close < 0) {
      index = runEnd;
      continue;
    }
    let content = text.slice(runEnd, close);
    if (content.length > 2 && content.startsWith(" ") && content.endsWith(" ")) content = content.slice(1, -1);
    spans.push({ content, start: index, end: close + ticks });
    index = close + ticks;
  }
  return spans;
}

function precedingBackslashes(text: string, index: number): number {
  let count = 0;
  while (index - count - 1 >= 0 && text[index - count - 1] === "\\") count += 1;
  return count;
}

function parseLineCitations(text: string): ParsedCitation[] {
  const spans = inlineCodeSpans(text);
  const parsed = spans.map((span) => parseCitationText(span.content));
  const consumed = new Set<number>();
  for (const [index, citation] of parsed.entries()) {
    if (citation?.form !== "path" || citation.line === undefined || citation.symbol !== undefined) continue;
    const bind = (other: number, gap: string) => {
      const candidate = parsed[other];
      if (consumed.has(other) || !candidate || candidate.form === "path" || !BINDING_GAP.test(gap)) return false;
      citation.symbol = candidate.symbol;
      consumed.add(other);
      return true;
    };
    if (index + 1 < spans.length && bind(index + 1, text.slice(spans[index]!.end, spans[index + 1]!.start))) continue;
    if (index > 0) bind(index - 1, text.slice(spans[index - 1]!.end, spans[index]!.start));
  }
  return parsed.flatMap((citation, index) => citation && !consumed.has(index) ? [citation] : []);
}

function parseCitationText(raw: string): ParsedCitation | undefined {
  const text = raw.trim();
  if (text === "" || /\s/.test(text)) return undefined;
  const call = CALL_PATTERN.exec(text);
  if (call) return { form: "call", text, symbol: call[1]! };
  if (IDENTIFIER_PATTERN.test(text)) return { form: "identifier", text, symbol: text };
  let rest = text;
  let line: number | undefined;
  let endLine: number | undefined;
  let symbol: string | undefined;
  let explicit = false;
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    const fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    const lineFragment = LINE_FRAGMENT.exec(fragment);
    if (lineFragment) {
      line = Number(lineFragment[1]);
      endLine = lineFragment[2] === undefined ? undefined : Number(lineFragment[2]);
    } else if (QUALIFIED_PATTERN.test(fragment)) {
      symbol = fragment;
    } else {
      return undefined;
    }
    explicit = true;
  }
  const lineSuffix = LINE_SUFFIX.exec(rest);
  if (lineSuffix) {
    if (line !== undefined) return undefined;
    rest = lineSuffix[1]!;
    line = Number(lineSuffix[2]);
    endLine = lineSuffix[3] === undefined ? undefined : Number(lineSuffix[3]);
    explicit = true;
  }
  if (line !== undefined && (line < 1 || (endLine !== undefined && endLine < line))) return undefined;
  const written = rest.replace(/^\.\//, "");
  if (!PATH_PATTERN.test(written) || written.startsWith("/")) return undefined;
  const directory = written.endsWith("/");
  const path = directory ? written.slice(0, -1) : written;
  const segments = path.split("/");
  if (path === "" || segments.some((segment) => segment === "" || /^\.+$/.test(segment))) return undefined;
  if (!explicit && segments.length < 2) return undefined;
  if (explicit && segments.length < 2 && !FILE_EXTENSION.test(path)) return undefined;
  return {
    form: "path",
    text,
    path,
    directory,
    explicit,
    ...(line === undefined ? {} : { line }),
    ...(endLine === undefined ? {} : { endLine }),
    ...(symbol === undefined ? {} : { symbol })
  };
}

function checkNode(node: ProseAnchorNodeInput, input: ProseAnchorCheckInput): DocsAnchorsNodeV1 {
  const findings: DocsAnchorFindingV1[] = [];
  const unchecked: DocsAnchorUncheckedV1[] = [];
  let citationCount = 0;
  for (const { origin, parsed } of extractNodeProseCitations(node)) {
    const outcome = parsed.form === "path"
      ? checkPathCitation(parsed, node, input)
      : checkSymbolCitation(parsed, input.codeGraph);
    if (!outcome.counted) continue;
    citationCount += 1;
    for (const finding of outcome.findings) findings.push({ ...finding, origin, citation: outcome.citation });
    for (const reasonCode of outcome.unchecked) unchecked.push({ reasonCode, origin, citation: outcome.citation });
  }
  return {
    nodeId: node.nodeId,
    ...(node.document ? { documentPath: node.document.path } : {}),
    citationCount,
    findings,
    unchecked
  };
}

interface CitationOutcome {
  counted: boolean;
  citation: DocsAnchorCitationV1;
  findings: Omit<DocsAnchorFindingV1, "origin" | "citation">[];
  unchecked: DocsAnchorUncheckedV1["reasonCode"][];
}

function checkSymbolCitation(parsed: Extract<ParsedCitation, { form: "call" | "identifier" }>, codeGraph: ProseAnchorCodeGraph): CitationOutcome {
  const citation: DocsAnchorCitationV1 = { text: parsed.text, symbol: parsed.symbol };
  if (codeGraph.availability !== "ready") {
    return parsed.form === "call"
      ? { counted: true, citation, findings: [], unchecked: ["codegraph-unavailable"] }
      : { counted: false, citation, findings: [], unchecked: [] };
  }
  const { name, container } = splitSymbol(parsed.symbol);
  const declared = matchingDeclarations(codeGraph.symbols.declarationsNamed(name), container).length > 0;
  if (parsed.form === "identifier") return { counted: declared, citation, findings: [], unchecked: [] };
  // The index can be stale after a rename or delete, so only the current source decides "missing".
  const missing = !codeGraph.symbols.appearsInSource(name);
  return { counted: true, citation, findings: missing ? [{ kind: "missing-symbol" }] : [], unchecked: [] };
}

function checkPathCitation(parsed: Extract<ParsedCitation, { form: "path" }>, node: ProseAnchorNodeInput, input: ProseAnchorCheckInput): CitationOutcome {
  const citation: DocsAnchorCitationV1 = {
    text: parsed.text,
    path: parsed.path,
    ...(parsed.line === undefined ? {} : { line: parsed.line }),
    ...(parsed.endLine === undefined ? {} : { endLine: parsed.endLine }),
    ...(parsed.symbol === undefined ? {} : { symbol: parsed.symbol })
  };
  const resolution = resolveCitedPath(parsed, node, input.tree);
  if (resolution.status === "ignored") return { counted: false, citation, findings: [], unchecked: [] };
  if (resolution.status === "ambiguous") return { counted: true, citation, findings: [], unchecked: ["path-ambiguous"] };
  const needsFile = parsed.line !== undefined || parsed.symbol !== undefined;
  if (resolution.status === "missing" || (needsFile && resolution.kind !== "file")) {
    return { counted: true, citation, findings: [{ kind: "missing-path" }], unchecked: [] };
  }
  const resolved = resolution;
  if (resolved.path !== parsed.path) citation.resolvedPath = resolved.path;
  if (!needsFile) return { counted: true, citation, findings: [], unchecked: [] };

  const lineFinding = (): CitationOutcome["findings"] => {
    if (parsed.line === undefined) return [];
    const lineCount = input.tree.lineCount(resolved.path);
    return (parsed.endLine ?? parsed.line) > lineCount ? [{ kind: "line-out-of-range", lineCount }] : [];
  };
  if (parsed.symbol === undefined) return { counted: true, citation, findings: lineFinding(), unchecked: [] };
  if (input.codeGraph.availability !== "ready") {
    return { counted: true, citation, findings: lineFinding(), unchecked: ["codegraph-unavailable"] };
  }
  const symbols = input.codeGraph.symbols;
  if (!symbols.supportsPath(resolved.path)) {
    return { counted: true, citation, findings: lineFinding(), unchecked: ["language-unsupported"] };
  }
  const { name, container } = splitSymbol(parsed.symbol);
  const declarations = matchingDeclarations(symbols.declarationsInFile(resolved.path, name), container);
  if (declarations.length === 0) return { counted: true, citation, findings: [{ kind: "missing-symbol" }], unchecked: [] };
  const line = parsed.line;
  if (line === undefined || declarations.some((declaration) => declaration.startLine <= line && line <= declaration.endLine)) {
    return { counted: true, citation, findings: [], unchecked: [] };
  }
  const currentLines = [...new Set(declarations.map((declaration) => declaration.startLine))].sort((left, right) => left - right);
  return { counted: true, citation, findings: [{ kind: "line-moved", currentLines }], unchecked: [] };
}

type ResolvedPath =
  | { status: "resolved"; path: string; kind: "file" | "directory" }
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "ignored" };

function resolveCitedPath(parsed: Extract<ParsedCitation, { form: "path" }>, node: ProseAnchorNodeInput, tree: ProseAnchorTree): ResolvedPath {
  const direct = tree.kind(parsed.path);
  if (direct && !(parsed.directory && direct === "file")) return { status: "resolved", path: parsed.path, kind: direct };
  // A gitignored path names runtime state or build output, which is never in the Git-visible tree.
  const missing = (): ResolvedPath => tree.isIgnored(parsed.path) ? { status: "ignored" } : { status: "missing" };
  const anchored = parsed.path.includes("/") && tree.hasTopLevelEntry(parsed.path.split("/")[0]!);
  if (anchored) return missing();
  if (!parsed.explicit) return { status: "ignored" };
  let matches = tree.filesEndingWith(parsed.path);
  if (matches.length > 1 && node.footprint) {
    const footprint = new Set(node.footprint);
    const inFootprint = matches.filter((path) => footprint.has(path));
    if (inFootprint.length === 1) matches = inFootprint;
  }
  if (matches.length === 0) return missing();
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "resolved", path: matches[0]!, kind: "file" };
}

function splitSymbol(symbol: string): { name: string; container?: string } {
  const segments = symbol.split(".");
  return segments.length > 1
    ? { name: segments[segments.length - 1]!, container: segments[segments.length - 2]! }
    : { name: symbol };
}

/** `Type.name` matches only declarations whose qualified name has `Type` as a segment. */
function matchingDeclarations(declarations: ProseAnchorDeclaration[], container: string | undefined): ProseAnchorDeclaration[] {
  if (container === undefined) return declarations;
  return declarations.filter((declaration) => declaration.qualifiedName.split(/::|\.|#|\//).includes(container));
}
