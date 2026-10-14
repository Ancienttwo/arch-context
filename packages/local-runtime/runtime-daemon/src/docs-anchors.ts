import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docsAnchorsReportIssues, okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import {
  checkProseAnchors,
  loadArchitectureFilesForLayout,
  loadCapabilitySourceFootprints,
  loadNativeModelFromArchContext,
  modelSelectorIds,
  resolveArchitectureDocumentationLayout,
  type ArchitectureProjectionProfile,
  type NativeModel,
  type ProseAnchorCodeGraph,
  type ProseAnchorSymbols,
  type ProseAnchorTree
} from "@archcontext/core/projection-engine";
import { openCodeGraphSymbolReader, type CodeGraphSymbolDeclaration, type CodeGraphSymbolReader } from "@archcontext/local-runtime/codegraph-adapter";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { committedArchitectureDocsProfile, projectionFailureEnvelope } from "./projection-service";

/** Caller-owned discovery from this invocation only; never retained between reads. */
export interface DocsAnchorsReadInputs {
  readonly model: NativeModel;
  readonly files: readonly string[];
}

/**
 * `archctx docs anchors` (#298): checks the citations in human-owned module document regions and
 * node prose. It runs in-process, before any runtime client exists: it starts no daemon, opens no
 * local store and writes no runtime state. Without `profile` it uses the committed manifest
 * profile, like the other `docs` commands. Findings are a signal; the envelope stays `ok`.
 */
export function runDocsAnchorsCommand(cwd: string, options: { profile?: ArchitectureProjectionProfile } = {}, inputs?: DocsAnchorsReadInputs): JsonEnvelope {
  let opened: ReturnType<typeof openCodeGraphSymbolReader> | undefined;
  try {
    const root = findRepositoryRoot(cwd);
    const profile = options.profile ?? committedArchitectureDocsProfile(root);
    const model = inputs?.model ?? loadNativeModelFromArchContext(root);
    const layout = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile });
    const documents = new Map(loadArchitectureFilesForLayout(root, layout).map((file) => [file.path, file.body]));
    const files = inputs?.files ?? listGitVisibleFiles(root);
    const footprints = new Map(loadCapabilitySourceFootprints(root, model, files).map((footprint) => [footprint.nodeId, footprint.files]));
    const contents = fileContentReader(root);
    const tree = gitVisibleTree(root, files, contents);
    opened = openCodeGraphSymbolReader(root);
    const codeGraph: ProseAnchorCodeGraph = opened.availability === "ready"
      ? { availability: "ready", symbols: proseAnchorSymbols(opened.reader, files, contents) }
      : { availability: "unavailable", reasonCode: opened.reasonCode };
    const report = checkProseAnchors({
      profile,
      selectorIds: modelSelectorIds(model),
      codeGraph,
      tree,
      nodes: model.nodes.map((node) => {
        const documentPath = layout.entityPathByNodeId.get(node.id);
        const body = documentPath === undefined ? undefined : documents.get(documentPath);
        const responsibilities = Array.isArray(node.responsibilities)
          ? node.responsibilities.filter((entry): entry is string => typeof entry === "string")
          : undefined;
        return {
          nodeId: node.id,
          ...(typeof node.summary === "string" ? { summary: node.summary } : {}),
          ...(responsibilities ? { responsibilities } : {}),
          ...(footprints.has(node.id) ? { footprint: footprints.get(node.id)! } : {}),
          ...(documentPath !== undefined && body !== undefined ? { document: { path: documentPath, body } } : {})
        };
      })
    });
    const issues = docsAnchorsReportIssues(report);
    if (issues.length > 0) throw new Error(`docs-anchors-report-invalid: ${issues.join("; ")}`);
    return okEnvelope("docs.anchors", report as unknown as Json);
  } catch (error) {
    return projectionFailureEnvelope("docs.anchors", error);
  } finally {
    if (opened?.availability === "ready") opened.reader.close();
  }
}

/** File contents with CRLF normalized to LF, read once per path. */
function fileContentReader(root: string): (path: string) => string {
  const cache = new Map<string, string>();
  return (path) => {
    let content = cache.get(path);
    if (content === undefined) {
      content = readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
      cache.set(path, content);
    }
    return content;
  };
}

function gitVisibleTree(root: string, files: readonly string[], contents: (path: string) => string): ProseAnchorTree {
  const fileSet = new Set(files);
  const directories = new Set<string>();
  const topLevel = new Set<string>();
  const ignored = new Map<string, boolean>();
  for (const file of files) {
    const segments = file.split("/");
    topLevel.add(segments[0]!);
    for (let index = 1; index < segments.length; index += 1) directories.add(segments.slice(0, index).join("/"));
  }
  return {
    kind: (path) => fileSet.has(path) ? "file" : directories.has(path) ? "directory" : undefined,
    hasTopLevelEntry: (segment) => topLevel.has(segment),
    filesEndingWith: (suffix) => files.filter((file) => file === suffix || file.endsWith(`/${suffix}`)),
    lineCount: (path) => {
      const content = contents(path);
      if (content === "") return 0;
      return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    },
    isIgnored: (path) => {
      let found = ignored.get(path);
      if (found === undefined) {
        // Exit status 0 means one of the paths is ignored; the trailing slash matches directory patterns.
        found = spawnSync("git", ["check-ignore", "--", path, `${path}/`], { cwd: root, stdio: "ignore" }).status === 0;
        ignored.set(path, found);
      }
      return found;
    }
  };
}

/**
 * Files never searched by `appearsInSource`: the model itself holds the node prose, so a cited name
 * always appears there.
 */
const SOURCE_SEARCH_EXCLUDED_PREFIXES = [".archcontext/"];

function proseAnchorSymbols(reader: CodeGraphSymbolReader, files: readonly string[], contents: (path: string) => string): ProseAnchorSymbols {
  const sourceFiles = files.filter((file) => !SOURCE_SEARCH_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)) && reader.supportsPath(file));
  const appears = new Map<string, boolean>();
  const parsed = new Map<string, CodeGraphSymbolDeclaration[] | undefined>();
  const declarationsIn = (path: string) => {
    if (!parsed.has(path)) parsed.set(path, reader.supportsPath(path) ? reader.declarationsInSource(path, contents(path)) : undefined);
    return parsed.get(path);
  };
  return {
    // A file CodeGraph cannot parse is unsupported, so its symbol checks are unchecked, not missing.
    supportsPath: (path) => declarationsIn(path) !== undefined,
    declarationsInFile: (path, name) => (declarationsIn(path) ?? []).filter((declaration) => declaration.name === name),
    declarationsNamed: (name) => reader.declarationsNamed(name),
    appearsInSource: (name) => {
      let found = appears.get(name);
      if (found === undefined) {
        const word = new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[$]/g, "\\$")}(?![A-Za-z0-9_$])`);
        found = sourceFiles.some((file) => word.test(contents(file)));
        appears.set(name, found);
      }
      return found;
    }
  };
}
