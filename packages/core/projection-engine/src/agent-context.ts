import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_CONTEXT_RENDERER_VERSION as CONTRACT_AGENT_CONTEXT_RENDERER_VERSION,
  PROJECTION_TARGET_SCHEMA_VERSION,
  digestJson,
  type Json,
  type ProjectionMixedTargetV1
} from "@archcontext/contracts";
import { assertRepoRelativePath, nativeNodeSource, type NativeModel, type NativeNode } from "@archcontext/core/architecture-domain";
import { assertPathHasNoSymlinkSegments } from "@archcontext/core/changeset-engine";
import {
  agentContextTargetId,
  agentContextTargetPaths,
  committedAgentContextOutputs,
  contractFilesForNode,
  primarySourceDirectory,
  readProjectionOwnedFile,
  type ProjectionOwnedFile
} from "./layout";
import { generatedMarkerAttributes, scanDocumentRegions } from "./document-regions";
import type { ArchitectureDocumentationExistingFile } from "./docs-types";

// --- Agent Context Provider (ADR-0043, ADR-0056 §9) ---
//
// Projects one capability node's identity/source/extensions into a marker-owned region of each
// contract file the node designates (CLAUDE.md and AGENTS.md). This one renderer serves the
// repo-harness/v1 projection, the root-contract canonical check and `archctx agent-context`.

export const AGENT_CONTEXT_RENDERER_VERSION = CONTRACT_AGENT_CONTEXT_RENDERER_VERSION;
export const AGENT_CONTEXT_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT AGENT CONTEXT";
export const AGENT_CONTEXT_END_PREFIX = "<!-- END ARCHCONTEXT AGENT CONTEXT";

export interface AgentContextProjectionTargetScope {
  kind: "entity";
  id: string;
  entityKind: string;
}

export interface AgentContextProjectionTarget extends ProjectionMixedTargetV1 {
  type: "agent-context";
  scope: AgentContextProjectionTargetScope;
  format: "markdown";
}

export interface AgentContextProjectionFile {
  path: string;
  body: string;
  targets: AgentContextProjectionTarget[];
}

export interface AgentContextProjectionPlan {
  schemaVersion: "archcontext.agent-context-projection-plan/v1";
  rendererVersion: typeof AGENT_CONTEXT_RENDERER_VERSION;
  targets: AgentContextProjectionTarget[];
  files: AgentContextProjectionFile[];
}

/**
 * Directory root of a `source.include` glob (ADR-0043): the literal prefix before the
 * first wildcard, with any trailing partial path segment dropped. A literal entry with no
 * wildcard is treated as an entrypoint file and resolves to its containing directory.
 */
export function primarySourceDirectoryFromInclude(pattern: string): string {
  assertRepoRelativePath(pattern);
  return primarySourceDirectory(pattern);
}

/** One file the agent-context projection writes, and the capability node that owns it. */
export interface AgentContextProjectionTargetPath {
  nodeId: string;
  primarySourceDir: string;
  path: string;
}

/**
 * The exact set of repo paths the agent-context projection is allowed to write, derived from the
 * model alone. This is the single derivation: `renderAgentContextProjection` consumes it, the
 * ChangeSet write scope is built from it, and `projectionOwnedPaths` folds it in — so the write
 * allowlist and the renderer can never drift apart.
 *
 * A capability whose primary source directory resolves to the repository root is rejected rather
 * than inferred. Explicit contractFiles may designate existing root contracts; ChangeSetEngine
 * requires exact preimage hashes and canonical marker-only content for those writes. This is the
 * `default` derivation, so it keeps the root contracts the `repo-harness/v1` layout skips.
 */
export function agentContextProjectionTargetPaths(model: NativeModel): AgentContextProjectionTargetPath[] {
  return agentContextTargetPaths(model.nodes, "default").map(({ nodeId, path }) => {
    const slash = path.lastIndexOf("/");
    return { nodeId, path, primarySourceDir: slash < 0 ? "." : path.slice(0, slash) };
  });
}

/** Reads back whatever already exists at the derived agent-context target paths. */
export function loadAgentContextProjectionFiles(root: string, model: NativeModel): ProjectionOwnedFile[] {
  const paths = [...new Set(agentContextProjectionTargetPaths(model).map((target) => target.path))]
    .sort((left, right) => left.localeCompare(right));
  return paths
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => readProjectionOwnedFile(assertPathHasNoSymlinkSegments(root, path), path));
}

export function renderAgentContextProjection(input: {
  model: NativeModel;
  existingFiles?: ArchitectureDocumentationExistingFile[];
  rendererVersion?: typeof AGENT_CONTEXT_RENDERER_VERSION;
}): AgentContextProjectionPlan {
  const rendererVersion = input.rendererVersion ?? AGENT_CONTEXT_RENDERER_VERSION;
  const existingByPath = new Map((input.existingFiles ?? []).map((file) => [file.path, file.body]));
  const targets: AgentContextProjectionTarget[] = [];
  const targetsByPath = new Map<string, AgentContextProjectionTarget[]>();
  const bodyByPath = new Map<string, string>();
  const nodesById = new Map(input.model.nodes.map((node) => [node.id, node]));
  const derivedByNodeId = new Map<string, AgentContextProjectionTargetPath[]>();
  for (const derived of agentContextProjectionTargetPaths(input.model)) {
    derivedByNodeId.set(derived.nodeId, [...(derivedByNodeId.get(derived.nodeId) ?? []), derived]);
  }

  for (const [nodeId, derivedPaths] of derivedByNodeId) {
    const node = nodesById.get(nodeId)!;
    const generatedBody = renderAgentContextBody(node);
    // The region reads only its node's model facts, so its body digest is both the marker's and
    // the manifest row's `outputDigest`, and the target's runtime source digest.
    const outputDigest = digestJson({ id: node.id, body: generatedBody } as unknown as Json);

    for (const { path } of derivedPaths) {
      const target: AgentContextProjectionTarget = {
        schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
        targetId: agentContextTargetId(path, node.id),
        type: "agent-context",
        scope: { kind: "entity", id: node.id, entityKind: node.kind },
        path,
        ownership: "mixed",
        generatedRegion: {
          startMarker: agentContextStartMarker(node.id, rendererVersion, outputDigest),
          endMarker: agentContextEndMarker(node.id)
        },
        rendererVersion,
        format: "markdown",
        sourceDigest: outputDigest,
        outputDigest
      };
      const wrapped = wrapAgentContextRegion(target, generatedBody);
      const body = mergeAgentContextRegion(target, wrapped, bodyByPath.get(path) ?? existingByPath.get(path));
      targets.push(target);
      targetsByPath.set(path, [...(targetsByPath.get(path) ?? []), target]);
      bodyByPath.set(path, body);
    }
  }

  const files = [...bodyByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, body]) => ({ path, body, targets: targetsByPath.get(path) ?? [] }));

  return {
    schemaVersion: "archcontext.agent-context-projection-plan/v1",
    rendererVersion,
    targets,
    files
  };
}

function renderAgentContextBody(node: NativeNode): string {
  const source = nativeNodeSource(node);
  const extensions = node.extensions;
  const lspProfile = extensions?.lspProfile;
  const verification = extensions?.verification;
  const lines = [
    `# Agent Context: ${node.name}`,
    "",
    `- id: \`${node.id}\``,
    `- kind: \`${node.kind}\``,
    ...(node.summary ? [`- summary: ${node.summary}`] : []),
    ...(source?.include?.length ? [`- source.include: ${source.include.map((entry) => `\`${entry}\``).join(", ")}`] : []),
    ...(source?.exclude?.length ? [`- source.exclude: ${source.exclude.map((entry) => `\`${entry}\``).join(", ")}`] : []),
    ...(typeof lspProfile === "string" ? [`- extensions.lspProfile: \`${lspProfile}\``] : []),
    ...(Array.isArray(verification) && verification.length > 0
      ? [`- extensions.verification: ${verification.map((entry) => `\`${String(entry)}\``).join(", ")}`]
      : []),
    ...(extensions ? [`- extensions digest: ${digestJson(extensions as Json)}`] : [])
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The marker names the node, the renderer and the digest of the region body; no model-wide digest
 * enters it, so a model edit that leaves the body unchanged leaves the file byte-identical.
 */
function agentContextStartMarker(nodeId: string, rendererVersion: string, outputDigest: string): string {
  return `${AGENT_CONTEXT_BEGIN_PREFIX} id="${nodeId}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
}

function agentContextEndMarker(nodeId: string): string {
  return `${AGENT_CONTEXT_END_PREFIX} id="${nodeId}" -->`;
}

function wrapAgentContextRegion(target: AgentContextProjectionTarget, generatedBody: string): string {
  return [target.generatedRegion.startMarker, generatedBody.trimEnd(), target.generatedRegion.endMarker, ""].join("\n");
}

function mergeAgentContextRegion(target: AgentContextProjectionTarget, wrapped: string, existing?: string): string {
  if (!existing) return wrapped;
  const region = findAgentContextRegion(existing, target.scope.id);
  if (!region) {
    if (target.path === "AGENTS.md" || target.path === "CLAUDE.md") {
      return `${existing}${existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n"}${wrapped}`;
    }
    return `${existing.trimEnd()}\n\n${wrapped}`;
  }
  // A hand-edited region is drift the projection reports and rewrites, not an error.
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

/**
 * The comparison form of an agent-context target file's human text: the file with each marker-owned
 * region of `nodeIds` replaced by a fixed placeholder naming its node, through the same region parser
 * the projection writes with. Keeping the placeholder means moving a human line from one side of a
 * region to the other changes the result. A missing, duplicate, overlapping or malformed region
 * throws, so a caller can never compare text it could not delimit.
 */
export function agentContextTextOutsideRegions(body: string, nodeIds: readonly string[]): string {
  let text = body;
  for (const nodeId of [...new Set(nodeIds)].sort()) {
    const region = findAgentContextRegion(text, nodeId);
    if (!region) throw new Error(`agent-context-marker-missing: ${nodeId}`);
    text = `${text.slice(0, region.start)}\u0000archcontext-agent-context-region:${nodeId}\u0000${text.slice(region.end)}`;
  }
  return text;
}

/** The digest of a region's body as its marker records it: `digestJson({ id, body })`. */
export function agentContextRegionBodyDigest(body: string, region: { contentStart: number; contentEnd: number }, nodeId: string): string {
  return digestJson({ id: nodeId, body: `${body.slice(region.contentStart, region.contentEnd).trimEnd()}\n` } as unknown as Json);
}

interface AgentContextRegion {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  startMarker: string;
  outputDigest: string;
}

const AGENT_CONTEXT_MARKER_ATTRIBUTES = new Set(["id", "sourceDigest", "rendererVersion", "outputDigest"]);

/**
 * The one agent-context marker parser: lookup, merge, drift and the human-text comparison all read
 * regions through it. The whole file is parsed before any one node's region is used: each BEGIN
 * carries `id`, `rendererVersion` and a SHA-256 `outputDigest` in any order (a v1 marker may also
 * carry `sourceDigest`, so it reads as stale) and is closed by the END of that id before the next
 * marker, and no id has two regions. A stray, id-less, unpaired, incomplete or overlapping marker of
 * any node fails closed instead of reading as a missing region or surviving a rewrite.
 */
function parseAgentContextRegions(body: string): Map<string, AgentContextRegion> {
  const marker = /<!-- (BEGIN|END) ARCHCONTEXT AGENT CONTEXT/g;
  const regions = new Map<string, AgentContextRegion>();
  let open: { id: string; start: number; contentStart: number; startMarker: string; outputDigest: string } | undefined;
  for (let match = marker.exec(body); match !== null; match = marker.exec(body)) {
    const rest = body.slice(match.index);
    if (match[1] === "BEGIN") {
      const begin = agentContextBeginMarker(rest);
      if (open !== undefined) throw new Error(`agent-context-marker-overlap: ${open.id}`);
      if (regions.has(begin.id)) throw new Error(`agent-context-marker-duplicate: ${begin.id}`);
      const afterMarker = match.index + begin.marker.length;
      open = { id: begin.id, start: match.index, contentStart: afterMarker + (body[afterMarker] === "\n" ? 1 : 0), startMarker: begin.marker, outputDigest: begin.outputDigest };
    } else {
      const end = /^<!-- END ARCHCONTEXT AGENT CONTEXT id="([^"]+)" -->/.exec(rest);
      if (end === null || open === undefined || end[1] !== open.id) throw new Error(`agent-context-marker-malformed: ${end?.[1] ?? "an END marker names no id"}`);
      const markerEnd = match.index + end[0].length;
      regions.set(open.id, {
        start: open.start,
        end: markerEnd + (body[markerEnd] === "\n" ? 1 : 0),
        contentStart: open.contentStart,
        contentEnd: match.index,
        startMarker: open.startMarker,
        outputDigest: open.outputDigest
      });
      open = undefined;
    }
  }
  if (open !== undefined) throw new Error(`agent-context-marker-malformed: ${open.id}`);
  return regions;
}

/** The BEGIN marker at the start of `text`; throws unless its required attributes are present, well-formed and named once. */
function agentContextBeginMarker(text: string): { id: string; marker: string; outputDigest: string } {
  const marker = /^<!-- BEGIN ARCHCONTEXT AGENT CONTEXT((?: [A-Za-z]+="[^"]*")*) -->/.exec(text);
  const entries = [...(marker?.[1] ?? "").matchAll(/ ([A-Za-z]+)="([^"]*)"/g)].map((entry) => [entry[1]!, entry[2]!] as const);
  const attributes = new Map(entries);
  const id = attributes.get("id");
  const outputDigest = attributes.get("outputDigest") ?? "";
  if (marker === null || attributes.size !== entries.length || !id || !attributes.get("rendererVersion") || !/^sha256:[a-f0-9]{64}$/.test(outputDigest)
    || [...attributes.keys()].some((key) => !AGENT_CONTEXT_MARKER_ATTRIBUTES.has(key))) {
    throw new Error(`agent-context-marker-malformed: ${id ?? "a BEGIN marker names no id"}`);
  }
  return { id, marker: marker[0], outputDigest };
}

export function findAgentContextRegion(body: string, nodeId: string): AgentContextRegion | undefined {
  return parseAgentContextRegions(body).get(nodeId);
}
