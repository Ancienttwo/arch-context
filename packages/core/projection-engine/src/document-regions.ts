import { ARCHITECTURE_DOCS_RENDERER_VERSION, NativeContextError, digestJson, type Json, type NativeDocumentSection, type NativeHumanRegion, type NativeTextRange } from "@archcontext/contracts";

export const GENERATED_DOCUMENT_BEGIN = "<!-- BEGIN ARCHCONTEXT:generated";
export const GENERATED_DOCUMENT_END = "<!-- END ARCHCONTEXT:generated";
interface MarkdownLine { start: number; end: number; bodyEnd: number; raw: string; number: number }
interface MarkerToken { start: number; end: number; kind: "BEGIN" | "END"; marker: string; attributes: Record<string, string> }
export interface GeneratedDocumentRegion {
  start: number; end: number; bodyStart: number; bodyEnd: number;
  targetId: string | undefined; startMarker: string; attributes: Record<string, string>; closed: boolean;
}
export interface DocumentRegionDiagnostic { kind: string; start: number; end: number }
export interface DocumentRegionScan {
  humanRegions: NativeHumanRegion[];
  generatedRegions: GeneratedDocumentRegion[];
  diagnostics: DocumentRegionDiagnostic[];
  generatedLines: ReadonlySet<number>;
  headings: Array<{ start: number; end: number; title: string }>;
  range(start: number, end: number): NativeTextRange;
}

function markdownLines(body: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  while (start < body.length) {
    const newline = body.indexOf("\n", start);
    const end = newline < 0 ? body.length : newline + 1;
    const bodyEnd = newline < 0 ? end : body[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({ start, end, bodyEnd, raw: body.slice(start, bodyEnd), number: lines.length + 1 });
    start = end;
  }
  return lines;
}

export function generatedMarkerAttributes(marker: string): { attributes: Record<string, string>; valid: boolean } {
  const match = /^<!-- (BEGIN|END) ARCHCONTEXT:generated(.*?) -->$/.exec(marker);
  if (!match) return { attributes: {}, valid: false };
  const attributes: Record<string, string> = {};
  const source = match[2]!;
  const pattern = /\s+([A-Za-z][A-Za-z0-9]*)="([^"\r\n]*)"/gy;
  let offset = 0;
  let valid = true;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const attribute = pattern.exec(source);
    if (!attribute) { valid = false; break; }
    if (Object.hasOwn(attributes, attribute[1]!)) valid = false;
    attributes[attribute[1]!] = attribute[2]!;
    offset = pattern.lastIndex;
  }
  const allowed = match[1] === "BEGIN" ? ["target", "rendererVersion", "outputDigest"] : ["target"];
  if (Object.keys(attributes).some(key => !allowed.includes(key)) || !attributes.target) valid = false;
  if (match[1] === "BEGIN" && (!attributes.rendererVersion || !/^sha256:[a-f0-9]{64}$/.test(attributes.outputDigest ?? ""))) valid = false;
  return { attributes, valid };
}

/** Offset-preserving lexer shared by projection, citation and native readers. */
export function scanDocumentRegions(body: string): DocumentRegionScan {
  const lines = markdownLines(body);
  const diagnostics: DocumentRegionDiagnostic[] = [];
  const generatedRegions: GeneratedDocumentRegion[] = [];
  const headings: DocumentRegionScan["headings"] = [];
  const tokens: MarkerToken[] = [];
  const targets = new Set<string>();
  let generated: GeneratedDocumentRegion | undefined;
  let fence: { char: string; length: number } | undefined;
  let inComment = false;
  for (const line of lines) {
    const raw = line.raw;
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw.replace(/^\uFEFF/, ""));
    if (open && !inComment) { fence = { char: open[1]![0]!, length: open[1]!.length }; continue; }
    let visible = "";
    let column = 0;
    let inlineCode: number | undefined;
    while (column < raw.length) {
      if (inComment) {
        const end = raw.indexOf("-->", column);
        if (end < 0) break;
        column = end + 3; inComment = false; continue;
      }
      if (raw[column] === "`") {
        const run = /^`+/.exec(raw.slice(column))![0].length;
        inlineCode = inlineCode === run ? undefined : inlineCode === undefined ? run : inlineCode;
        if (!generated) visible += raw.slice(column, column + run);
        column += run; continue;
      }
      const begin = raw.startsWith(GENERATED_DOCUMENT_BEGIN, column);
      const end = raw.startsWith(GENERATED_DOCUMENT_END, column);
      if ((begin || end) && inlineCode === undefined) {
        const close = raw.indexOf("-->", column);
        const tokenEnd = close < 0 ? raw.length : close + 3;
        const marker = raw.slice(column, tokenEnd);
        const parsed = generatedMarkerAttributes(marker);
        const token: MarkerToken = { start: line.start + column, end: line.start + tokenEnd, kind: begin ? "BEGIN" : "END", marker, attributes: parsed.attributes };
        tokens.push(token);
        if (!parsed.valid) diagnostics.push({ kind: "marker-syntax-or-attributes", start: token.start, end: token.end });
        if (begin) {
          if (generated) diagnostics.push({ kind: "marker-nested", start: token.start, end: token.end });
          else {
            if (parsed.attributes.target && targets.has(parsed.attributes.target)) diagnostics.push({ kind: "marker-duplicate", start: token.start, end: token.end });
            if (parsed.attributes.target) targets.add(parsed.attributes.target);
            generated = { start: token.start, end: body.length, bodyStart: token.end, bodyEnd: body.length, targetId: parsed.attributes.target, startMarker: marker, attributes: parsed.attributes, closed: false };
          }
        } else if (!generated) diagnostics.push({ kind: "marker-unmatched-end", start: token.start, end: token.end });
        else if (generated.targetId !== parsed.attributes.target) diagnostics.push({ kind: "marker-target-mismatch", start: token.start, end: token.end });
        else {
          generated.bodyEnd = token.start;
          generated.end = token.end === line.bodyEnd ? line.end : token.end;
          generated.closed = true;
          generatedRegions.push(generated); generated = undefined;
        }
        column = tokenEnd; continue;
      }
      if (raw.startsWith("<!--", column) && inlineCode === undefined) { inComment = true; column += 4; continue; }
      if (!generated) visible += raw[column];
      column += 1;
    }
    const heading = /^ {0,3}##[ \t]+(.+?)\s*(?:[ \t]+#+\s*)?$/.exec(visible.replace(/^\uFEFF/, ""));
    if (heading && /^ {0,3}##[ \t]+/.test(raw.replace(/^\uFEFF/, "")) && !generated && !generatedRegions.some(region => region.start < line.end && region.end > line.start)) headings.push({ start: line.start, end: line.end, title: heading[1]! });
  }
  if (generated) {
    diagnostics.push({ kind: "marker-unmatched-begin", start: generated.start, end: generated.bodyStart });
    generatedRegions.push(generated);
  }
  const points = [...new Set([0, body.length, ...lines.flatMap(line => [line.start, line.end]), ...tokens.flatMap(token => [token.start, token.end]), ...generatedRegions.flatMap(region => [region.start, region.end, region.bodyStart, region.bodyEnd])])].sort((a, b) => a - b);
  const byteOffsets = new Map<number, number>();
  let previous = 0;
  let bytes = 0;
  for (const point of points) { bytes += Buffer.byteLength(body.slice(previous, point), "utf8"); byteOffsets.set(point, bytes); previous = point; }
  const lineAt = (offset: number): number => {
    let low = 0, high = lines.length;
    while (low < high) { const middle = (low + high) >>> 1; if (lines[middle]!.start <= offset) low = middle + 1; else high = middle; }
    return Math.max(1, low);
  };
  const range = (start: number, end: number): NativeTextRange => ({ startByte: byteOffsets.get(start)!, endByte: byteOffsets.get(end)!, startLine: lineAt(start), endLine: lineAt(Math.max(start, end - 1)) });
  const humanRegions: NativeHumanRegion[] = [];
  const generatedLines = new Set<number>();
  let cursor = 0;
  for (const region of generatedRegions) {
    if (region.start > cursor) humanRegions.push({ ...range(cursor, region.start), text: body.slice(cursor, region.start) });
    for (let line = lineAt(region.start); line <= lineAt(Math.max(region.start, region.end - 1)); line += 1) generatedLines.add(line);
    cursor = region.end;
  }
  if (cursor < body.length) humanRegions.push({ ...range(cursor, body.length), text: body.slice(cursor) });
  return { humanRegions, generatedRegions, diagnostics, generatedLines, headings, range };
}

export function absentNativeSection(state: "missing" | "absent"): NativeDocumentSection {
  return { state, heading: null, bodyRanges: [], body: null };
}

export function analyzeNativeDocument(body: string, path: string, targetId: string): { markerState: "present" | "absent"; humanRegions: NativeHumanRegion[]; section3: NativeDocumentSection; backlog: NativeDocumentSection } {
  const scan = scanDocumentRegions(body);
  const diagnostics = [...scan.diagnostics];
  for (const region of scan.generatedRegions) {
    if (region.targetId !== targetId) diagnostics.push({ kind: "unexpected-target", start: region.start, end: region.end });
    if (region.attributes.rendererVersion !== ARCHITECTURE_DOCS_RENDERER_VERSION) diagnostics.push({ kind: "unsupported-renderer", start: region.start, end: region.bodyStart });
    const generatedBody = body.slice(region.bodyStart, region.bodyEnd).replace(/^\r?\n/, "").replace(/\r?\n$/, "").replace(/\r\n/g, "\n");
    if (region.attributes.outputDigest !== digestJson({ targetId, body: `${generatedBody.trimEnd()}\n` })) diagnostics.push({ kind: "output-digest-mismatch", start: region.start, end: region.end });
  }
  if (diagnostics.length > 0) throw new NativeContextError("native-document-marker-invalid", { path, targetId, diagnostics: diagnostics.slice(0, 32).map(diagnostic => ({ kind: diagnostic.kind, range: scan.range(diagnostic.start, diagnostic.end) })) as unknown as Json, omittedDiagnosticCount: Math.max(0, diagnostics.length - 32) });
  const section = (kind: "section3" | "backlog"): NativeDocumentSection => {
    const matching = scan.headings.filter(heading => kind === "section3" ? /^3\.\s/.test(heading.title) : heading.title === "Optimization Backlog");
    if (matching.length > 1) throw new NativeContextError("native-document-section-ambiguous", { path, targetId, section: kind, headingCount: matching.length });
    const heading = matching[0];
    if (!heading) return absentNativeSection("absent");
    const end = scan.headings.find(other => other.start >= heading.end)?.start ?? body.length;
    const ranges = scan.humanRegions.flatMap(region => {
      const sectionStart = scan.range(heading.end, end).startByte;
      const sectionEnd = scan.range(heading.end, end).endByte;
      const startByte = Math.max(sectionStart, region.startByte);
      const endByte = Math.min(sectionEnd, region.endByte);
      return endByte > startByte ? [{ startByte, endByte, startLine: startByte === sectionStart ? scan.range(heading.end, end).startLine : region.startLine, endLine: endByte === sectionEnd ? scan.range(heading.end, end).endLine : region.endLine }] : [];
    });
    const raw = Buffer.from(body, "utf8");
    const text = ranges.map(range => raw.subarray(range.startByte, range.endByte).toString("utf8")).join("");
    return { state: text.trim().length === 0 ? "empty" : "present", heading: { text: body.slice(heading.start, heading.end), range: scan.range(heading.start, heading.end) }, bodyRanges: ranges, body: text };
  };
  return { markerState: scan.generatedRegions.length === 0 ? "absent" : "present", humanRegions: scan.humanRegions, section3: section("section3"), backlog: section("backlog") };
}
