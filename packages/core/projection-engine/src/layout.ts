import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION, architectureDocsProjectionManifestIssues, isRepoRelativePosixPath, isRuntimeTopologyNodeKind, stableId, type ArchitectureDocsProjectionManifestV3, type Json, type ProjectionTargetV1 } from "@archcontext/contracts";
export { sourceIncludeAnchors as repoHarnessIncludeAnchors } from "./source-globs";

export const REPO_HARNESS_PROJECTION_PROFILE = "repo-harness/v1" as const;
export const ARCHITECTURE_DOCS_LAYOUT_VERSION = "archcontext.docs-layout/v1" as const;
export type ArchitectureProjectionProfile = "default" | typeof REPO_HARNESS_PROJECTION_PROFILE;

export interface ProjectionLayoutNode extends Record<string, Json | undefined> {
  id: string;
  kind: string;
  name: string;
  source?: Json;
  extensions?: Record<string, Json>;
}

export interface ProjectionLayoutRelation extends Record<string, Json> {
  id: string;
}

export interface RepoHarnessNodeProfileV1 {
  schemaVersion: "archcontext.repo-harness-node-profile/v1";
  nodeId: string;
  domain: string;
  name: string;
  modulePath: string;
  contractFiles: { agents: string; claude: string };
  projectionOwnedPaths: string[];
}

export interface ProjectionLayoutTargetDraft {
  targetId: string;
  type: ProjectionTargetV1["type"];
  scope: ProjectionTargetV1["scope"];
  path: string;
  ownership: ProjectionTargetV1["ownership"];
  format: ProjectionTargetV1["format"];
}

export interface ArchitectureDocumentationLayout {
  profile: ArchitectureProjectionProfile;
  targets: ProjectionLayoutTargetDraft[];
  expectedPaths: string[];
  /** Paths a former profile rendered that this one does not; an intact committed file there is removed on apply. */
  retiredTargetPaths: string[];
  orphanRoots: string[];
  entityPathByNodeId: ReadonlyMap<string, string>;
}

const FIXED_TARGETS: ProjectionLayoutTargetDraft[] = [
  layoutTarget("projection_target.architecture.index", "architecture-index", { kind: "repository" }, "docs/architecture/index.md", "mixed", "markdown"),
  layoutTarget("projection_target.decision.index", "decision-index", { kind: "decision" }, "docs/architecture/decisions/index.md", "mixed", "markdown"),
  layoutTarget("projection_target.architecture.changelog", "architecture-changelog", { kind: "changelog" }, "docs/architecture/changelog.md", "mixed", "markdown"),
  layoutTarget("projection_target.diagram.mermaid", "diagram-mermaid", { kind: "diagram", id: "architecture" }, "docs/architecture/diagrams/architecture.mmd", "generated", "mermaid"),
  layoutTarget("projection_target.diagram.structurizr", "diagram-structurizr", { kind: "diagram", id: "architecture" }, "docs/architecture/diagrams/architecture.structurizr.json", "generated", "structurizr-json"),
  layoutTarget("projection_target.diagram.likec4", "diagram-likec4", { kind: "diagram", id: "architecture" }, "docs/architecture/diagrams/architecture.likec4", "generated", "likec4")
];

/**
 * The runtime topology view (ADR-0049). Whole-model, generated targets that the layout includes only
 * when the model has a `process`, `namespace` or `mount` node, so every other model keeps its
 * target set, manifest and index byte-identical.
 */
export const RUNTIME_TOPOLOGY_DIAGRAM_PATH = "docs/architecture/diagrams/runtime-topology.mmd";
export const RUNTIME_TOPOLOGY_SUMMARY_PATH = "docs/architecture/runtime-topology.md";
/** The scope id of both topology targets. It has no `.`, so it never equals a node id. */
export const RUNTIME_TOPOLOGY_SCOPE_ID = "runtime-topology";
const RUNTIME_TOPOLOGY_TARGETS: ProjectionLayoutTargetDraft[] = [
  layoutTarget("projection_target.diagram.runtime-topology", "diagram-runtime-topology", { kind: "diagram", id: RUNTIME_TOPOLOGY_SCOPE_ID }, RUNTIME_TOPOLOGY_DIAGRAM_PATH, "generated", "mermaid"),
  layoutTarget("projection_target.runtime-topology.summary", "runtime-topology-summary", { kind: "diagram", id: RUNTIME_TOPOLOGY_SCOPE_ID }, RUNTIME_TOPOLOGY_SUMMARY_PATH, "generated", "markdown")
];

/** Whether the model has runtime topology data, which is what adds the topology targets to a layout. */
export function hasRuntimeTopologyNodes(nodes: readonly { kind: string }[]): boolean {
  return nodes.some((node) => isRuntimeTopologyNodeKind(node.kind));
}

export function parseRepoHarnessNodeProfile(node: ProjectionLayoutNode): RepoHarnessNodeProfileV1 {
  const match = /^capability\.([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(node.id);
  if (!match || node.kind !== "capability") {
    throw new Error(`repo-harness-profile-node-identity-invalid: ${node.id}`);
  }
  const extensions = record(node.extensions);
  const contractFiles = record(extensions.contractFiles);
  const agents = requiredPath(contractFiles.agents, `${node.id}.extensions.contractFiles.agents`);
  const claude = requiredPath(contractFiles.claude, `${node.id}.extensions.contractFiles.claude`);
  if (!agents.endsWith("AGENTS.md") || (agents !== "AGENTS.md" && !agents.endsWith("/AGENTS.md"))) {
    throw new Error(`repo-harness-profile-contract-file-invalid: ${node.id} (${agents})`);
  }
  if (!claude.endsWith("CLAUDE.md") || (claude !== "CLAUDE.md" && !claude.endsWith("/CLAUDE.md"))) {
    throw new Error(`repo-harness-profile-contract-file-invalid: ${node.id} (${claude})`);
  }
  const modulePath = requiredPath(`docs/architecture/modules/${match[1]}/${match[2]}.md`, `${node.id}.modulePath`);
  return {
    schemaVersion: "archcontext.repo-harness-node-profile/v1",
    nodeId: node.id,
    domain: match[1],
    name: match[2],
    modulePath,
    contractFiles: { agents, claude },
    projectionOwnedPaths: [agents, claude, modulePath].sort()
  };
}

/**
 * The nodes that get an entity-summary target under `profile`. The layout and the source-footprint
 * freshness check both read this one predicate, so freshness never probes a node that has no document.
 */
export function entitySummaryTargetNodes<T extends { kind: string }>(nodes: readonly T[], profile: ArchitectureProjectionProfile): T[] {
  // The repo-harness profile owns one nested document per capability. Child semantic
  // nodes and relations are inputs to the capability's P1/P2 compiler, not additional
  // documentation targets; attempting to parse them as capability identities both
  // rejects valid semantic models and creates an unintended second document set.
  //
  // Runtime topology nodes (process, namespace, mount) get no document of their own: the runtime
  // topology summary covers them (ADR-0049).
  return profile === REPO_HARNESS_PROJECTION_PROFILE
    ? nodes.filter((node) => node.kind === "capability")
    : nodes.filter((node) => !isRuntimeTopologyNodeKind(node.kind));
}

export function resolveArchitectureDocumentationLayout(input: {
  nodes: ProjectionLayoutNode[];
  relations: ProjectionLayoutRelation[];
  profile?: ArchitectureProjectionProfile;
}): ArchitectureDocumentationLayout {
  const profile = input.profile ?? "default";
  const targetNodes = entitySummaryTargetNodes(input.nodes, profile);
  const entityTargets = targetNodes.map((node) => {
    const path = profile === REPO_HARNESS_PROJECTION_PROFILE
      ? parseRepoHarnessNodeProfile(node).modulePath
      : requiredPath(`docs/architecture/modules/${pathSegment(node.id)}.md`, `${node.id}.modulePath`);
    return layoutTarget(
      `projection_target.entity.${stableId(node.id)}`,
      "entity-summary",
      { kind: "entity", id: node.id, entityKind: node.kind },
      path,
      "mixed",
      "markdown"
    );
  });
  const relationTargets = (profile === REPO_HARNESS_PROJECTION_PROFILE ? [] : input.relations).map((relation) => layoutTarget(
    `projection_target.relation.${stableId(relation.id)}`,
    "relation-summary",
    { kind: "relation", id: relation.id },
    `docs/architecture/relations/${pathSegment(relation.id)}.md`,
    "mixed",
    "markdown"
  ));
  const topologyTargets = hasRuntimeTopologyNodes(input.nodes) ? RUNTIME_TOPOLOGY_TARGETS : [];
  // repo-harness/v1 publishes one projection per fact class (repo-harness#1222 D9): the capability
  // documents, the runtime topology pair (its only projection, ADR-0049 §4), and the manifest. The
  // default profile keeps every whole-model view. The retired paths stay listed so an apply can
  // remove the intact global files an earlier repo-harness/v1 manifest recorded.
  const targets = (profile === REPO_HARNESS_PROJECTION_PROFILE
    ? [...entityTargets, ...topologyTargets]
    : [FIXED_TARGETS[0]!, ...entityTargets, ...relationTargets, ...FIXED_TARGETS.slice(1), ...topologyTargets])
    .map((target) => ({ ...target, path: requiredPath(target.path, target.targetId) }));
  assertUniqueTargets(targets);
  return {
    profile,
    targets,
    expectedPaths: [...new Set([...targets.map((target) => target.path), "docs/architecture/.projection-manifest.json"])].sort(),
    retiredTargetPaths: profile === REPO_HARNESS_PROJECTION_PROFILE ? FIXED_TARGETS.map((target) => target.path) : [],
    orphanRoots: ["docs/architecture/modules", "docs/architecture/relations"],
    entityPathByNodeId: new Map(entityTargets.map((target, index) => [targetNodes[index]!.id, target.path]))
  };
}

export function agentContextTargetPaths(nodes: ProjectionLayoutNode[]): { nodeId: string; path: string }[] {
  const targets: { nodeId: string; path: string }[] = [];
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    if (node.kind !== "capability") continue;
    const extensions = record(node.extensions);
    if ("contractFiles" in extensions) {
      const profile = parseRepoHarnessNodeProfile(node);
      targets.push({ nodeId: node.id, path: profile.contractFiles.agents }, { nodeId: node.id, path: profile.contractFiles.claude });
      continue;
    }
    const include = projectionNodeSource(node)?.include?.[0];
    if (!include) continue;
    const directory = primarySourceDirectory(include);
    if (directory === ".") throw new Error(`agent-context-primary-source-dir-is-repository-root: ${node.id}`);
    targets.push(
      { nodeId: node.id, path: `${directory}/AGENTS.md` },
      { nodeId: node.id, path: `${directory}/CLAUDE.md` }
    );
  }
  return targets.sort((left, right) => left.path.localeCompare(right.path) || left.nodeId.localeCompare(right.nodeId));
}

export function contractFilesForNode(node: ProjectionLayoutNode): string[] {
  const extensions = record(node.extensions);
  if ("contractFiles" in extensions) {
    const profile = parseRepoHarnessNodeProfile(node);
    return [profile.contractFiles.agents, profile.contractFiles.claude];
  }
  const localContracts = extensions.localContracts;
  return Array.isArray(localContracts)
    ? localContracts.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
}

export function loadArchitectureFilesForLayout(
  root: string,
  layout: ArchitectureDocumentationLayout
): ProjectionOwnedFile[] {
  const paths = new Set<string>();
  for (const path of layout.expectedPaths) {
    const absolute = resolveSafeRegularPath(root, path, false);
    if (absolute) paths.add(path);
  }
  for (const orphanRoot of layout.orphanRoots) {
    for (const path of recursiveMarkdownPaths(root, orphanRoot)) paths.add(path);
  }
  // A whole-file output carries no marker to scan for, so the committed manifest is what names the
  // generated files a projection wrote. A mixed output does carry a marker, but its committed row is
  // what proves the projection owned the path; a path this layout retired is read back for the same
  // reason. One the current layout no longer renders is an orphan.
  if (paths.has(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH)) {
    const manifest = readProjectionOwnedFile(resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH), ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
    const retired = new Set(layout.retiredTargetPaths);
    for (const output of committedProjectionOutputs(currentFormatManifest(manifest.body))) {
      if (output.ownership !== "generated" && !retired.has(output.path)) continue;
      if (resolveSafeRegularPath(root, output.path, false)) paths.add(output.path);
    }
  }
  return [...paths].sort().map((path) => readProjectionOwnedFile(resolve(root, path), path));
}

/** One `generated` row of the committed projection manifest: the whole file it records as projection output. */
export interface CommittedGeneratedOutput {
  targetId: string;
  path: string;
  /** `digestJson({ targetId, body })` of the body the projection wrote to `path`. */
  outputDigest: string;
}

/** One file a committed manifest row records as projection output, whatever its ownership. */
interface CommittedProjectionOutput extends CommittedGeneratedOutput {
  ownership: ProjectionTargetV1["ownership"];
}

const OUTPUT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * The files the committed projection manifest records under `docs/architecture/`. A generated file
 * carries no ownership marker, so its row is the one record that the file is projection output and
 * of the bytes that were committed there; a mixed file is recorded by its region, and its row is
 * what proves the projection owned that path. A row that names a path outside `docs/architecture/`
 * records nothing. No current-format manifest records nothing either; the render reads and refuses
 * the manifest itself.
 */
function committedProjectionOutputs(manifest: ArchitectureDocsProjectionManifestV3 | undefined): CommittedProjectionOutput[] {
  if (manifest === undefined) return [];
  const outputs: CommittedProjectionOutput[] = [];
  for (const [targetId, row] of Object.entries(manifest.targets)) {
    if (!OUTPUT_DIGEST_PATTERN.test(row.outputDigest) || !isRepoRelativePosixPath(row.path)
      || !row.path.startsWith("docs/architecture/") || row.path === ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH) continue;
    outputs.push({ targetId, path: row.path, ownership: row.ownership, outputDigest: row.outputDigest });
  }
  return outputs;
}

/** The `generated` (whole-file) rows of `committedProjectionOutputs`. */
export function committedGeneratedOutputs(manifest: ArchitectureDocsProjectionManifestV3 | undefined): CommittedGeneratedOutput[] {
  return committedProjectionOutputs(manifest)
    .filter((output) => output.ownership === "generated")
    .map(({ targetId, path, outputDigest }) => ({ targetId, path, outputDigest }));
}

/**
 * The body as a current-format manifest, or undefined when it is not one. Only for listing the
 * files a layout reads; the render parses the manifest strictly and refuses a superseded or
 * invalid one.
 */
function currentFormatManifest(body: string): ArchitectureDocsProjectionManifestV3 | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  if (record?.schemaVersion !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION) return undefined;
  return architectureDocsProjectionManifestIssues(parsed).length === 0 ? parsed as ArchitectureDocsProjectionManifestV3 : undefined;
}

/**
 * A projection-owned file as one read saw it. `body` is the text with CRLF line endings normalized
 * to LF: the renderer only emits LF, so a checkout that applies `core.autocrlf` (Windows runners
 * and developer machines) would otherwise fail every byte comparison against the rendered body.
 * Line endings carry no projection meaning; every other byte, a lone CR included, still compares
 * exactly. `onDisk` is the raw bytes the same read returned: write and delete preconditions
 * (`expectedHash`) hash it, so they bind to exactly what the render classified.
 */
export interface ProjectionOwnedFile {
  path: string;
  body: string;
  onDisk: string;
}

export function readProjectionOwnedFile(absolute: string, path: string): ProjectionOwnedFile {
  const onDisk = readFileSync(absolute, "utf8");
  return { path, body: onDisk.replaceAll("\r\n", "\n"), onDisk };
}

/**
 * The bytes an apply writes for a projection-owned file: the canonical LF body, converted to CRLF
 * when the file on disk already uses CRLF. Re-projecting a `core.autocrlf` checkout then rewrites
 * the bytes Git checked out instead of flipping every file to LF, which Git reports as modified
 * although the normalized content is unchanged. Plans, manifests and digests keep the LF body.
 */
export function projectionOwnedWriteBody(body: string, onDisk: string | undefined): string {
  return onDisk?.includes("\r\n") ? body.replaceAll("\n", "\r\n") : body;
}

export function primarySourceDirectory(pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/");
  const wildcardIndex = normalized.search(/[*?\[\]{}!]/);
  if (wildcardIndex >= 0) {
    const literalPrefix = normalized.slice(0, wildcardIndex);
    if (literalPrefix.endsWith("/")) return literalPrefix.replace(/\/+$/, "") || ".";
    const slash = literalPrefix.lastIndexOf("/");
    return slash < 0 ? "." : literalPrefix.slice(0, slash);
  }
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "." : normalized.slice(0, slash);
}

function recursiveMarkdownPaths(root: string, relativeRoot: string): string[] {
  const absoluteRoot = resolve(root, requiredPath(relativeRoot, "orphanRoot"));
  if (!existsSync(absoluteRoot)) return [];
  assertInsideRoot(root, absoluteRoot, relativeRoot);
  if (lstatSync(absoluteRoot).isSymbolicLink()) throw new Error(`projection-layout-symlink-rejected: ${relativeRoot}`);
  if (!lstatSync(absoluteRoot).isDirectory()) throw new Error(`projection-layout-orphan-root-not-directory: ${relativeRoot}`);
  const found: string[] = [];
  const visit = (absoluteDirectory: string) => {
    for (const entry of readdirSync(absoluteDirectory).sort()) {
      const absolute = resolve(absoluteDirectory, entry);
      const path = relative(root, absolute).replaceAll("\\", "/");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`projection-layout-symlink-rejected: ${path}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile() && path.endsWith(".md")) found.push(requiredPath(path, "orphanCandidate"));
    }
  };
  visit(absoluteRoot);
  return found;
}

function resolveSafeRegularPath(root: string, path: string, required: boolean): string | undefined {
  const safe = requiredPath(path, "expectedPath");
  const absolute = resolve(root, safe);
  assertInsideRoot(root, absolute, safe);
  if (!existsSync(absolute)) {
    if (required) throw new Error(`projection-layout-path-missing: ${safe}`);
    return undefined;
  }
  assertNoSymlinkSegments(root, safe);
  const stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error(`projection-layout-expected-file-not-regular: ${safe}`);
  return absolute;
}

function assertNoSymlinkSegments(root: string, path: string): void {
  let current = resolve(root);
  for (const segment of path.split("/")) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`projection-layout-symlink-rejected: ${path}`);
  }
}

function assertInsideRoot(root: string, absolute: string, label: string): void {
  const path = relative(resolve(root), resolve(absolute)).replaceAll("\\", "/");
  if (path === ".." || path.startsWith("../")) throw new Error(`projection-layout-path-escapes-repository: ${label}`);
}

function assertUniqueTargets(targets: ProjectionLayoutTargetDraft[]): void {
  for (const [label, values] of [
    ["path", targets.map((target) => target.path)],
    ["targetId", targets.map((target) => target.targetId)]
  ] as const) {
    const duplicate = values.find((value, index) => values.indexOf(value) !== index);
    if (duplicate) throw new Error(`projection-layout-${label}-collision: ${duplicate}`);
  }
}

function requiredPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !isRepoRelativePosixPath(value) || value === "." || value.endsWith("/")) {
    throw new Error(`projection-layout-path-invalid: ${label} (${String(value)})`);
  }
  return value;
}

function layoutTarget(
  targetId: string,
  type: ProjectionTargetV1["type"],
  scope: ProjectionTargetV1["scope"],
  path: string,
  ownership: ProjectionTargetV1["ownership"],
  format: ProjectionTargetV1["format"]
): ProjectionLayoutTargetDraft {
  return { targetId, type, scope, path, ownership, format };
}

function record(value: unknown): Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
}

function projectionNodeSource(node: ProjectionLayoutNode): { include?: string[]; exclude?: string[] } | undefined {
  const source = record(node.source);
  const strings = (value: Json | undefined) => Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    include: strings(source.include),
    exclude: strings(source.exclude)
  };
}

function pathSegment(id: string): string {
  return stableId(id).replace(/^[-.]+|[-.]+$/g, "") || "architecture";
}
