import {
  PROJECTION_FILE_PREVIEW_MAX_BYTES,
  PROJECTION_PREVIEW_TOTAL_MAX_BYTES,
  type ProjectionFilePreviewV1
} from "@archcontext/contracts";

/**
 * What one projection file entry would write, as the `plan` preview carries it (#264). `create`
 * shows the rendered body; `update` and `delete` show a unified diff from the bytes on disk.
 */
export interface ArchitectureProjectionPreviewInput {
  path: string;
  action: "create" | "update" | "delete";
  /** The bytes on disk; required for `update` and `delete`. */
  before?: string;
  /** The rendered bytes; required for `create` and `update`. */
  after?: string;
}

/**
 * Bounded previews for a whole result, in the order given (callers pass path order). Each content
 * is cut at a line boundary to PROJECTION_FILE_PREVIEW_MAX_BYTES and to what remains of
 * PROJECTION_PREVIEW_TOTAL_MAX_BYTES, so later files may be truncated, down to empty content, once
 * the result budget is spent. A missing body fails closed.
 */
export function architectureProjectionFilePreviews(entries: readonly ArchitectureProjectionPreviewInput[]): ProjectionFilePreviewV1[] {
  let remaining = PROJECTION_PREVIEW_TOTAL_MAX_BYTES;
  return entries.map((entry) => {
    const preview = boundedPreview(entry, Math.min(PROJECTION_FILE_PREVIEW_MAX_BYTES, remaining));
    remaining -= utf8(preview.content).length;
    return preview;
  });
}

function boundedPreview(entry: ArchitectureProjectionPreviewInput, limit: number): ProjectionFilePreviewV1 {
  const { format, content } = fullPreview(entry);
  const bytes = utf8(content);
  if (bytes.length <= limit) return { format, content, byteLength: bytes.length, truncated: false };
  return { format, content: truncateUtf8(bytes, limit), byteLength: bytes.length, truncated: true };
}

function fullPreview(entry: ArchitectureProjectionPreviewInput): Pick<ProjectionFilePreviewV1, "format" | "content"> {
  if (entry.action === "create") {
    if (entry.after === undefined) throw new Error(`projection-preview-rendered-body-missing: ${entry.path}`);
    return { format: "body", content: entry.after };
  }
  if (entry.before === undefined) throw new Error(`projection-preview-current-body-missing: ${entry.path}`);
  if (entry.action === "update" && entry.after === undefined) throw new Error(`projection-preview-rendered-body-missing: ${entry.path}`);
  return {
    format: "unified-diff",
    content: unifiedDiff(entry.path, entry.before, entry.action === "delete" ? undefined : entry.after!)
  };
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { fatal: true });

function utf8(value: string): Uint8Array {
  return ENCODER.encode(value);
}

/**
 * The longest prefix of whole lines within `limit` bytes. When the first line alone is longer, the
 * preview is empty: a cut always lands on a line boundary, never inside a line or a character.
 */
function truncateUtf8(bytes: Uint8Array, limit: number): string {
  if (limit <= 0) return "";
  return DECODER.decode(bytes.subarray(0, bytes.lastIndexOf(0x0a, limit - 1) + 1));
}

type DiffOp = { kind: " " | "-" | "+"; line: string };

const CONTEXT_LINES = 3;
/**
 * Myers search depth bound. Past it the remaining middle is reported as a whole replacement: still
 * a correct diff of the same bytes, only not a minimal one, so a rewritten document cannot make
 * the preview quadratic in memory.
 */
const MAX_EDIT_DISTANCE = 2_000;

/** A unified diff (three context lines, `a/` and `b/` prefixes; `/dev/null` for a delete). */
export function unifiedDiff(path: string, before: string, after: string | undefined): string {
  const ops = diffLines(splitLines(before), splitLines(after ?? ""));
  const hunks = diffHunks(ops);
  if (hunks.length === 0) return "";
  const out = [`--- a/${path}\n`, after === undefined ? "+++ /dev/null\n" : `+++ b/${path}\n`];
  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const op of ops) {
    oldBefore.push(oldLine);
    newBefore.push(newLine);
    if (op.kind !== "+") oldLine += 1;
    if (op.kind !== "-") newLine += 1;
  }
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end);
    const oldLength = slice.filter((op) => op.kind !== "+").length;
    const newLength = slice.filter((op) => op.kind !== "-").length;
    out.push(`@@ -${hunkRange(oldBefore[start]!, oldLength)} +${hunkRange(newBefore[start]!, newLength)} @@\n`);
    for (const op of slice) {
      out.push(op.line.endsWith("\n") ? `${op.kind}${op.line}` : `${op.kind}${op.line}\n\\ No newline at end of file\n`);
    }
  }
  return out.join("");
}

function hunkRange(linesBefore: number, length: number): string {
  const start = length === 0 ? linesBefore : linesBefore + 1;
  return length === 1 ? `${start}` : `${start},${length}`;
}

/** Lines with their terminators, so a missing final newline is a difference of its own. */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const middle = myersDiff(middleA, middleB)
    ?? [...middleA.map((line) => ({ kind: "-" as const, line })), ...middleB.map((line) => ({ kind: "+" as const, line }))];
  return [
    ...a.slice(0, start).map((line) => ({ kind: " " as const, line })),
    ...middle,
    ...a.slice(endA).map((line) => ({ kind: " " as const, line }))
  ];
}

/** Myers O((N+M)D) line diff; undefined when the edit distance exceeds MAX_EDIT_DISTANCE. */
function myersDiff(a: readonly string[], b: readonly string[]): DiffOp[] | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ kind: "+", line }));
  if (m === 0) return a.map((line) => ({ kind: "-", line }));
  const limit = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // trace[d] holds v for k in [-d-1, d+1] as it stood before step d.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b);
    }
  }
  return undefined;
}

function backtrack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const snapshot = trace[d]!;
    const at = (k: number) => snapshot[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: " ", line: a[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: "+", line: b[prevY]! });
      else ops.push({ kind: "-", line: a[prevX]! });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** [start, end) op ranges of each hunk: changes plus CONTEXT_LINES of context, merged when close. */
function diffHunks(ops: readonly DiffOp[]): Array<[number, number]> {
  const hunks: Array<[number, number]> = [];
  const isChange = (index: number) => ops[index]!.kind !== " ";
  let index = 0;
  while (index < ops.length) {
    while (index < ops.length && !isChange(index)) index += 1;
    if (index >= ops.length) break;
    const start = Math.max(0, index - CONTEXT_LINES);
    let end = index;
    for (;;) {
      while (end < ops.length && isChange(end)) end += 1;
      let next = end;
      while (next < ops.length && !isChange(next)) next += 1;
      if (next < ops.length && next - end <= 2 * CONTEXT_LINES) {
        end = next;
        continue;
      }
      break;
    }
    const hunkEnd = Math.min(ops.length, end + CONTEXT_LINES);
    hunks.push([start, hunkEnd]);
    index = hunkEnd;
  }
  return hunks;
}
