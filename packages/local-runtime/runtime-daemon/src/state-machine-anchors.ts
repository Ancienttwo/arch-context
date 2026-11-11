import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StateMachineAnchor, StateMachineCodeSource, StateMachineV1 } from "@archcontext/contracts";
import { matchingDeclarations, sourceContentDigest, splitSymbol } from "@archcontext/core/projection-engine";
import { openCodeGraphSymbolReader, type CodeGraphIndexedDeclaration, type CodeGraphSymbolReaderResult } from "@archcontext/local-runtime/codegraph-adapter";

export interface StateMachineAnchorScope {
  /** The Git-visible files of this invocation. */
  readonly files: ReadonlySet<string>;
  /**
   * When present, only the anchors on these paths, or with a callee on them, are evaluated. A
   * symbol anchor whose callees cannot be read from the index is evaluated as `unchecked`.
   */
  readonly paths?: ReadonlySet<string>;
}

interface AnchorFile {
  bytes: Buffer;
  /** The source footprint digest of the file. */
  digest: string;
  /** CRLF read as LF. */
  lines: string[];
}

interface CodeAnchor {
  owner: "region" | "event";
  ownerId: string;
  source: StateMachineCodeSource;
}

/** Edge targets that carry behaviour. Types, interfaces, classes and modules are not callees (ADR-0054 §7). */
const CALLEE_KINDS: ReadonlySet<string> = new Set(["function", "method", "property", "constant", "variable"]);

/**
 * The status of every `code` source of a region or an event of each machine, aligned with
 * `machines`. A symbol anchor covers its declaration and its direct callees, all read from the
 * CodeGraph index, which is opened read-only at most once and never synced. Each file is read at
 * most once. Nothing here writes a digest.
 */
export function stateMachineAnchors(root: string, machines: readonly StateMachineV1[], scope: StateMachineAnchorScope): StateMachineAnchor[][] {
  const anchors = machines.map(codeAnchors);
  const symbolAnchors = anchors.flat().filter((anchor) => anchor.source.symbol !== undefined && scope.files.has(anchor.source.path));
  let opened: CodeGraphSymbolReaderResult | undefined;
  try {
    if (symbolAnchors.length > 0) opened = openCodeGraphSymbolReader(root);
    const reader = opened?.availability === "ready" ? opened.reader : undefined;
    const files = new Map<string, AnchorFile>();
    const fileAt = (path: string): AnchorFile => {
      let file = files.get(path);
      if (file === undefined) {
        // One read feeds the file digest, the index freshness test and the hashed lines.
        const bytes = readFileSync(resolve(root, path));
        file = { bytes, digest: sourceContentDigest(bytes), lines: bytes.toString("utf8").replace(/\r\n/g, "\n").split("\n") };
        files.set(path, file);
      }
      return file;
    };
    const indexed = new Map<string, CodeGraphIndexedDeclaration[] | undefined>();
    const indexedAt = (path: string): CodeGraphIndexedDeclaration[] | undefined => {
      if (!indexed.has(path)) indexed.set(path, reader!.indexedDeclarations(path, fileAt(path).bytes));
      return indexed.get(path);
    };

    // Every symbol anchor resolves first, so that one batched edge read covers them all and a
    // changed path can select an anchor through its callees.
    const outcome = new Map<CodeAnchor, Pick<StateMachineAnchor, "status" | "reason">>();
    const declarations = new Map<CodeAnchor, CodeGraphIndexedDeclaration>();
    for (const anchor of reader === undefined ? [] : symbolAnchors) {
      const { path, symbol } = anchor.source;
      if (!reader!.supportsPath(path)) { outcome.set(anchor, { status: "anchor-language-unsupported" }); continue; }
      const held = indexedAt(path);
      if (held === undefined) { outcome.set(anchor, { status: "unchecked", reason: "index-stale" }); continue; }
      const { name, container } = splitSymbol(symbol!);
      const matches = held.filter((declaration) => declaration.name === name && matchingDeclarations([declaration], container).length > 0);
      if (matches.length !== 1) { outcome.set(anchor, { status: matches.length === 0 ? "anchor-missing-symbol" : "anchor-ambiguous-symbol" }); continue; }
      declarations.set(anchor, matches[0]!);
    }
    const edges = reader === undefined || declarations.size === 0 ? new Map<string, CodeGraphIndexedDeclaration[]>()
      : reader.callees([...new Set([...declarations.values()].map((declaration) => declaration.id))]);
    const callees = new Map([...declarations].map(([anchor, declaration]) => [anchor, (edges.get(declaration.id) ?? [])
      .filter((target) => CALLEE_KINDS.has(target.kind) && scope.files.has(target.path) && !within(target, declaration))
      .sort(digestOrder)]));

    const symbolAnchorSet = new Set(symbolAnchors);
    const selected = (anchor: CodeAnchor): boolean => {
      if (scope.paths === undefined || scope.paths.has(anchor.source.path)) return true;
      if (!symbolAnchorSet.has(anchor)) return false;
      // Without the index, or with a stale anchor file, the callees are unknown: fail closed.
      if (reader === undefined || outcome.get(anchor)?.reason === "index-stale") return true;
      return callees.get(anchor)?.some((callee) => scope.paths!.has(callee.path)) ?? false;
    };

    return anchors.map((entries) => entries.filter(selected).map((anchor): StateMachineAnchor => {
      const { owner, ownerId, source } = anchor;
      const base = { owner, ownerId, path: source.path, ...(source.symbol === undefined ? {} : { symbol: source.symbol }) };
      const status = (digest: string) => source.confirmedDigest === undefined ? "anchor-unconfirmed" as const
        : source.confirmedDigest === digest ? "confirmed" as const : "anchor-changed" as const;
      if (!scope.files.has(source.path)) return { ...base, status: "anchor-missing-path" };
      if (source.symbol === undefined) {
        const digest = fileAt(source.path).digest;
        return { ...base, status: status(digest), digest };
      }
      if (opened!.availability === "unavailable") return { ...base, status: "unchecked", reason: opened!.reasonCode };
      const settled = outcome.get(anchor);
      if (settled !== undefined) return { ...base, ...settled };
      const covered = callees.get(anchor)!;
      if (covered.some((callee) => indexedAt(callee.path) === undefined)) return { ...base, status: "unchecked", reason: "index-stale" };
      const declaration = declarations.get(anchor)!;
      const texts = [declaration, ...covered].map((entry) => fileAt(entry.path).lines.slice(entry.startLine - 1, entry.endLine).join("\n"));
      const digest = sha256(Buffer.from(JSON.stringify(texts), "utf8"));
      return { ...base, status: status(digest), digest, callees: covered.map((callee) => ({ path: callee.path, qualifiedName: callee.qualifiedName })) };
    }));
  } finally {
    if (opened?.availability === "ready") opened.reader.close();
  }
}

function codeAnchors(machine: StateMachineV1): CodeAnchor[] {
  return [
    ...machine.regions.flatMap((region) => region.source ? [{ owner: "region" as const, ownerId: region.id, source: region.source }] : []),
    ...machine.events.flatMap((event) => event.source.kind === "code" ? [{ owner: "event" as const, ownerId: event.id, source: event.source }] : [])
  ];
}

function within(target: CodeGraphIndexedDeclaration, declaration: CodeGraphIndexedDeclaration): boolean {
  return target.path === declaration.path && target.startLine >= declaration.startLine && target.endLine <= declaration.endLine;
}

/** Identity only sets the order of the hashed texts: path, qualified name, kind, start line. */
function digestOrder(left: CodeGraphIndexedDeclaration, right: CodeGraphIndexedDeclaration): number {
  for (const key of ["path", "qualifiedName", "kind"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return left.startLine - right.startLine;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
