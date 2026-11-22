import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Json } from "@archcontext/contracts";

export function parseJsonOrStableYaml(body: string, path: string): Json {
  const trimmed = body.trim();
  if (!trimmed) throw new Error(`${path}: empty model file`);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return checkedJsonOrFlowYaml(trimmed, path, "json-document");
  return new StableYamlParser(body, path).parse();
}

export function isJsonRecord(value: Json | undefined): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function nonEmptyStrings(value: Json | undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((entry) => typeof entry === "string" && entry.length > 0) ? value as string[] : undefined;
}

export function stripYamlComment(value: string): string {
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === "\"") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(value[index - 1]!))) return value.slice(0, index);
  }
  return value;
}

export function yamlBareId(raw: string): string | undefined {
  let value = stripYamlComment(raw).trim();
  const quote = value[0];
  if ((quote === "'" || quote === "\"") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value)) return undefined;
  return value;
}

export function assertObject(value: Json, path: string): asserts value is { [key: string]: Json } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
}

class StableYamlParser {
  private readonly lines: { indent: number; text: string }[];
  private index = 0;
  private readonly mappingKeys = new WeakMap<object, Set<string>>();

  constructor(body: string, private readonly path: string) {
    this.lines = body
      .split(/\r?\n/)
      .map((line) => ({ indent: line.match(/^ */)?.[0].length ?? 0, text: line.trimEnd() }))
      .filter((line) => line.text.trim().length > 0);
  }

  parse(): Json {
    const value = this.parseBlock(this.lines[0]?.indent ?? 0);
    if (this.index !== this.lines.length) throw new Error(`${this.path}: unexpected trailing YAML`);
    return value;
  }

  private parseBlock(indent: number): Json {
    const current = this.lines[this.index];
    if (!current || current.indent < indent) return {};
    if (current.indent !== indent) throw new Error(`${this.path}: invalid indentation`);
    return current.text.trimStart().startsWith("- ") ? this.parseArray(indent) : this.parseObject(indent);
  }

  private parseArray(indent: number): Json[] {
    const values: Json[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!line || line.indent !== indent || !line.text.trimStart().startsWith("- ")) break;
      const item = line.text.trimStart().slice(2).trim();
      this.index += 1;
      if (!item) {
        values.push(this.parseBlock(indent + 2));
        continue;
      }
      if (this.isKeyValue(item)) {
        values.push(this.parseObject(indent + 2, item));
        continue;
      }
      values.push(parseScalar(item, this.path));
    }
    return values;
  }

  private parseObject(indent: number, firstEntry?: string): Json {
    const object: Record<string, Json> = {};
    if (firstEntry) this.assignEntry(object, firstEntry, indent);
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!line || line.indent !== indent || line.text.trimStart().startsWith("- ")) break;
      this.index += 1;
      this.assignEntry(object, line.text.trimStart(), indent);
    }
    return object;
  }

  private assignEntry(object: Record<string, Json>, entry: string, indent: number): void {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error(`${this.path}: expected key/value entry`);
    const key = entry.slice(0, separator).trim();
    const keys = this.mappingKeys.get(object) ?? new Set<string>();
    if (keys.has(key)) throw new DuplicateModelKeyError(this.path, "yaml-mapping", key, this.index);
    keys.add(key);
    this.mappingKeys.set(object, keys);
    const rest = entry.slice(separator + 1).trim();
    object[key] = rest ? parseScalar(rest, this.path) : this.parseNestedValue(indent);
  }

  private isKeyValue(value: string): boolean {
    return /^[A-Za-z0-9_-]+:/.test(value);
  }

  private parseNestedValue(parentIndent: number): Json {
    const next = this.lines[this.index];
    if (next && next.indent <= parentIndent && (next.text.trim() === "[]" || next.text.trim() === "{}")) {
      this.index += 1;
      return parseScalar(next.text.trim(), this.path);
    }
    return this.parseBlock(parentIndent + 2);
  }
}

function parseScalar(value: string, path: string): Json {
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true" || value === "false" || value === "null") return JSON.parse(value) as Json;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (/^["[{]/.test(value)) return checkedJsonOrFlowYaml(value, path, "json-scalar");
  return value;
}

/** Duplicate keys are rejected before a decoder can discard object members. */
export class DuplicateModelKeyError extends Error {
  constructor(readonly path: string, readonly branch: "yaml-mapping" | "yaml-flow" | "json-document" | "json-scalar", readonly key: string, readonly offset: number) {
    super(`${path}: duplicate object key (${branch})`);
    this.name = "DuplicateModelKeyError";
  }
}

function checkedJsonOrFlowYaml(source: string, path: string, branch: "json-document" | "json-scalar"): Json {
  try { return checkedJsonDecode(source, path, branch); }
  catch (error) {
    if (!(error instanceof SyntaxError) || !(source.startsWith("{") || source.startsWith("["))) throw error;
  }
  return checkedFlowYamlDecode(source, path);
}

function checkedFlowYamlDecode(source: string, path: string): Json {
  // Keep duplicate members in the AST so JSON key coercion cannot hide a collision.
  const document = parseDocument(source, { version: "1.2", schema: "core", uniqueKeys: false, prettyErrors: false });
  const invalid = (reason: string): never => { throw new SyntaxError(`${path}: invalid YAML flow collection (${reason})`); };
  if (document.errors.length || document.warnings.length) invalid("parse error or warning");
  if ((!isMap(document.contents) && !isSeq(document.contents)) || !document.contents.flow) invalid("expected flow collection");

  const decode = (node: unknown): Json => {
    if (node === null) return null;
    if (!isScalar(node) && !isMap(node) && !isSeq(node)) return invalid("unsupported node or alias");
    if (node.anchor || node.tag) return invalid("anchor or explicit tag");
    if (isScalar(node)) {
      const value: unknown = node.value;
      if (value === null || typeof value === "string" || typeof value === "boolean") return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return invalid("non-JSON scalar");
    }
    if (isSeq(node)) return node.items.map(decode);
    const keys = new Set<string>();
    return Object.fromEntries(node.items.map(pair => {
      if (!isScalar(pair.key)) return invalid("non-scalar key");
      const key = String(decode(pair.key));
      if (keys.has(key)) throw new DuplicateModelKeyError(path, "yaml-flow", key, pair.key.range![0]);
      keys.add(key);
      return [key, decode(pair.value)];
    }));
  };
  return decode(document.contents);
}

function checkedJsonDecode(source: string, path: string, branch: "json-document" | "json-scalar"): Json {
  let offset = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? "") && offset < source.length) offset += 1; };
  const invalid = (): never => { throw new SyntaxError(`${path}: invalid JSON`); };
  const string = (): string => {
    const start = offset;
    if (source[offset++] !== '"') invalid();
    while (offset < source.length) {
      const char = source[offset++];
      if (char === "\\") { offset += 1; continue; }
      if (char === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    return invalid();
  };
  const value = (): void => {
    whitespace();
    if (source[offset] === '"') { string(); return; }
    if (source[offset] === "{") {
      offset += 1; whitespace();
      const keys = new Set<string>();
      if (source[offset] === "}") { offset += 1; return; }
      while (offset < source.length) {
        whitespace(); const keyOffset = offset; const key = string();
        if (keys.has(key)) throw new DuplicateModelKeyError(path, branch, key, keyOffset);
        keys.add(key); whitespace();
        if (source[offset++] !== ":") invalid();
        value(); whitespace();
        const end = source[offset++];
        if (end === "}") return;
        if (end !== ",") invalid();
      }
      invalid();
    }
    if (source[offset] === "[") {
      offset += 1; whitespace();
      if (source[offset] === "]") { offset += 1; return; }
      while (offset < source.length) {
        value(); whitespace(); const end = source[offset++];
        if (end === "]") return;
        if (end !== ",") invalid();
      }
      invalid();
    }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset));
    if (!primitive) invalid();
    offset += primitive![0].length;
  };
  value(); whitespace();
  if (offset !== source.length) invalid();
  return JSON.parse(source) as Json;
}
