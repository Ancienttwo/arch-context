import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isRepoRelativePosixPath, stableId, type Json, type ProjectionTargetV1 } from "@archcontext/contracts";

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
  orphanRoots: string[];
  entityPathByNodeId: ReadonlyMap<string, string>;
}

export interface ArchitectureDocumentationExistingFileLike {
  path: string;
  body: string;
}

const FIXED_TARGETS: ProjectionLayoutTargetDraft[] = [
  layoutTarget("projection_target.architecture.index", "architecture-index", { kind: "repository" }, "docs/architecture/index.md", "mixed", "markdown"),
  layoutTarget("projection_target.decision.index", "decision-index", { kind: "decision" }, "docs/architecture/decisions/index.md", "mixed", "markdown"),
  layoutTarget("projection_target.architecture.changelog", "architecture-changelog", { kind: "changelog" }, "docs/architecture/changelog.md", "mixed", "markdown"),
  layoutTarget("projection_target.diagram.mermaid", "diagram-mermaid", { kind: "diagram", id: "architecture" }, "docs/architecture/diagrams/architecture.mmd", "generated", "mermaid"),
  layoutTarget("projection_target.diagram.structurizr", "diagram-structurizr", { kind: "diagram", id: "architecture" }, "docs/architecture/diagrams/architecture.structurizr.json", "generated", "structurizr-json"),
  layoutTarget("projection_target.diagram.likec4", "diagram-likec4", { kind: "diagram", id: "architecture" }, "docs/architecture/diagrams/architecture.likec4", "generated", "likec4")
];

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

export function resolveArchitectureDocumentationLayout(input: {
  nodes: ProjectionLayoutNode[];
  relations: ProjectionLayoutRelation[];
  profile?: ArchitectureProjectionProfile;
}): ArchitectureDocumentationLayout {
  const profile = input.profile ?? "default";
  const entityTargets = input.nodes.map((node) => {
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
  const relationTargets = input.relations.map((relation) => layoutTarget(
    `projection_target.relation.${stableId(relation.id)}`,
    "relation-summary",
    { kind: "relation", id: relation.id },
    `docs/architecture/relations/${pathSegment(relation.id)}.md`,
    "mixed",
    "markdown"
  ));
  const targets = [FIXED_TARGETS[0]!, ...entityTargets, ...relationTargets, ...FIXED_TARGETS.slice(1)]
    .map((target) => ({ ...target, path: requiredPath(target.path, target.targetId) }));
  assertUniqueTargets(targets);
  return {
    profile,
    targets,
    expectedPaths: [...new Set([...targets.map((target) => target.path), "docs/architecture/.projection-manifest.json"])].sort(),
    orphanRoots: ["docs/architecture/modules", "docs/architecture/relations"],
    entityPathByNodeId: new Map(entityTargets.map((target, index) => [input.nodes[index]!.id, target.path]))
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
): ArchitectureDocumentationExistingFileLike[] {
  const paths = new Set<string>();
  for (const path of layout.expectedPaths) {
    const absolute = resolveSafeRegularPath(root, path, false);
    if (absolute) paths.add(path);
  }
  for (const orphanRoot of layout.orphanRoots) {
    for (const path of recursiveMarkdownPaths(root, orphanRoot)) paths.add(path);
  }
  return [...paths].sort().map((path) => ({ path, body: readFileSync(resolve(root, path), "utf8") }));
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

function projectionNodeSource(node: ProjectionLayoutNode): { include?: string[]; exclude?: string[]; entrypoints?: string[] } | undefined {
  const source = record(node.source);
  const strings = (value: Json | undefined) => Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    include: strings(source.include),
    exclude: strings(source.exclude),
    entrypoints: strings(source.entrypoints)
  };
}

function pathSegment(id: string): string {
  return stableId(id).replace(/^[-.]+|[-.]+$/g, "") || "architecture";
}
