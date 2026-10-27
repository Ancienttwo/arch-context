import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { isRepoRelativePosixPath, REF_IMPACT_LIMITS, type NativeContextModel, type NativeContextSnapshot } from "@archcontext/contracts";
import { nativeNodeSource, type NativeNode } from "@archcontext/core/projection-engine";
import { decodeUtf8, readGitBlobs, readGitBlobTree } from "../../git-adapter/src/blob-reader";
import type { RefImpactFacts } from "../../model-store-yaml/src/ref-impact";
import { withExistingCodeGraphSnapshot } from "./index";
type Sdk = typeof import("@colbymchenry/codegraph");
type SnapshotGraph = Pick<ReturnType<Sdk["CodeGraph"]["openSync"]>, "getFiles" | "getNodesByName">;
const nonDeclarations = new Set(["file", "import", "export", "parameter"]);
const requireFromAdapter = createRequire(import.meta.url);

/** Both refs are compared against one provider-authenticated private snapshot; no original DB open. */
export function readRefImpactFacts(root: string, base: { model: NativeContextModel; snapshot: NativeContextSnapshot }, head: { model: NativeContextModel; snapshot: NativeContextSnapshot }): { baseFacts?: RefImpactFacts; headFacts?: RefImpactFacts } {
  try {
    return withExistingCodeGraphSnapshot(root, graph => {
      const bind = (input: typeof head) => input.snapshot.source === "ref"
        ? bindSnapshotRefImpactFacts(root, input.model, input.snapshot, graph) : undefined;
      return { baseFacts: bind(base), headFacts: bind(head) };
    });
  } catch (error) {
    console.error("DIAG SNAPSHOT ERROR", error);
    return {};
  }
}

/**
 * Called only inside withExistingCodeGraphSnapshot's authenticated ready callback.
 * Every indexed file must match an immutable
 * blob, not just the current HEAD label. CodeGraph 1.6.2 stores SHA-256 of UTF-8 source text;
 * strict UTF-8 and the 1 MiB extraction ceiling exclude replacement decoding and oversize stamps.
 * A supported, error-free indexed file permits an authoritative exact-name no-match.
 * That means the selector does not resolve in CodeGraph, not that no runtime code can exist.
 * Missing files, unsupported languages and ambiguous declarations remain unknown.
 */
function bindSnapshotRefImpactFacts(
  root: string, model: NativeContextModel, ref: { commitSha: string; treeOid: string }, graph: SnapshotGraph
): RefImpactFacts | undefined {
  try {
    const files = graph.getFiles();
    const sdk = requireFromAdapter("@colbymchenry/codegraph") as Sdk;
    const supportedPaths = new Set(files.filter(file => sdk.isLanguageSupported(file.language)).map(file => file.path));
    if (files.length > REF_IMPACT_LIMITS.codeFactFiles) { console.error("DIAG FILE LIMIT", files.length); return undefined; }
    const tree = new Map(readGitBlobTree(root, ref.treeOid, { sizes: true, trees: false }).map(entry => [entry.path, entry]));
    const entries = files.map(file => tree.get(file.path));
    let bytes = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!, entry = entries[i];
      if (!isRepoRelativePosixPath(file.path) || (file.errors?.length ?? 0) > 0
        || !entry || !entry.utf8Valid || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)
        || entry.byteLength === null || entry.byteLength > 1024 * 1024
        || (bytes += entry.byteLength) > REF_IMPACT_LIMITS.codeFactBytes) { console.error("DIAG ENTRY", JSON.stringify({path:file.path, errors:file.errors, entry, bytes, ref})); return undefined; }
    }
    const blobs = readGitBlobs(root, entries.map(entry => entry!));
    const lineCounts = new Map<string, number>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!, body = blobs[i]!;
      // decodeUtf8 preserves BOMs, matching the producer's readFile(..., 'utf8').
      const content = decodeUtf8(body);
      if (createHash("sha256").update(content).digest("hex") !== file.contentHash) { console.error("DIAG HASH", JSON.stringify({path:file.path, actual:createHash("sha256").update(content).digest("hex"), indexed:file.contentHash, ref})); return undefined; }
      lineCounts.set(file.path, content.split("\n").length);
    }
    const selectors: RefImpactFacts["selectors"] = [];
    const declarations = (path: string, name: string) => graph.getNodesByName(name)
      .filter(node => node.filePath.replaceAll("\\", "/") === path && node.name === name && !nonDeclarations.has(node.kind));
    for (const node of model.nodes) for (const entry of nativeNodeSource(node as unknown as NativeNode)?.entrypoints ?? []) {
      for (const source of entry.symbols) for (const sink of source.sinks) {
        if (selectors.length >= REF_IMPACT_LIMITS.flowSteps) return undefined;
        const identity = { entrypointId: entry.id, sourceSymbol: source.name, sinkId: sink.id };
        const ranges: Array<{ path: string; startLine: number; endLine: number }> = [];
        let unknown = false;
        let unresolved = false;
        for (const [path, name] of [[entry.path, source.name], [sink.path, sink.symbol]] as const) {
          if (!lineCounts.has(path) || !supportedPaths.has(path)) { unknown = true; continue; }
          const found = declarations(path, name);
          // SDK getNodesByName enumerates ALL exact matches; it is not a capped search.
          if (found.length === 0) { unresolved = true; continue; }
          const symbol = found.length === 1 ? found[0] : undefined;
          if (!symbol || !Number.isSafeInteger(symbol.startLine) || !Number.isSafeInteger(symbol.endLine)
            || symbol.startLine < 1 || symbol.endLine < symbol.startLine || symbol.endLine > lineCounts.get(path)!) { unknown = true; continue; }
          ranges.push({ path, startLine: symbol.startLine, endLine: symbol.endLine });
        }
        selectors.push(unknown ? { ...identity, status: "unknown" }
          : unresolved ? { ...identity, status: "unresolved" } : { ...identity, status: "resolved", ranges });
      }
    }
    return { ...ref, selectors };
  } catch (error) {
    console.error("DIAG BINDER ERROR", error);
    // Optional code facts cannot turn an unavailable producer into a negative impact claim.
    return undefined;
  }
}
