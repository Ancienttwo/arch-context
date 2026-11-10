import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StateMachineAnchor, StateMachineCodeSource, StateMachineV1 } from "@archcontext/contracts";
import { matchingDeclarations, sourceContentDigest, splitSymbol } from "@archcontext/core/projection-engine";
import { openCodeGraphSymbolReader, type CodeGraphSymbolDeclaration, type CodeGraphSymbolReaderResult } from "@archcontext/local-runtime/codegraph-adapter";

export interface StateMachineAnchorScope {
  /** The Git-visible files of this invocation. */
  readonly files: ReadonlySet<string>;
  /** When present, only the anchors whose path is in this set are evaluated. */
  readonly paths?: ReadonlySet<string>;
}

interface AnchorFile {
  /** The source footprint digest of the file. */
  digest: string;
  /** CRLF read as LF. */
  content: string;
  declarations?: CodeGraphSymbolDeclaration[] | undefined;
  parsed: boolean;
}

/**
 * The status of every `code` source of a region or an event of each machine, aligned with
 * `machines`. Each file is read and parsed at most once, and the CodeGraph symbol reader is opened
 * at most once, only when an anchor in scope names a symbol. Nothing here writes a digest.
 */
export function stateMachineAnchors(root: string, machines: readonly StateMachineV1[], scope: StateMachineAnchorScope): StateMachineAnchor[][] {
  const anchors = machines.map((machine) => codeAnchors(machine).filter((anchor) => scope.paths === undefined || scope.paths.has(anchor.source.path)));
  let opened: CodeGraphSymbolReaderResult | undefined;
  try {
    if (anchors.some((entries) => entries.some((anchor) => anchor.source.symbol !== undefined && scope.files.has(anchor.source.path)))) {
      opened = openCodeGraphSymbolReader(root);
    }
    const files = new Map<string, AnchorFile>();
    const fileAt = (path: string): AnchorFile => {
      let file = files.get(path);
      if (file === undefined) {
        // One read feeds both the file digest and the parser, so every anchor on a file describes the same bytes.
        const bytes = readFileSync(resolve(root, path));
        file = { digest: sourceContentDigest(bytes), content: bytes.toString("utf8").replace(/\r\n/g, "\n"), parsed: false };
        files.set(path, file);
      }
      return file;
    };
    return anchors.map((entries) => entries.map(({ owner, ownerId, source }): StateMachineAnchor => {
      const base = { owner, ownerId, path: source.path, ...(source.symbol === undefined ? {} : { symbol: source.symbol }) };
      const measured = (digest: string): StateMachineAnchor => ({ ...base,
        status: source.confirmedDigest === undefined ? "anchor-unconfirmed" : source.confirmedDigest === digest ? "confirmed" : "anchor-changed", digest });
      if (!scope.files.has(source.path)) return { ...base, status: "anchor-missing-path" };
      const file = fileAt(source.path);
      if (source.symbol === undefined) return measured(file.digest);
      if (opened!.availability === "unavailable") return { ...base, status: "unchecked", reason: opened!.reasonCode };
      const reader = opened!.reader;
      if (!file.parsed) {
        file.declarations = reader.supportsPath(source.path) ? reader.declarationsInSource(source.path, file.content) : undefined;
        file.parsed = true;
      }
      if (file.declarations === undefined) return { ...base, status: "anchor-language-unsupported" };
      const { name, container } = splitSymbol(source.symbol);
      const matches = matchingDeclarations(file.declarations.filter((declaration) => declaration.name === name), container);
      if (matches.length === 0) return { ...base, status: "anchor-missing-symbol" };
      if (matches.length > 1) return { ...base, status: "anchor-ambiguous-symbol" };
      const [declaration] = matches;
      return measured(sha256(Buffer.from(file.content.split("\n").slice(declaration!.startLine - 1, declaration!.endLine).join("\n"), "utf8")));
    }));
  } finally {
    if (opened?.availability === "ready") opened.reader.close();
  }
}

function codeAnchors(machine: StateMachineV1): { owner: "region" | "event"; ownerId: string; source: StateMachineCodeSource }[] {
  return [
    ...machine.regions.flatMap((region) => region.source ? [{ owner: "region" as const, ownerId: region.id, source: region.source }] : []),
    ...machine.events.flatMap((event) => event.source.kind === "code" ? [{ owner: "event" as const, ownerId: event.id, source: event.source }] : [])
  ];
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
