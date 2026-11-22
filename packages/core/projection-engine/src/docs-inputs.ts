import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION,
  architectureDocsProjectionManifestSchemaVersion,
  digestJson,
  isSupersededArchitectureDocsProjectionManifestSchemaVersion,
  type ArchitectureFlowSelectorCheckV1,
  type Json
} from "@archcontext/contracts";
import { nativeNodeSource, parseJsonOrStableYaml, parseArchitectureDecisionRecord, type NativeModel } from "@archcontext/core/architecture-domain";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  loadArchitectureFilesForLayout,
  resolveArchitectureDocumentationLayout,
  type ArchitectureProjectionProfile,
  type ProjectionOwnedFile
} from "./layout";
import { checkSemanticFlowSelectors, type ArchitectureSelectorEvidenceV1, type SemanticArchitectureNode } from "./semantic-diagrams";
import {
  ARCHITECTURE_DOCS_LANGUAGES,
  type ArchitectureDecisionRecord,
  type ArchitectureDocsLanguage
} from "./docs-types";
import { normalizeNativeModel } from "./exports-dsl";
import { ProjectionManifestUpgradeRequiredError } from "./freshness";
import { loadNativeModelFromArchContext } from "./model-loader";

/** `rebaselineSupersededManifest`: only `docs apply`, which re-baselines a superseded manifest (ADR-0057 Decision 3). */
export function loadArchitectureDocumentationInputs(
  root: string,
  profile: ArchitectureProjectionProfile = "default",
  options: { rebaselineSupersededManifest?: boolean; model?: NativeModel; includeInstructions?: boolean } = {}
): {
  model: NativeModel;
  decisions: ArchitectureDecisionRecord[];
  existingFiles: ProjectionOwnedFile[];
  docsLanguage: ArchitectureDocsLanguage | undefined;
} {
  const model = options.model ?? loadNativeModelFromArchContext(root);
  const layout = resolveArchitectureDocumentationLayout({
    nodes: model.nodes,
    relations: model.relations,
    profile,
    includeInstructions: options.includeInstructions
  });
  return {
    model,
    decisions: loadArchitectureDecisionRecords(root),
    existingFiles: loadArchitectureFilesForLayout(root, layout, options),
    docsLanguage: loadArchitectureDocumentationLanguage(root)
  };
}

export function architectureDocumentationSourceDigest(input: {
  model: NativeModel;
  profile?: ArchitectureProjectionProfile;
  decisions: ArchitectureDecisionRecord[];
}): string {
  return digestJson({
    model: input.model,
    profile: input.profile ?? "default",
    decisions: input.decisions.map((decision) => ({
      id: decision.id,
      path: decision.path,
      title: decision.title,
      status: decision.status
    }))
  } as unknown as Json);
}

/** The applied manifest selects the layout to verify; never guess a missing profile. */
export function loadArchitectureDocumentationProfile(root: string): ArchitectureProjectionProfile {
  return parseArchitectureDocumentationProfile(readFileSync(resolve(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH), "utf8"));
}

export function parseArchitectureDocumentationProfile(body: string): ArchitectureProjectionProfile {
  // A superseded manifest is read for its schemaVersion only, so it names no profile.
  const schemaVersion = architectureDocsProjectionManifestSchemaVersion(body);
  if (isSupersededArchitectureDocsProjectionManifestSchemaVersion(schemaVersion)) throw new ProjectionManifestUpgradeRequiredError(schemaVersion!);
  const manifest = JSON.parse(body);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || (manifest.profile !== "default" && manifest.profile !== REPO_HARNESS_PROJECTION_PROFILE)) {
    throw new Error("projection-manifest-profile-invalid: regenerate docs with an explicit supported --profile");
  }
  return manifest.profile;
}

const ARCHCONTEXT_MANIFEST_PATH = ".archcontext/manifest.yaml";

/**
 * `docs.language` from `.archcontext/manifest.yaml`. It selects the headings of a new module
 * document's skeleton only. Without the setting the renderer writes the legacy headings. A missing
 * or unreadable manifest declares nothing here, as for `codeFacts.required`; manifest shape is
 * `archctx validate`'s concern. A value that is not a supported language fails closed.
 */
export function loadArchitectureDocumentationLanguage(root: string): ArchitectureDocsLanguage | undefined {
  const path = resolve(root, ARCHCONTEXT_MANIFEST_PATH);
  if (!existsSync(path)) return undefined;
  let manifest: Json;
  try {
    manifest = parseJsonOrStableYaml(readFileSync(path, "utf8"), ARCHCONTEXT_MANIFEST_PATH);
  } catch {
    return undefined;
  }
  const docs = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.docs : undefined;
  const language = docs && typeof docs === "object" && !Array.isArray(docs) ? docs.language : undefined;
  return language === undefined ? undefined : assertArchitectureDocsLanguage(language);
}

export function assertArchitectureDocsLanguage(value: unknown): ArchitectureDocsLanguage {
  if (!(ARCHITECTURE_DOCS_LANGUAGES as readonly unknown[]).includes(value)) {
    throw new Error(`architecture-docs-language-invalid: docs.language must be one of ${ARCHITECTURE_DOCS_LANGUAGES.join(", ")} (got ${JSON.stringify(value)})`);
  }
  return value as ArchitectureDocsLanguage;
}

/**
 * `projection.instructions` from `.archcontext/manifest.yaml` (#642). Defaults to `true` when absent
 * so existing repositories keep their default behavior; setting `false` disables `AGENTS.md`/`CLAUDE.md`
 * instruction-block writes during `archctx sync`.
 */
export function loadArchitectureProjectionInstructionsEnabled(root: string): boolean {
  const path = resolve(root, ARCHCONTEXT_MANIFEST_PATH);
  if (!existsSync(path)) return true;
  let manifest: Json;
  try {
    manifest = parseJsonOrStableYaml(readFileSync(path, "utf8"), ARCHCONTEXT_MANIFEST_PATH);
  } catch {
    return true;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return true;
  const projection = manifest.projection;
  if (projection === undefined) return true;
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error("architecture-projection-config-invalid: projection must be an object");
  }
  const instructions = (projection as Record<string, Json>).instructions;
  if (instructions === undefined) return true;
  if (typeof instructions !== "boolean") {
    throw new Error(`architecture-projection-instructions-invalid: projection.instructions must be a boolean (got ${JSON.stringify(instructions)})`);
  }
  return instructions;
}

export function loadArchitectureDecisionRecords(root: string): ArchitectureDecisionRecord[] {
  const dir = resolve(root, "docs/adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^ADR-\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const path = `docs/adr/${file}`;
      const metadata = parseArchitectureDecisionRecord(path, readFileSync(resolve(root, path), "utf8"));
      return { id: basename(file, ".md"), title: metadata.title, path, ...(metadata.status ? { status: metadata.status } : {}) };
    });
}

export function loadArchitectureDocumentationFiles(
  root: string,
  model: NativeModel = loadNativeModelFromArchContext(root),
  profile: ArchitectureProjectionProfile = "default",
  includeInstructions?: boolean
): ProjectionOwnedFile[] {
  return loadArchitectureFilesForLayout(
    root,
    resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations, profile, includeInstructions })
  );
}

// --- Projection freshness: would the committed documents render differently? (ADR-0056 §1) ---
//
// Drift answers "do the files on disk match this render?", including integrity, adoption,
// ownership and orphans. Freshness answers the narrower question over the committed record only:
// does each target render the output its committed row records, and would the manifest the render
// writes equal the committed bytes? Both sides are render outputs, so freshness covers every render
// input without listing it and never reads Git history. Freshness that is not ok implies drift that
// is not ok.

export function semanticArchitectureNodes(model: NativeModel): SemanticArchitectureNode[] {
  return model.nodes.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    ...(entry.parent ? { parent: entry.parent } : {}),
    ...(nativeNodeSource(entry) ? { source: nativeNodeSource(entry) } : {})
  }));
}

/**
 * `archctx flows check`: every declared selector's proof status and the P2 proof of every
 * capability that declares a flow, from the same model normalization and proof code a projection
 * uses, without rendering anything.
 */
export function checkArchitectureFlowSelectors(input: {
  model: NativeModel;
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
  codeGraph: ArchitectureFlowSelectorCheckV1["codeGraph"];
}): ArchitectureFlowSelectorCheckV1 {
  const model = normalizeNativeModel(input.model);
  return {
    schemaVersion: ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION,
    codeGraph: input.codeGraph,
    ...checkSemanticFlowSelectors({
      nodes: semanticArchitectureNodes(model),
      relations: model.relations,
      flows: model.flows ?? [],
      evidence: input.selectorEvidence
    })
  };
}
