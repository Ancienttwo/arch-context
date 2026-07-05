import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { digestJson, stableYaml, type Json, type ModelStorePort, type WorkspaceRef } from "@archcontext/contracts";

export interface ModelFile {
  path: string;
  schemaVersion: string;
  digest: string;
  body: string;
}

export const ARCHCONTEXT_DIR = ".archcontext";

export function createDefaultManifest(productId: string, productName: string): Json {
  return {
    schemaVersion: "archcontext.manifest/v1",
    codeFacts: { provider: "codegraph", mode: "embedded", required: true },
    content: {
      decisions: ".archcontext/decisions",
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
    review: {
      failOn: ["invalid-schema", "prohibited-dependency", "unjustified-compatibility", "stale-context", "incomplete-intervention"]
    },
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
        id: "projection_rule.architecture.changelog",
        targetType: "architecture-changelog",
        scope: { kind: "changelog" },
        pathTemplate: "docs/architecture/changelog.md",
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

export function initializeArchContextModel(root: string, productName = "ArchContext Project"): void {
  const productId = `product.${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app"}`;
  writeYaml(root, ".archcontext/manifest.yaml", createDefaultManifest(productId, productName));
  writeYaml(root, ".archcontext/product.yaml", {
    schemaVersion: "archcontext.product/v1",
    id: productId,
    name: productName,
    purpose: "Capture product intent for architecture-aware agent work.",
    users: [{ id: "developer", description: "Developer using an agentic coding runtime." }],
    capabilities: ["architecture-context"],
    successCriteria: ["Agent tasks bind to architecture context before completion."],
    nonGoals: [],
    riskDomains: []
  });
  writeYaml(root, ".archcontext/model/nodes/capability.architecture-context.yaml", {
    schemaVersion: "archcontext.node/v1",
    id: "capability.architecture-context",
    kind: "capability",
    name: "Architecture Context",
    status: "active",
    summary: "Keeps product and architecture intent available to coding agents."
  });
  writeYaml(root, ".archcontext/policies/review.yaml", {
    schemaVersion: "archcontext.policy/v1",
    id: "policy.review",
    failOn: ["invalid-schema", "stale-context", "unjustified-compatibility"]
  });
  writeFile(root, ".archcontext/projections/targets.json", `${JSON.stringify(createDefaultProjectionTargetManifest(), null, 2)}\n`);
  rebuildGeneratedProjection(root);
}

export function rebuildGeneratedProjection(root: string): void {
  rmSync(resolve(root, ".archcontext/generated"), { recursive: true, force: true });
  writeFile(root, ".archcontext/generated/ARCHITECTURE.md", [
    "<!-- Generated by ArchContext. Do not edit by hand. -->",
    "",
    "# Architecture",
    "",
    "Model projection is generated from `.archcontext/model`.",
    ""
  ].join("\n"));
}

export class YamlModelStore implements ModelStorePort {
  async loadManifest(workspace: WorkspaceRef): Promise<unknown> {
    return readFileSync(resolve(workspace.root, ".archcontext/manifest.yaml"), "utf8");
  }

  async loadModel(workspace: WorkspaceRef): Promise<ModelFile[]> {
    return listModelFiles(workspace.root);
  }

  async validateModel(workspace: WorkspaceRef): Promise<{ valid: boolean; errors: string[]; modelDigest: string }> {
    const errors: string[] = [];
    for (const required of [".archcontext/manifest.yaml", ".archcontext/product.yaml"]) {
      try {
        readFileSync(resolve(workspace.root, required), "utf8");
      } catch {
        errors.push(`missing ${required}`);
      }
    }
    const files = listModelFiles(workspace.root);
    for (const file of files) {
      if (!file.schemaVersion.startsWith("archcontext.")) errors.push(`${file.path}: missing schemaVersion`);
    }
    const modelDigest = digestJson(files.map((file) => ({ path: file.path, digest: file.digest })));
    return { valid: errors.length === 0, errors, modelDigest };
  }

  async writeChangeSetPreview(changeSet: unknown): Promise<{ digest: string; summary: string }> {
    return { digest: digestJson(changeSet as Json), summary: "ChangeSet preview generated" };
  }
}

export function listModelFiles(root: string): ModelFile[] {
  const paths = collectArchContextFiles(root, [
    ".archcontext/manifest.yaml",
    ".archcontext/product.yaml",
    ".archcontext/model",
    ".archcontext/decisions",
    ".archcontext/policies",
    ".archcontext/practices",
    ".archcontext/projections",
    ".archcontext/generated",
    "docs/adr"
  ]);
  return paths.map((path) => {
    const body = readFileSync(resolve(root, path), "utf8");
    return {
      path,
      body,
      schemaVersion: extractSchemaVersion(body),
      digest: digestJson({ path, body })
    };
  });
}

function collectArchContextFiles(root: string, entries: string[]): string[] {
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(root, entry);
    if (!existsSync(absolute)) continue;
    const stat = readdirOrFile(absolute);
    if (stat === "file") {
      files.push(entry);
      continue;
    }
    for (const child of walk(entry)) files.push(child);
  }
  return [...new Set(files)].sort();

  function walk(relativeDir: string): string[] {
    const out: string[] = [];
    const dir = resolve(root, relativeDir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(child));
      if (entry.isFile() && /\.(ya?ml|md)$/.test(entry.name) && isCollectableModelFile(child)) out.push(child);
    }
    return out;
  }
}

function isCollectableModelFile(path: string): boolean {
  if (path.startsWith("docs/adr/")) return /^docs\/adr\/ADR-\d{4}-.+\.md$/.test(path);
  return true;
}

function readdirOrFile(path: string): "directory" | "file" {
  try {
    readdirSync(path);
    return "directory";
  } catch {
    return "file";
  }
}

function extractSchemaVersion(body: string): string {
  const match = body.match(/schemaVersion:\s*"?([^"\n]+)"?/);
  if (match) return match[1].trim();
  try {
    const parsed = JSON.parse(body) as { schemaVersion?: unknown };
    if (typeof parsed.schemaVersion === "string") return parsed.schemaVersion;
  } catch {
    // JSON-compatible YAML is optional; plain YAML remains supported above.
  }
  if (body.includes("Generated by ArchContext")) return "archcontext.generated/v1";
  return "";
}

function writeYaml(root: string, path: string, value: Json): void {
  writeFile(root, path, stableYaml(value));
}

function writeFile(root: string, path: string, body: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
