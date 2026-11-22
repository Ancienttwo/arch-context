import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { REVIEW_FAIL_ON_CATEGORIES, stableYaml, type Json } from "@archcontext/contracts";
import { assertPathHasNoSymlinkSegments } from "@archcontext/core/changeset-engine";
import { writeFileWithoutFollowingSymlinks } from "@archcontext/local-runtime/descriptor-write";
import { rebuildGeneratedProjection, withTrailingNewline } from "./generated-projection";

export { planGeneratedProjection, rebuildGeneratedProjection, type GeneratedProjectionOperation } from "./generated-projection";

export interface InitializeArchContextOptions {
  infer?: boolean;
  modelOnly?: boolean;
  noHooks?: boolean;
  noSkills?: boolean;
  noInstructions?: boolean;
}

export function createDefaultManifest(productId: string, productName: string, options: InitializeArchContextOptions = {}): Json {
  const disableInstructions = options.modelOnly === true || options.noInstructions === true;
  return {
    schemaVersion: "archcontext.manifest/v1",
    codeFacts: { provider: "codegraph", mode: "embedded", required: true },
    content: {
      decisions: "docs/adr",
      generated: ".archcontext/generated",
      policies: ".archcontext/policies",
      practices: ".archcontext/practices",
      projections: ".archcontext/projections"
    },
    generated: { commitToGit: true, formats: ["markdown", "mermaid"] },
    model: { layout: "split", root: ".archcontext/model" },
    privacy: {
      cloudContentUpload: "deny",
      localTunnel: { includeSourceByDefault: false, maxResultBytes: 8192 }
    },
    product: { governanceLevel: "auto", id: productId, name: productName },
    ...(disableInstructions ? { projection: { instructions: false } } : {}),
    runtime: { checkpoint: { changedFileThreshold: 20, requiredBeforeComplete: true }, contextBudgetBytes: 12288 }
  };
}

export function createDefaultProjectionTargetManifest(): Json {
  return {
    schemaVersion: "archcontext.projection-target-manifest/v1",
    rendererVersion: "archcontext.docs-renderer/v1",
    ownership: {
      humanAuthoredRegions: "preserve",
      generatedRegions: "replace-by-marker",
      ambiguousOwnership: "reject"
    },
    placementRules: [
      {
        id: "projection_rule.architecture.index",
        targetType: "architecture-index",
        scope: { kind: "repository" },
        pathTemplate: "docs/architecture/index.md",
        ownership: "mixed",
        format: "markdown"
      },
      {
        id: "projection_rule.entity.summary",
        targetType: "entity-summary",
        scope: { kind: "entity", entityKind: "*" },
        pathTemplate: "docs/architecture/modules/{stableId}.md",
        ownership: "mixed",
        format: "markdown"
      },
      {
        id: "projection_rule.relation.summary",
        targetType: "relation-summary",
        scope: { kind: "relation" },
        pathTemplate: "docs/architecture/relations/{stableId}.md",
        ownership: "mixed",
        format: "markdown"
      },
      {
        id: "projection_rule.decision.index",
        targetType: "decision-index",
        scope: { kind: "decision" },
        pathTemplate: "docs/architecture/decisions/index.md",
        ownership: "mixed",
        format: "markdown"
      },
      {
        id: "projection_rule.diagram.mermaid",
        targetType: "diagram-mermaid",
        scope: { kind: "diagram", id: "architecture" },
        pathTemplate: "docs/architecture/diagrams/architecture.mmd",
        ownership: "generated",
        format: "mermaid"
      },
      {
        id: "projection_rule.diagram.structurizr",
        targetType: "diagram-structurizr",
        scope: { kind: "diagram", id: "architecture" },
        pathTemplate: "docs/architecture/diagrams/architecture.structurizr.json",
        ownership: "generated",
        format: "structurizr-json"
      },
      {
        id: "projection_rule.diagram.likec4",
        targetType: "diagram-likec4",
        scope: { kind: "diagram", id: "architecture" },
        pathTemplate: "docs/architecture/diagrams/architecture.likec4",
        ownership: "generated",
        format: "likec4"
      },
      // The runtime topology targets exist only while the model has process, namespace or mount nodes (ADR-0049).
      {
        id: "projection_rule.diagram.runtime-topology",
        targetType: "diagram-runtime-topology",
        scope: { kind: "diagram", id: "runtime-topology" },
        pathTemplate: "docs/architecture/diagrams/runtime-topology.mmd",
        ownership: "generated",
        format: "mermaid"
      },
      {
        id: "projection_rule.runtime-topology.summary",
        targetType: "runtime-topology-summary",
        scope: { kind: "diagram", id: "runtime-topology" },
        pathTemplate: "docs/architecture/runtime-topology.md",
        ownership: "generated",
        format: "markdown"
      },
      {
        id: "projection_rule.agent-context.claude",
        targetType: "agent-context",
        scope: { kind: "entity", entityKind: "capability" },
        pathTemplate: "{primarySourceDir}/CLAUDE.md",
        ownership: "mixed",
        format: "markdown"
      },
      {
        id: "projection_rule.agent-context.agents",
        targetType: "agent-context",
        scope: { kind: "entity", entityKind: "capability" },
        pathTemplate: "{primarySourceDir}/AGENTS.md",
        ownership: "mixed",
        format: "markdown"
      }
    ]
  };
}

/** Raised instead of writing when `init` would replace or complete an existing model (#167). */
export class ArchContextInitRefusedError extends Error {
  constructor(readonly existingPaths: string[]) {
    super(`archcontext-init-refused: .archcontext is already initialized or partially initialized (${existingPaths.join(", ")}); init never overwrites an existing model — change it through a ChangeSet, or remove these files deliberately before re-initializing`);
    this.name = "ArchContextInitRefusedError";
  }
}

/**
 * Creates the initial model. The files it writes are authoritative, so it is create-only: if any
 * of them already exists — even as a dangling symlink — nothing is written; each file is created
 * atomically without following symlinks in any path segment; and a failure part-way removes the
 * files this call created, so a failed init never leaves a silently half-initialized model.
 */
export function initializeArchContextModel(
  root: string,
  productName = "ArchContext Project",
  options: InitializeArchContextOptions = {}
): { inferredNodeIds: string[]; instructionsProjection: boolean } {
  const productId = `product.${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app"}`;
  const files: Array<{ path: string; body: string }> = [];
  const addYaml = (path: string, value: Json) => files.push({ path, body: stableYaml(value) });
  const inferred = options.infer === true ? inferInitialCapabilities(root) : [];
  const capabilitySlugs = inferred.length > 0 ? inferred.map((entry) => entry.slug) : ["architecture-context"];
  addYaml(".archcontext/manifest.yaml", createDefaultManifest(productId, productName, options));
  addYaml(".archcontext/product.yaml", {
    schemaVersion: "archcontext.product/v1",
    id: productId,
    name: productName,
    purpose: "Capture product intent for architecture-aware agent work.",
    users: [{ id: "developer", description: "Developer using an agentic coding runtime." }],
    capabilities: capabilitySlugs,
    successCriteria: ["Agent tasks bind to architecture context before completion."],
    nonGoals: [],
    riskDomains: []
  });
  if (inferred.length > 0) {
    for (const entry of inferred) {
      addYaml(`.archcontext/model/nodes/${entry.nodeId}.yaml`, {
        schemaVersion: "archcontext.node/v2",
        id: entry.nodeId,
        kind: "capability",
        name: entry.displayName,
        status: "active",
        summary: `Inferred capability boundary for ${entry.dir}.`,
        source: { include: [`${entry.dir}/**`] },
        extensions: {
          contractFiles: {
            agents: `${entry.dir}/AGENTS.md`,
            claude: `${entry.dir}/CLAUDE.md`
          }
        }
      });
    }
  } else {
    addYaml(".archcontext/model/nodes/capability.architecture.context.yaml", {
      schemaVersion: "archcontext.node/v2",
      id: "capability.architecture.context",
      kind: "capability",
      name: "Architecture Context",
      status: "active",
      summary: "Keeps product and architecture intent available to coding agents."
    });
  }
  addYaml(".archcontext/policies/review.yaml", {
    schemaVersion: "archcontext.policy/v1",
    id: "policy.review",
    failOn: [...REVIEW_FAIL_ON_CATEGORIES]
  });
  files.push({ path: ".archcontext/projections/targets.json", body: `${JSON.stringify(createDefaultProjectionTargetManifest(), null, 2)}\n` });

  // The repository root is the trusted containment boundary (it may itself be reached through a
  // symlink); only paths below it are checked. Creating it keeps init usable on a fresh directory.
  mkdirSync(root, { recursive: true });
  const existing = files.filter((file) => {
    assertPathHasNoSymlinkSegments(root, file.path);
    return lstatIfExists(resolve(root, file.path)) !== undefined;
  }).map((file) => file.path);
  if (existing.length > 0) throw new ArchContextInitRefusedError(existing);

  const created: string[] = [];
  try {
    for (const file of files) {
      writeFileWithoutFollowingSymlinks({ root, path: file.path, body: withTrailingNewline(file.body), expectedHash: "missing" });
      created.push(file.path);
    }
    // Part of the same all-or-nothing step: a failed rebuild must not leave an initialized model
    // behind that would refuse every retry.
    rebuildGeneratedProjection(root);
    return {
      inferredNodeIds: inferred.map((entry) => entry.nodeId),
      instructionsProjection: !(options.modelOnly === true || options.noInstructions === true)
    };
  } catch (error) {
    for (const path of created.reverse()) rmSync(resolve(root, path), { force: true });
    throw error;
  }
}

const IGNORED_INFER_DIRS = new Set([".git", ".archcontext", ".codegraph", ".claude", ".codex", "node_modules", "dist", "build", "coverage", "test", "tests", "__tests__"]);

interface InferredCapabilityEntry {
  dir: string;
  nodeId: string;
  slug: string;
  displayName: string;
}

function inferInitialCapabilities(root: string): InferredCapabilityEntry[] {
  const dirs = discoverCandidateDirs(root);
  const usedIds = new Set<string>();
  const entries: InferredCapabilityEntry[] = [];
  for (const dir of dirs) {
    const segments = dir
      .split("/")
      .map((segment) => {
        const clean = segment.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        return clean && /^[a-z0-9]/.test(clean) ? clean : clean ? `x${clean}` : "module";
      });
    const domain = segments.length === 1 ? "workspace" : segments[0]!;
    const baseName = segments.length === 1
      ? segments[0]!
      : segments.length === 2
        ? segments[1]!
        : segments.slice(1).join("-");
    let nodeId = `capability.${domain}.${baseName}`;
    let suffix = 2;
    while (usedIds.has(nodeId)) {
      nodeId = `capability.${domain}.${baseName}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(nodeId);
    const slug = nodeId.slice("capability.".length).replace(/\./g, "-");
    const displayName = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" / ");
    entries.push({ dir, nodeId, slug, displayName });
  }
  return entries;
}

function discoverCandidateDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const discovered = new Set<string>();
  const pkgPath = resolve(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces && typeof pkg.workspaces === "object" && Array.isArray((pkg.workspaces as { packages?: unknown }).packages)
          ? (pkg.workspaces as { packages: unknown[] }).packages
          : [];
      for (const raw of patterns) {
        if (typeof raw !== "string") continue;
        const clean = raw.replace(/\/\*+$/, "").replace(/^\/+|\/+$/g, "");
        if (!clean || clean.includes("*")) continue;
        const abs = resolve(root, clean);
        if (!existsSync(abs)) continue;
        if (raw.endsWith("/*") || raw.endsWith("/**")) {
          for (const entry of readdirSync(abs, { withFileTypes: true })) {
            if (entry.isDirectory() && !IGNORED_INFER_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
              discovered.add(`${clean}/${entry.name}`);
            }
          }
        } else if (lstatIfExists(abs)?.isDirectory()) {
          discovered.add(clean);
        }
      }
    } catch {
      // Ignore malformed package.json during optional inference.
    }
  }
  if (discovered.size === 0) {
    for (const container of ["packages", "apps", "services", "libs"]) {
      const abs = resolve(root, container);
      if (!existsSync(abs)) continue;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory() && !IGNORED_INFER_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          discovered.add(`${container}/${entry.name}`);
        }
      }
    }
  }
  if (discovered.size === 0) {
    const srcAbs = resolve(root, "src");
    if (existsSync(srcAbs)) {
      for (const entry of readdirSync(srcAbs, { withFileTypes: true })) {
        if (entry.isDirectory() && !IGNORED_INFER_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          discovered.add(`src/${entry.name}`);
        }
      }
    }
  }
  return [...discovered].sort().slice(0, 32);
}

function lstatIfExists(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}
