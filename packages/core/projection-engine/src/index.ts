import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  AGENT_CONTEXT_RENDERER_VERSION as CONTRACT_AGENT_CONTEXT_RENDERER_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION as CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION,
  PROJECTION_TARGET_SCHEMA_VERSION,
  digestJson,
  stableId,
  type Json,
  type ModelExportResult,
  type ProjectionTargetV1
} from "@archcontext/contracts";
import { assertRepoRelativePath, parseJsonOrStableYaml } from "../../architecture-domain/src/index";

export interface NativeNodeSource {
  include?: string[];
  exclude?: string[];
  entrypoints?: string[];
}

export interface NativeNode extends Record<string, Json | undefined> {
  id: string;
  kind: string;
  name: string;
  status?: string;
  summary?: string;
  // Typed as Json (not NativeNodeSource) so this interface still satisfies its own
  // Record<string, Json | undefined> index signature; use nativeNodeSource(node) to read
  // this field with the NativeNodeSource shape.
  source?: Json;
  extensions?: Record<string, Json>;
}

/** Reads `node.source` (ADR-0043 `source.include`/`source.exclude`/`entrypoints`) as NativeNodeSource. */
export function nativeNodeSource(node: NativeNode): NativeNodeSource | undefined {
  const value = node.source;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as unknown as NativeNodeSource;
}

export interface NativeRelation extends Record<string, Json> {
  id: string;
  kind: string;
  source: string;
  target: string;
  intent: string;
}

export interface NativeModel {
  nodes: NativeNode[];
  relations: NativeRelation[];
}

export interface ArchitectureDecisionRecord {
  id: string;
  title: string;
  path: string;
  status?: string;
}

export interface ArchitectureDocumentationTimelineEntry {
  eventId: string;
  timestamp: string;
  title?: string;
  summary?: string;
  affectedSubjects?: string[];
}

export interface ArchitectureDocumentationExistingFile {
  path: string;
  body: string;
}

export interface ArchitectureDocumentationProjectionFile extends ArchitectureDocumentationExistingFile {
  target: ProjectionTargetV1;
  digest: string;
  generatedBodyDigest: string;
  /**
   * Present on `entity-summary` targets only: the commit this file's generated region is stamped
   * with. Reused from the existing marker whenever the render inputs are unchanged, so the
   * projection has a fixed point across commits.
   */
  verifiedAgainst?: ArchitectureProjectionVerifiedAgainst;
}

export type ArchitectureDocumentationDriftReason =
  | "projection-file-missing"
  | "projection-manifest-missing"
  | "projection-manifest-invalid"
  | "projection-manifest-stale"
  | "projection-generated-region-missing"
  | "projection-generated-region-stale"
  | "projection-generated-region-manually-edited"
  | "projection-ambiguous-ownership"
  | "projection-orphaned";

export interface ArchitectureDocumentationProjectionDrift {
  path: string;
  targetId?: string;
  reasonCode: ArchitectureDocumentationDriftReason;
  expectedDigest?: string;
  actualDigest?: string;
}

/**
 * Something a consumer must be told about a render that still succeeded. Notices are not drift and
 * never fail a projection; they exist so a stamp the renderer could not keep is visible on the
 * `plan`/`apply` surface instead of happening silently.
 */
export type ArchitectureDocumentationProjectionNoticeCode = "projection-stamp-change-set-unmeasurable";

export interface ArchitectureDocumentationProjectionNotice {
  code: ArchitectureDocumentationProjectionNoticeCode;
  nodeId: string;
  targetId: string;
  path: string;
  /** The commit the existing generated region was stamped with. */
  stampedCommit: string;
  detail: string;
}

export interface ArchitectureDocumentationProjectionPlan {
  schemaVersion: "archcontext.architecture-docs-projection-plan/v1";
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  projectionDigest: string;
  targets: ProjectionTargetV1[];
  files: ArchitectureDocumentationProjectionFile[];
  manifest: ArchitectureDocumentationExistingFile & { digest: string };
  drift: {
    ok: boolean;
    reasonCodes: ArchitectureDocumentationDriftReason[];
    diffs: ArchitectureDocumentationProjectionDrift[];
  };
  rejected: ArchitectureDocumentationProjectionDrift[];
  /** Non-blocking; see `ArchitectureDocumentationProjectionNotice`. Empty on a fully measured run. */
  notices: ArchitectureDocumentationProjectionNotice[];
}

export const ARCHITECTURE_DOCS_RENDERER_VERSION = CONTRACT_ARCHITECTURE_DOCS_RENDERER_VERSION;
export const ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT:generated";
export const ARCHITECTURE_DOCS_GENERATED_END_PREFIX = "<!-- END ARCHCONTEXT:generated";

/**
 * Git state the projection was rendered against. Every documentation projection carries this
 * into the `entity-summary` intro block as `Verified against: <branch>@<commit>`; there is no
 * default and no placeholder — a caller that cannot read Git state must fail, not project.
 */
export interface ArchitectureProjectionVerifiedAgainst {
  branch: string;
  commit: string;
  /** Committer date of `commit` (ISO 8601). The intro block dates the commit, not the render run. */
  committedAt: string;
}

/**
 * Measured scale of one node's declared `source.include` (minus `source.exclude`) footprint.
 * Produced by `loadCapabilitySourceScaleSignals`; the renderer refuses to project a node that
 * declares `source.include` without a matching measurement rather than printing a guess.
 */
export interface CapabilitySourceScaleSignal {
  nodeId: string;
  fileCount: number;
  lineCount: number;
  includePatterns: string[];
  excludePatterns: string[];
}

/** One real `imports` edge between two repo-relative files, as resolved by the code index. */
export interface CapabilityImportEdge {
  from: string;
  to: string;
}

/**
 * One node's measured import footprint: the files `source.include` (minus `source.exclude`)
 * selects, plus the real `imports` edges the code index resolved out of those files. Produced
 * outside `@archcontext/core` because the index query needs a child process. The renderer draws
 * exactly these edges — it never synthesises one, and it never promotes a call trail into a P1
 * edge, because that trail mixes real calls with type references.
 */
export interface CapabilityImportGraph {
  nodeId: string;
  /** Repo-relative files inside the node's declared footprint, sorted. */
  files: string[];
  /** Edges whose `from` is one of `files`; `to` may sit outside the footprint. */
  edges: CapabilityImportEdge[];
  /** The index dump hit its budget, so `edges` may be incomplete. Printed, never hidden. */
  truncated: boolean;
}

/** One call site the index attributed to a seed symbol. Best-effort: may be a type reference. */
export interface CapabilityEntrypointCall {
  symbol: string;
  path: string;
  line?: number;
}

/** One top-level symbol of a declared entrypoint, with the call trail the index reported for it. */
export interface CapabilityEntrypointSeed {
  symbol: string;
  line?: number;
  calls: CapabilityEntrypointCall[];
  /** The index truncated this symbol's call trail. */
  callsTruncated: boolean;
}

export interface CapabilityEntrypointTrace {
  path: string;
  seeds: CapabilityEntrypointSeed[];
  /** The entrypoint declares more top-level functions than the seed budget covered. */
  seedsTruncated: boolean;
}

/**
 * Call trails out of one node's declared `source.entrypoints`. Unlike the import graph, a node
 * that declares entrypoints and has no call graph is a hard failure (`assertCapabilityEntrypointCallGraphs`):
 * the P2 handshake is either derived from a live index or it is not rendered at all — it never
 * degrades into an empty template.
 */
export interface CapabilityEntrypointCallGraph {
  nodeId: string;
  entrypoints: CapabilityEntrypointTrace[];
}

/** Git values that the local adapters emit when the read failed; never valid projection provenance. */
const VERIFIED_AGAINST_NON_VALUES = new Set(["unknown", "unborn", "undefined", "null", "none", "HEAD"]);

export function assertArchitectureProjectionVerifiedAgainst(
  value: ArchitectureProjectionVerifiedAgainst | undefined
): ArchitectureProjectionVerifiedAgainst {
  if (!value) throw new Error("architecture-docs-projection-verified-against-missing");
  const branch = typeof value.branch === "string" ? value.branch.trim() : "";
  const commit = typeof value.commit === "string" ? value.commit.trim() : "";
  if (branch === "" || VERIFIED_AGAINST_NON_VALUES.has(branch)) {
    throw new Error(`architecture-docs-projection-verified-against-invalid-branch: ${JSON.stringify(value.branch ?? null)}`);
  }
  if (VERIFIED_AGAINST_NON_VALUES.has(commit) || !/^[0-9a-f]{7,64}$/.test(commit)) {
    throw new Error(`architecture-docs-projection-verified-against-invalid-commit: ${JSON.stringify(value.commit ?? null)}`);
  }
  const committedAt = typeof value.committedAt === "string" ? value.committedAt.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(committedAt)) {
    throw new Error(`architecture-docs-projection-verified-against-invalid-committed-at: ${JSON.stringify(value.committedAt ?? null)}`);
  }
  return { branch, commit, committedAt };
}

/**
 * Fail-closed gate for the P2 handshake diagram: a node that declares `source.entrypoints` must
 * arrive with a call graph produced against a live index. A missing or partial graph throws
 * instead of rendering an empty diagram, and the traced entrypoint set must match the declared
 * one exactly so half-collected data cannot pass as a complete trace.
 */
export function assertCapabilityEntrypointCallGraphs(
  model: NativeModel,
  graphs: CapabilityEntrypointCallGraph[] | undefined
): Map<string, CapabilityEntrypointCallGraph> {
  const byNodeId = new Map((graphs ?? []).map((graph) => [graph.nodeId, graph]));
  for (const node of model.nodes) {
    const declared = nativeNodeSource(node)?.entrypoints ?? [];
    if (declared.length === 0) continue;
    const graph = byNodeId.get(node.id);
    if (!graph) throw new Error(`architecture-docs-projection-call-graph-missing: ${node.id}`);
    const traced = graph.entrypoints.map((entry) => entry.path);
    const missing = declared.filter((entry) => !traced.includes(entry));
    const unexpected = traced.filter((entry) => !declared.includes(entry));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `architecture-docs-projection-call-graph-entrypoint-mismatch: ${node.id} (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`
      );
    }
  }
  return byNodeId;
}

export function renderArchitectureDocumentationProjection(input: {
  model: NativeModel;
  sourceDigest: string;
  verifiedAgainst: ArchitectureProjectionVerifiedAgainst;
  /**
   * Per node: did the code inside its declared `source.include` footprint change after the commit
   * its existing document is stamped with? Measured by the caller (`capabilitySourceChangesSinceStamps`
   * over a Git read), because `@archcontext/core` does not spawn processes. A node that declares no
   * footprint needs no entry: no covered change is possible, so its stamp always sticks.
   */
  sourceChangesSinceStamp: CapabilitySourceChangeSinceStamp[];
  sourceScaleSignals: CapabilitySourceScaleSignal[];
  importGraphs: CapabilityImportGraph[];
  entrypointCallGraphs: CapabilityEntrypointCallGraph[];
  generatedAt?: string;
  decisions?: ArchitectureDecisionRecord[];
  timeline?: ArchitectureDocumentationTimelineEntry[];
  existingFiles?: ArchitectureDocumentationExistingFile[];
  rendererVersion?: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
}): ArchitectureDocumentationProjectionPlan {
  const rendererVersion = input.rendererVersion ?? ARCHITECTURE_DOCS_RENDERER_VERSION;
  const verifiedAgainst = assertArchitectureProjectionVerifiedAgainst(input.verifiedAgainst);
  const model = normalizeNativeModel(input.model);
  const existingByPath = new Map((input.existingFiles ?? []).map((file) => [file.path, file.body]));
  const generatedAt = input.generatedAt ?? "1970-01-01T00:00:00.000Z";
  const scaleSignalsByNodeId = new Map((input.sourceScaleSignals ?? []).map((signal) => [signal.nodeId, signal]));
  const importGraphsByNodeId = new Map((input.importGraphs ?? []).map((graph) => [graph.nodeId, graph]));
  const callGraphsByNodeId = assertCapabilityEntrypointCallGraphs(model, input.entrypointCallGraphs);
  // The measured scale signal, the measured import graph, and the entrypoint call graph are all
  // render inputs of the entity-summary body, so they belong to the digest those targets record in
  // their marker. Folding them in per target (instead of into the plan-wide sourceDigest) keeps a
  // re-measured footprint reported as `projection-generated-region-stale` on the docs that actually
  // carry it, instead of being mis-reported as a manual edit — and leaves
  // index/diagram/decision/relation targets byte-identical to their pre-change output.
  //
  // `verifiedAgainst` is deliberately *not* an input here. It is a sticky stamp (see
  // `stickyVerifiedAgainst` below), not a render input: folding a moving HEAD into the digest would
  // leave the projection without a fixed point — every commit would invalidate the document that
  // the previous commit had just re-projected.
  const entitySourceDigest = digestJson({
    sourceDigest: input.sourceDigest,
    sourceScaleSignals: [...scaleSignalsByNodeId.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    importGraphs: [...importGraphsByNodeId.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    entrypointCallGraphs: [...callGraphsByNodeId.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId))
  } as unknown as Json);
  const targetDrafts = architectureDocumentationTargetDrafts(model);
  const declaresSourceByNodeId = new Map(model.nodes.map((node) => [node.id, (nativeNodeSource(node)?.include ?? []).length > 0]));
  const changeSinceStampByNodeId = new Map(input.sourceChangesSinceStamp.map((entry) => [entry.nodeId, entry]));
  const notices: ArchitectureDocumentationProjectionNotice[] = [];
  const rendered = targetDrafts.map((draft) => {
    const existing = existingByPath.get(draft.path);
    const nodeId = draft.type === "entity-summary" ? draft.scope.id : undefined;
    let targetVerifiedAgainst: ArchitectureProjectionVerifiedAgainst | undefined;
    if (nodeId !== undefined) {
      const decision = stickyVerifiedAgainst(existing, draft.targetId, entitySourceDigest, {
        nodeDeclaresSource: declaresSourceByNodeId.get(nodeId) === true,
        measurement: changeSinceStampByNodeId.get(nodeId)
      });
      if (decision.kind === "restamp-unmeasured") {
        notices.push({
          code: "projection-stamp-change-set-unmeasurable",
          nodeId,
          targetId: draft.targetId,
          path: draft.path,
          stampedCommit: decision.stampedCommit,
          detail: decision.detail
        });
      }
      targetVerifiedAgainst = decision.kind === "reuse" ? decision.verifiedAgainst : verifiedAgainst;
    }
    const generatedBody = renderTargetGeneratedBody(draft, model, {
      generatedAt,
      verifiedAgainst: targetVerifiedAgainst ?? verifiedAgainst,
      scaleSignalsByNodeId,
      importGraphsByNodeId,
      callGraphsByNodeId,
      decisions: input.decisions ?? [],
      timeline: input.timeline ?? []
    });
    const generatedBodyDigest = digestJson({ targetId: draft.targetId, body: generatedBody } as unknown as Json);
    const target = projectionTarget({
      ...draft,
      rendererVersion,
      sourceDigest: draft.type === "entity-summary" ? entitySourceDigest : input.sourceDigest,
      outputDigest: generatedBodyDigest,
      ...(targetVerifiedAgainst ? { verifiedAgainst: targetVerifiedAgainst } : {})
    });
    const wrapped = wrapGeneratedRegion(target, generatedBody);
    const body = mergeGeneratedRegion(target, wrapped, existing, draft.skeleton);
    return {
      path: target.path,
      body,
      target,
      digest: digestJson({ path: target.path, body } as unknown as Json),
      generatedBodyDigest,
      ...(targetVerifiedAgainst ? { verifiedAgainst: targetVerifiedAgainst } : {})
    };
  });
  const targets = rendered.map((file) => file.target);
  const expectedByPath = new Map(rendered.map((file) => [file.path, file]));
  const projectionDigest = digestJson({
    rendererVersion,
    sourceDigest: input.sourceDigest,
    files: rendered.map((file) => ({
      path: file.path,
      targetId: file.target.targetId,
      digest: file.digest,
      generatedBodyDigest: file.generatedBodyDigest
    })).sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json);
  const manifestValue = {
    schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
    rendererVersion,
    sourceDigest: input.sourceDigest,
    projectionDigest,
    targetCount: targets.length,
    fileCount: rendered.length,
    // Machine-readable copy of the `Verified against` line each entity-summary intro prints, one
    // entry per target. The rendered prose is for humans; the freshness check
    // (`evaluateArchitectureProjectionFreshness`) needs the commit as data, so it is recorded here
    // instead of being parsed back out of Markdown. There is deliberately no manifest-wide
    // `verifiedAgainst`: stamps are per target, and a manifest-wide copy of the current HEAD would
    // make the manifest itself drift on every commit, which is exactly the fixed point the sticky
    // stamp exists to establish.
    targets: rendered.map((file) => ({
      targetId: file.target.targetId,
      type: file.target.type,
      scope: file.target.scope,
      path: file.target.path,
      ownership: file.target.ownership,
      rendererVersion: file.target.rendererVersion,
      format: file.target.format,
      sourceDigest: file.target.sourceDigest,
      outputDigest: file.target.outputDigest,
      ...(file.verifiedAgainst ? { verifiedAgainst: file.verifiedAgainst } : {})
    }))
  } as unknown as Json;
  const manifest = {
    path: "docs/architecture/.projection-manifest.json",
    body: `${JSON.stringify(manifestValue, null, 2)}\n`,
    digest: digestJson(manifestValue)
  };
  const drift = architectureDocumentationProjectionDrift({
    targets,
    expectedFiles: rendered,
    expectedManifest: manifest,
    existingFiles: input.existingFiles ?? []
  });
  const rejected = drift.diffs.filter((diff) => diff.reasonCode === "projection-ambiguous-ownership");

  return {
    schemaVersion: "archcontext.architecture-docs-projection-plan/v1",
    rendererVersion,
    sourceDigest: input.sourceDigest,
    projectionDigest,
    targets,
    files: rendered.filter((file) => !rejected.some((diff) => diff.path === file.path && diff.targetId === file.target.targetId)),
    manifest,
    drift: {
      ...drift,
      diffs: drift.diffs.map((diff) => ({
        ...diff,
        expectedDigest: diff.expectedDigest ?? expectedByPath.get(diff.path)?.digest
      }))
    },
    rejected,
    notices
  };
}

export function loadArchitectureDocumentationInputs(root: string): {
  model: NativeModel;
  decisions: ArchitectureDecisionRecord[];
  existingFiles: ArchitectureDocumentationExistingFile[];
} {
  return {
    model: loadNativeModelFromArchContext(root),
    decisions: loadArchitectureDecisionRecords(root),
    existingFiles: loadArchitectureDocumentationFiles(root)
  };
}

/**
 * Measures the `source.include` minus `source.exclude` footprint of every node that declares one.
 * Nodes without `source.include` are absent from the result on purpose: the renderer prints an
 * explicit "not derivable" note for them instead of a zero that reads like a measurement.
 */
export function loadCapabilitySourceScaleSignals(root: string, model: NativeModel): CapabilitySourceScaleSignal[] {
  return loadCapabilitySourceFootprints(root, model).map((footprint) => ({
    nodeId: footprint.nodeId,
    fileCount: footprint.files.length,
    lineCount: footprint.files.reduce((total, path) => total + countFileLines(resolve(root, path)), 0),
    includePatterns: footprint.includePatterns,
    excludePatterns: footprint.excludePatterns
  }));
}

/** One node's declared source footprint, resolved to repo-relative files. */
export interface CapabilitySourceFootprint {
  nodeId: string;
  files: string[];
  includePatterns: string[];
  excludePatterns: string[];
}

/**
 * Resolves every node's `source.include` minus `source.exclude` to the repo-relative files it
 * selects. Shared by the scale signal loader and by the code-index adapter that measures import
 * edges, so both answer "which files belong to this capability" the same way.
 */
export function loadCapabilitySourceFootprints(root: string, model: NativeModel): CapabilitySourceFootprint[] {
  const nodes = model.nodes.filter((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  if (nodes.length === 0) return [];
  const scanned = listScaleScanFiles(root);
  return nodes
    .map((node) => {
      const source = nativeNodeSource(node)!;
      const includePatterns = [...(source.include ?? [])];
      const excludePatterns = [...(source.exclude ?? [])];
      const files = scanned
        .filter((path) =>
          !excludePatterns.some((pattern) => matchesGlob(path, pattern))
          && includePatterns.some((pattern) => matchesGlob(path, pattern))
        )
        .sort((left, right) => left.localeCompare(right));
      return { nodeId: node.id, files, includePatterns, excludePatterns };
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

const SCALE_SCAN_SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

function listScaleScanFiles(root: string, prefix = "", out: string[] = []): string[] {
  const dir = prefix === "" ? resolve(root) : resolve(root, prefix);
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SCALE_SCAN_SKIPPED_DIRECTORIES.has(entry.name)) continue;
      listScaleScanFiles(root, path, out);
      continue;
    }
    if (entry.isFile()) out.push(path);
  }
  return out;
}

function countFileLines(absolute: string): number {
  const content = readFileSync(absolute, "utf8");
  if (content === "") return 0;
  const newlines = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

export function architectureDocumentationSourceDigest(input: {
  model: NativeModel;
  decisions: ArchitectureDecisionRecord[];
}): string {
  return digestJson({
    model: input.model,
    decisions: input.decisions.map((decision) => ({
      id: decision.id,
      path: decision.path,
      title: decision.title,
      status: decision.status
    }))
  } as unknown as Json);
}

export function loadArchitectureDecisionRecords(root: string): ArchitectureDecisionRecord[] {
  const dir = resolve(root, "docs/adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^ADR-\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const path = `docs/adr/${file}`;
      const body = readFileSync(resolve(root, path), "utf8");
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(file, ".md");
      const status = body.match(/^Status:\s*(.+)$/mi)?.[1]?.trim();
      return {
        id: basename(file, ".md"),
        title,
        path,
        ...(status ? { status } : {})
      };
    });
}

export function loadArchitectureDocumentationFiles(root: string): ArchitectureDocumentationExistingFile[] {
  const files: ArchitectureDocumentationExistingFile[] = [];
  for (const entry of [
    "docs/architecture/index.md",
    "docs/architecture/changelog.md",
    "docs/architecture/decisions/index.md",
    "docs/architecture/diagrams/architecture.mmd",
    "docs/architecture/diagrams/architecture.likec4",
    "docs/architecture/diagrams/architecture.structurizr.json",
    "docs/architecture/.projection-manifest.json"
  ]) {
    const absolute = resolve(root, entry);
    if (existsSync(absolute)) files.push({ path: entry, body: readFileSync(absolute, "utf8") });
  }
  for (const dir of ["docs/architecture/modules", "docs/architecture/relations"]) {
    const absoluteDir = resolve(root, dir);
    if (!existsSync(absoluteDir)) continue;
    for (const file of readdirSync(absoluteDir).filter((name) => name.endsWith(".md")).sort()) {
      const path = `${dir}/${file}`;
      files.push({ path, body: readFileSync(resolve(root, path), "utf8") });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

// --- Projection freshness (code moved, projection did not) ---
//
// `architectureDocumentationProjectionDrift` answers "does the file on disk still match what the
// renderer would emit from the current model?" — a digest question over the projection's own
// inputs. Freshness answers a different one: "has the code the projection describes changed since
// the commit it was verified against?". Neither subsumes the other; a projection can be
// digest-clean and describe a tree that moved on ten commits ago.
//
// The Git read stays in the caller (surface/adapter) because `@archcontext/core` does not spawn
// processes; this evaluation is a pure total function over the caller's measurement.

export type ArchitectureProjectionFreshnessReasonCode =
  | "projection-manifest-missing"
  | "projection-manifest-unreadable"
  | "projection-verified-against-missing"
  | "projection-verified-against-invalid"
  | "projection-change-set-unavailable"
  | "projection-source-changed-since-verified-commit";

/**
 * Repo-relative paths that changed between the projection's `verifiedAgainst.commit` and the
 * current HEAD, as measured by the caller. `unavailable` is a first-class outcome (shallow clone,
 * unknown commit, missing Git): the freshness gate fails closed on it rather than reading an
 * unmeasurable range as "nothing changed".
 */
export type CapabilitySourceChangeSet =
  | { status: "measured"; paths: string[] }
  | { status: "unavailable"; reason: string };

export interface ArchitectureProjectionFreshnessStaleNode {
  nodeId: string;
  /** The commit this node's projected document is stamped with. */
  verifiedAgainst: ArchitectureProjectionVerifiedAgainst;
  changedPathCount: number;
  /** Bounded sample of the changed paths inside this node's footprint, sorted. */
  changedPaths: string[];
  changedPathsTruncated: boolean;
}

export interface ArchitectureProjectionFreshnessEvaluation {
  schemaVersion: "archcontext.projection-freshness/v1";
  ok: boolean;
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[];
  /** Names the trigger source so a consumer can tell this apart from a HEAD-snapshot mismatch. */
  detail: string;
  changedPathCount: number;
  staleNodes: ArchitectureProjectionFreshnessStaleNode[];
}

/** One measured changed-path set, keyed by the commit the caller diffed HEAD against. */
export interface CapabilitySourceChangeSetForCommit {
  commit: string;
  changeSet: CapabilitySourceChangeSet;
}

/**
 * One node's answer to "did the code this document describes change after the commit the document
 * is stamped with?". Produced by `capabilitySourceChangesSinceStamps` and consumed by the renderer,
 * which reuses the existing stamp only on `unchanged`. `commit` names the stamped commit the
 * measurement is valid for, so a renderer looking at a marker stamped with a different commit
 * discards the measurement instead of applying it to the wrong baseline.
 */
export type CapabilitySourceChangeSinceStamp =
  | { nodeId: string; commit: string; status: "unchanged" }
  | { nodeId: string; commit: string; status: "changed"; changedPathCount: number }
  | { nodeId: string; commit: string; status: "unmeasurable"; reason: string };

const FRESHNESS_SAMPLE_PATH_LIMIT = 10;

/**
 * Repo-relative path patterns the projection itself writes: the architecture documentation tree
 * (including its manifest) and every agent-context contract file the model designates.
 *
 * Freshness must subtract these from the measured change set. An agent-context target lands inside
 * its own capability's declared `source.include` footprint, so counting the projection's own output
 * as capability source would make every projection commit report the capability stale, which would
 * demand another projection producing the same bytes — a loop with no fixed point.
 *
 * Single point of truth: both the freshness gate and any consumer that needs to know "did the
 * projection write this?" derive it here, so the two can never disagree.
 */
export function projectionOwnedPaths(model: NativeModel): string[] {
  return [
    "docs/architecture/**",
    ...agentContextProjectionTargetPaths(model).map((target) => target.path)
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Decides whether the architecture documentation projection is still verified against the current
 * tree: a path that changed after `verifiedAgainst.commit` and falls inside a node's declared
 * `source.include` (minus `source.exclude`) footprint means that node's projected document was
 * rendered from code that has since moved.
 *
 * Footprint matching deliberately uses the same include/exclude predicate as
 * `loadCapabilitySourceFootprints` — the one that feeds the renderer — and not the ADR-0043
 * single-owner tie-break: every node whose render input changed is stale, including nodes whose
 * globs overlap, and an ambiguous owner must not silently drop the signal.
 */
export function evaluateArchitectureProjectionFreshness(input: {
  model: NativeModel;
  /** Manifest readback; every raw `verifiedAgainst` entry is validated here, never trusted. */
  manifest: ArchitectureProjectionManifestVerifiedAgainstReadback;
  /**
   * One measured changed-path set per distinct stamped commit. Each node is compared against the
   * set measured for *its own* stamp, so a document that was re-verified later is not judged
   * against an older document's baseline.
   */
  changeSets: CapabilitySourceChangeSetForCommit[];
}): ArchitectureProjectionFreshnessEvaluation {
  const reasonCodes: ArchitectureProjectionFreshnessReasonCode[] = [];
  const details: string[] = [];
  if (input.manifest.status === "manifest-missing") {
    return freshnessEvaluation(
      ["projection-manifest-missing"],
      ["docs/architecture/.projection-manifest.json is absent; nothing records what the projection was verified against"],
      0,
      []
    );
  }
  if (input.manifest.status === "manifest-unreadable") {
    return freshnessEvaluation(
      ["projection-manifest-unreadable"],
      [`projection manifest could not be read: ${input.manifest.reason}`],
      0,
      []
    );
  }

  const ownedPathPatterns = projectionOwnedPaths(input.model);
  const measuredPaths = new Set<string>();
  for (const entry of input.changeSets) {
    if (entry.changeSet.status !== "measured") continue;
    for (const path of entry.changeSet.paths) {
      if (ownedPathPatterns.some((pattern) => matchesGlob(path, pattern))) continue;
      measuredPaths.add(path);
    }
  }

  const staleNodes: ArchitectureProjectionFreshnessStaleNode[] = [];
  for (const probe of probeCapabilitySourceStamps({
    model: input.model,
    manifestNodes: input.manifest.nodes,
    changeSets: input.changeSets
  })) {
    if (probe.outcome.kind === "no-stamp") {
      reasonCodes.push("projection-verified-against-missing");
      details.push(`projection manifest records no verifiedAgainst for ${probe.nodeId}; re-run the documentation projection`);
      continue;
    }
    if (probe.outcome.kind === "invalid-stamp") {
      reasonCodes.push("projection-verified-against-invalid");
      details.push(`projection manifest verifiedAgainst for ${probe.nodeId} is not usable provenance: ${probe.outcome.reason}`);
      continue;
    }
    if (probe.outcome.kind === "unmeasurable") {
      reasonCodes.push("projection-change-set-unavailable");
      details.push(probe.outcome.detail);
      continue;
    }
    const matched = probe.outcome.matchedPaths;
    if (matched.length === 0) continue;
    staleNodes.push({
      nodeId: probe.nodeId,
      verifiedAgainst: probe.outcome.verifiedAgainst,
      changedPathCount: matched.length,
      changedPaths: matched.slice(0, FRESHNESS_SAMPLE_PATH_LIMIT),
      changedPathsTruncated: matched.length > FRESHNESS_SAMPLE_PATH_LIMIT
    });
  }
  if (staleNodes.length > 0) {
    reasonCodes.push("projection-source-changed-since-verified-commit");
    details.push(
      `${staleNodes.length} node(s) changed after their verified commit: ${staleNodes.map((entry) => `${entry.nodeId}(${entry.changedPathCount}@${entry.verifiedAgainst.commit})`).join(", ")}`
    );
  }

  return freshnessEvaluation(
    [...new Set(reasonCodes)],
    details,
    measuredPaths.size,
    staleNodes,
    "no declared capability source changed since the commit its documentation was verified against"
  );
}

/**
 * The one place a node's stamp is matched against a measured change set. Both consumers — the
 * freshness gate (`evaluateArchitectureProjectionFreshness`) and the renderer's stamp lifecycle
 * (`capabilitySourceChangesSinceStamps`) — read this, so "did this node's covered source change
 * since its stamp?" has exactly one answer and one footprint predicate: the same include/exclude
 * matching `loadCapabilitySourceFootprints` feeds the renderer, minus `projectionOwnedPaths`.
 *
 * Nodes without a declared `source.include` are absent: nothing can change under them.
 */
interface CapabilitySourceStampProbe {
  nodeId: string;
  outcome:
    | { kind: "no-stamp" }
    | { kind: "invalid-stamp"; reason: string }
    | { kind: "unmeasurable"; verifiedAgainst: ArchitectureProjectionVerifiedAgainst; reason: string; detail: string }
    | { kind: "measured"; verifiedAgainst: ArchitectureProjectionVerifiedAgainst; matchedPaths: string[] };
}

function probeCapabilitySourceStamps(input: {
  model: NativeModel;
  manifestNodes: ArchitectureProjectionManifestNodeVerifiedAgainst[];
  changeSets: CapabilitySourceChangeSetForCommit[];
}): CapabilitySourceStampProbe[] {
  const ownedPathPatterns = projectionOwnedPaths(input.model);
  const stampsByNodeId = new Map(input.manifestNodes.map((entry) => [entry.nodeId, entry.verifiedAgainst]));
  const changeSetByCommit = new Map(input.changeSets.map((entry) => [entry.commit, entry.changeSet]));
  const probes: CapabilitySourceStampProbe[] = [];
  for (const node of [...input.model.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    const source = nativeNodeSource(node);
    const includePatterns = source?.include ?? [];
    if (includePatterns.length === 0) continue;
    const raw = stampsByNodeId.get(node.id);
    if (raw === undefined || raw === null) {
      probes.push({ nodeId: node.id, outcome: { kind: "no-stamp" } });
      continue;
    }
    let verifiedAgainst: ArchitectureProjectionVerifiedAgainst;
    try {
      verifiedAgainst = assertArchitectureProjectionVerifiedAgainst(raw as ArchitectureProjectionVerifiedAgainst);
    } catch (error) {
      probes.push({
        nodeId: node.id,
        outcome: { kind: "invalid-stamp", reason: error instanceof Error ? error.message : String(error) }
      });
      continue;
    }
    const changeSet = changeSetByCommit.get(verifiedAgainst.commit);
    if (!changeSet) {
      probes.push({
        nodeId: node.id,
        outcome: {
          kind: "unmeasurable",
          verifiedAgainst,
          reason: "no changed-path set was measured for this commit",
          detail: `no changed-path set was measured for ${node.id}'s verified commit ${verifiedAgainst.commit}`
        }
      });
      continue;
    }
    if (changeSet.status === "unavailable") {
      probes.push({
        nodeId: node.id,
        outcome: {
          kind: "unmeasurable",
          verifiedAgainst,
          reason: changeSet.reason,
          detail: `changed-path set for ${node.id} at ${verifiedAgainst.commit} could not be measured: ${changeSet.reason}`
        }
      });
      continue;
    }
    const excludePatterns = source?.exclude ?? [];
    const matchedPaths = [...new Set(changeSet.paths)]
      .filter((path) => !ownedPathPatterns.some((pattern) => matchesGlob(path, pattern)))
      .filter((path) =>
        !excludePatterns.some((pattern) => matchesGlob(path, pattern))
        && includePatterns.some((pattern) => matchesGlob(path, pattern))
      )
      .sort((left, right) => left.localeCompare(right));
    probes.push({ nodeId: node.id, outcome: { kind: "measured", verifiedAgainst, matchedPaths } });
  }
  return probes;
}

/**
 * The renderer's stamp-lifecycle input: for every node whose documentation carries a usable stamp,
 * whether its declared source changed after that stamp's commit. A node the manifest does not stamp
 * (or stamps unusably) yields no entry, so the renderer re-stamps it rather than trusting a stamp
 * nothing corroborates.
 *
 * Pure: the caller supplies the Git measurement (`changeSets`), one entry per distinct stamped
 * commit, exactly as `evaluateArchitectureProjectionFreshness` takes it.
 */
export function capabilitySourceChangesSinceStamps(input: {
  model: NativeModel;
  manifest: ArchitectureProjectionManifestVerifiedAgainstReadback;
  changeSets: CapabilitySourceChangeSetForCommit[];
}): CapabilitySourceChangeSinceStamp[] {
  if (input.manifest.status !== "present") return [];
  const out: CapabilitySourceChangeSinceStamp[] = [];
  for (const probe of probeCapabilitySourceStamps({
    model: input.model,
    manifestNodes: input.manifest.nodes,
    changeSets: input.changeSets
  })) {
    if (probe.outcome.kind === "no-stamp" || probe.outcome.kind === "invalid-stamp") continue;
    if (probe.outcome.kind === "unmeasurable") {
      out.push({
        nodeId: probe.nodeId,
        commit: probe.outcome.verifiedAgainst.commit,
        status: "unmeasurable",
        reason: probe.outcome.reason
      });
      continue;
    }
    out.push(probe.outcome.matchedPaths.length === 0
      ? { nodeId: probe.nodeId, commit: probe.outcome.verifiedAgainst.commit, status: "unchanged" }
      : {
        nodeId: probe.nodeId,
        commit: probe.outcome.verifiedAgainst.commit,
        status: "changed",
        changedPathCount: probe.outcome.matchedPaths.length
      });
  }
  return out;
}

function freshnessEvaluation(
  reasonCodes: ArchitectureProjectionFreshnessReasonCode[],
  details: string[],
  changedPathCount: number,
  staleNodes: ArchitectureProjectionFreshnessStaleNode[],
  cleanDetail = "no projection freshness signal available"
): ArchitectureProjectionFreshnessEvaluation {
  return {
    schemaVersion: "archcontext.projection-freshness/v1",
    ok: reasonCodes.length === 0,
    reasonCodes,
    detail: details.length > 0 ? details.join("; ") : cleanDetail,
    changedPathCount,
    staleNodes
  };
}

/** One entity-summary target's recorded stamp, as read back out of the projection manifest. */
export interface ArchitectureProjectionManifestNodeVerifiedAgainst {
  nodeId: string;
  /** Raw manifest value; validated by `evaluateArchitectureProjectionFreshness`, never trusted here. */
  verifiedAgainst: unknown;
}

export type ArchitectureProjectionManifestVerifiedAgainstReadback =
  | { status: "manifest-missing" }
  | { status: "manifest-unreadable"; reason: string }
  | { status: "present"; nodes: ArchitectureProjectionManifestNodeVerifiedAgainst[] };

/**
 * Reads the per-target `verifiedAgainst` stamps back out of the projection manifest, keyed by the
 * node each `entity-summary` target documents. A repository with no manifest has no projection to
 * keep fresh (`manifest-missing`); a manifest that cannot be parsed is reported, never treated as
 * a set of absent entries.
 */
export function loadArchitectureProjectionManifestVerifiedAgainst(
  root: string
): ArchitectureProjectionManifestVerifiedAgainstReadback {
  const absolute = resolve(root, "docs/architecture/.projection-manifest.json");
  if (!existsSync(absolute)) return { status: "manifest-missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    return { status: "manifest-unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "manifest-unreadable", reason: "projection manifest is not a JSON object" };
  }
  const targets = (parsed as Record<string, unknown>).targets;
  if (targets !== undefined && !Array.isArray(targets)) {
    return { status: "manifest-unreadable", reason: "projection manifest targets is not an array" };
  }
  const nodes: ArchitectureProjectionManifestNodeVerifiedAgainst[] = [];
  for (const entry of (targets ?? []) as unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== "entity-summary") continue;
    const scope = record.scope;
    const nodeId = scope && typeof scope === "object" && !Array.isArray(scope)
      ? (scope as Record<string, unknown>).id
      : undefined;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    nodes.push({ nodeId, verifiedAgainst: record.verifiedAgainst });
  }
  return { status: "present", nodes };
}

export function normalizeNativeModel(model: NativeModel): NativeModel {
  return {
    nodes: [...model.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...model.relations].sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function exportMermaidModel(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const lines = ["%% Generated by ArchContext. Native model remains source of truth.", "flowchart LR"];
  for (const node of normalized.nodes) {
    lines.push(`  ${mermaidId(node.id)}["${escapeMermaid(node.name)}"]`);
  }
  for (const relation of normalized.relations) {
    lines.push(`  ${mermaidId(relation.source)} -->|"${escapeMermaid(relation.kind)}"| ${mermaidId(relation.target)}`);
  }
  const content = `${lines.join("\n")}\n`;
  return {
    format: "mermaid",
    digest: digestJson({ format: "mermaid", content } as unknown as Json),
    files: [{ path: ".archcontext/generated/architecture.mmd", content }]
  };
}

export function exportDocumentationLikeC4Model(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const lines = [
    "// Generated by ArchContext. Native model remains source of truth.",
    "specification {",
    "  element capability",
    "  element module",
    "  element component",
    "  element interface",
    "  element datastore",
    "  element external_system",
    "}",
    "",
    "model {"
  ];
  for (const node of normalized.nodes) lines.push(`  ${mermaidId(node.id)} = ${documentationLikeC4Kind(node.kind)} "${escapeDsl(node.name)}"`);
  for (const relation of normalized.relations) lines.push(`  ${mermaidId(relation.source)} -> ${mermaidId(relation.target)} "${escapeDsl(relation.kind)}"`);
  lines.push("}", "", "views {", "  view index {", "    include *", "    autoLayout TopBottom", "  }", "}");
  const content = `${lines.join("\n")}\n`;
  return {
    format: "likec4",
    digest: digestJson({ format: "likec4", content } as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.likec4", content }]
  };
}

export function exportDocumentationStructurizrWorkspace(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const workspace = {
    schemaVersion: "archcontext.structurizr-export/v1",
    name: "ArchContext Architecture",
    model: {
      elements: normalized.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: documentationStructurizrElementType(node.kind),
        tags: [node.kind]
      })),
      relationships: normalized.relations.map((relation) => ({
        id: relation.id,
        sourceId: relation.source,
        destinationId: relation.target,
        description: relation.kind
      }))
    },
    views: {
      systemLandscape: {
        key: "archcontext-landscape",
        include: normalized.nodes.map((node) => node.id)
      }
    }
  };
  const content = `${JSON.stringify(workspace, null, 2)}\n`;
  return {
    format: "structurizr",
    digest: digestJson(workspace as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.structurizr.json", content }]
  };
}

export function loadNativeModelFromArchContext(root: string): NativeModel {
  return {
    nodes: readYamlObjects(resolve(root, ".archcontext/model/nodes")) as NativeNode[],
    relations: readYamlObjects(resolve(root, ".archcontext/model/relations")) as NativeRelation[]
  };
}

export function mermaidId(id: string): string {
  return stableId(id).replace(/-/g, "_").replace(/\./g, "_");
}

function readYamlObjects(dir: string): Record<string, Json>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => {
      const path = resolve(dir, file);
      return parseJsonOrStableYaml(readFileSync(path, "utf8"), path) as Record<string, Json>;
    });
}

function escapeMermaid(value: string): string {
  return value.replace(/"/g, "'");
}

interface ProjectionTargetDraft {
  targetId: string;
  type: ProjectionTargetV1["type"];
  scope: ProjectionTargetV1["scope"];
  path: string;
  ownership: ProjectionTargetV1["ownership"];
  format: ProjectionTargetV1["format"];
  /**
   * Human-owned scaffold written only when the target file does not exist yet. The projection
   * never rewrites it afterwards: the title and the §3/§4/Backlog headings live outside the
   * generated region, so every later projection splices the region and leaves them untouched.
   */
  skeleton?: { prefix: string; suffix: string };
}

function architectureDocumentationTargetDrafts(model: NativeModel): ProjectionTargetDraft[] {
  const entityTargets = model.nodes.map((node) => ({
    targetId: `projection_target.entity.${stableId(node.id)}`,
    type: "entity-summary" as const,
    scope: { kind: "entity" as const, id: node.id, entityKind: node.kind },
    path: `docs/architecture/modules/${pathSegment(node.id)}.md`,
    ownership: "mixed" as const,
    format: "markdown" as const,
    skeleton: entitySummarySkeleton(node)
  }));
  const relationTargets = model.relations.map((relation) => ({
    targetId: `projection_target.relation.${stableId(relation.id)}`,
    type: "relation-summary" as const,
    scope: { kind: "relation" as const, id: relation.id },
    path: `docs/architecture/relations/${pathSegment(relation.id)}.md`,
    ownership: "mixed" as const,
    format: "markdown" as const
  }));
  return [
    {
      targetId: "projection_target.architecture.index",
      type: "architecture-index",
      scope: { kind: "repository" },
      path: "docs/architecture/index.md",
      ownership: "mixed",
      format: "markdown"
    },
    ...entityTargets,
    ...relationTargets,
    {
      targetId: "projection_target.decision.index",
      type: "decision-index",
      scope: { kind: "decision" },
      path: "docs/architecture/decisions/index.md",
      ownership: "mixed",
      format: "markdown"
    },
    {
      targetId: "projection_target.architecture.changelog",
      type: "architecture-changelog",
      scope: { kind: "changelog" },
      path: "docs/architecture/changelog.md",
      ownership: "mixed",
      format: "markdown"
    },
    {
      targetId: "projection_target.diagram.mermaid",
      type: "diagram-mermaid",
      scope: { kind: "diagram", id: "architecture" },
      path: "docs/architecture/diagrams/architecture.mmd",
      ownership: "generated",
      format: "mermaid"
    },
    {
      targetId: "projection_target.diagram.structurizr",
      type: "diagram-structurizr",
      scope: { kind: "diagram", id: "architecture" },
      path: "docs/architecture/diagrams/architecture.structurizr.json",
      ownership: "generated",
      format: "structurizr-json"
    },
    {
      targetId: "projection_target.diagram.likec4",
      type: "diagram-likec4",
      scope: { kind: "diagram", id: "architecture" },
      path: "docs/architecture/diagrams/architecture.likec4",
      ownership: "generated",
      format: "likec4"
    }
  ];
}

function projectionTarget(input: ProjectionTargetDraft & {
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  outputDigest: string;
  verifiedAgainst?: ArchitectureProjectionVerifiedAgainst;
}): ProjectionTargetV1 {
  return {
    schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
    targetId: input.targetId,
    type: input.type,
    scope: input.scope,
    path: input.path,
    ownership: input.ownership,
    generatedRegion: {
      startMarker: generatedStartMarker(input.targetId, input.sourceDigest, input.rendererVersion, input.outputDigest, input.verifiedAgainst),
      endMarker: generatedEndMarker(input.targetId)
    },
    rendererVersion: input.rendererVersion,
    format: input.format,
    sourceDigest: input.sourceDigest,
    outputDigest: input.outputDigest
  };
}

function renderTargetGeneratedBody(
  target: ProjectionTargetDraft,
  model: NativeModel,
  input: {
    generatedAt: string;
    verifiedAgainst: ArchitectureProjectionVerifiedAgainst;
    scaleSignalsByNodeId: Map<string, CapabilitySourceScaleSignal>;
    importGraphsByNodeId: Map<string, CapabilityImportGraph>;
    callGraphsByNodeId: Map<string, CapabilityEntrypointCallGraph>;
    decisions: ArchitectureDecisionRecord[];
    timeline: ArchitectureDocumentationTimelineEntry[];
  }
): string {
  if (target.type === "architecture-index") return renderArchitectureIndex(model, input.generatedAt);
  if (target.type === "entity-summary") {
    const node = model.nodes.find((entry) => entry.id === target.scope.id)!;
    return renderEntitySummary(node, model, {
      verifiedAgainst: input.verifiedAgainst,
      scaleSignal: input.scaleSignalsByNodeId.get(node.id),
      importGraph: input.importGraphsByNodeId.get(node.id),
      callGraph: input.callGraphsByNodeId.get(node.id)
    });
  }
  if (target.type === "relation-summary") return renderRelationSummary(model.relations.find((relation) => relation.id === target.scope.id)!, model);
  if (target.type === "decision-index") return renderDecisionIndex(input.decisions);
  if (target.type === "architecture-changelog") return renderArchitectureChangelog(input.timeline);
  if (target.type === "diagram-mermaid") return exportMermaidModel(model).files[0].content;
  if (target.type === "diagram-structurizr") return exportDocumentationStructurizrWorkspace(model).files[0].content;
  if (target.type === "diagram-likec4") return exportDocumentationLikeC4Model(model).files[0].content;
  return "";
}

function renderArchitectureIndex(model: NativeModel, generatedAt: string): string {
  const lines = [
    "# Architecture Index",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Entities",
    "",
    ...model.nodes.map((node) => `- [${node.name}](modules/${pathSegment(node.id)}.md) — ${node.kind}${node.status ? ` / ${node.status}` : ""}`),
    ...(model.nodes.length === 0 ? ["- No architecture entities recorded."] : []),
    "",
    "## Relations",
    "",
    ...model.relations.map((relation) => `- [${relation.source} -> ${relation.target}](relations/${pathSegment(relation.id)}.md) — ${relation.kind}`),
    ...(model.relations.length === 0 ? ["- No architecture relations recorded."] : []),
    "",
    "## Projections",
    "",
    "- [Mermaid](diagrams/architecture.mmd)",
    "- [Structurizr JSON](diagrams/architecture.structurizr.json)",
    "- [LikeC4](diagrams/architecture.likec4)",
    "- [Decision index](decisions/index.md)",
    "- [Architecture changelog](changelog.md)"
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Machine-owned region of a capability module document: the intro block plus `## 1` and the
 * `## 2` structural slot. Everything the renderer cannot derive from the model, the measured
 * scale signal, or the Git ref is printed as an explicit "not derivable" note — never as an
 * empty diagram fence, a synthesised edge, or an invented line anchor.
 */
function renderEntitySummary(
  node: NativeNode,
  model: NativeModel,
  input: {
    verifiedAgainst: ArchitectureProjectionVerifiedAgainst;
    scaleSignal?: CapabilitySourceScaleSignal;
    importGraph?: CapabilityImportGraph;
    callGraph?: CapabilityEntrypointCallGraph;
  }
): string {
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  const entrypoints = source?.entrypoints ?? [];
  if (include.length > 0 && !input.scaleSignal) {
    throw new Error(`architecture-docs-projection-scale-signal-missing: ${node.id}`);
  }
  const incoming = model.relations.filter((relation) => relation.target === node.id);
  const outgoing = model.relations.filter((relation) => relation.source === node.id);
  const localContracts = nodeLocalContracts(node);
  const lines = [
    `> **狀態**:${node.status ? `\`${node.status}\`` : "未宣告(`status` 缺失)"}`,
    `> **Verified against**:\`${input.verifiedAgainst.branch}@${input.verifiedAgainst.commit}\`(${input.verifiedAgainst.committedAt.slice(0, 10)})`,
    `> **Capability ID**:\`${node.id}\`(kind \`${node.kind}\`)`,
    `> **Matched Prefixes**:${include.length > 0 ? include.map((pattern) => `\`${pattern}\``).join("、") : "未宣告(`source.include` 缺失)"}`,
    `> **Local Contracts**:${localContracts.length > 0 ? localContracts.map((entry) => `\`${entry}\``).join("、") : "未宣告(`extensions.localContracts` 缺失)"}`,
    "> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與 Git 狀態投影生成,手改會在下次投影被覆蓋。",
    ...(node.summary ? ["", node.summary] : []),
    "",
    "## 1. P1:能力架構地圖",
    "",
    "### 1.1 架構圖",
    "",
    ...renderCapabilityArchitectureFlowchart(node, input.importGraph),
    "",
    "### 1.2 模組職責表",
    "",
    ...(entrypoints.length > 0
      ? [
        "| 宣告入口 | 錨點 | 職責 |",
        "| --- | --- | --- |",
        ...entrypoints.map((entry) => `| \`${entry}\` | \`${entry}\` | 尚未生成(需符號索引提供行錨點) |`)
      ]
      : ["- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。"]),
    "",
    "### 1.3 規模信號",
    "",
    ...(input.scaleSignal
      ? [
        `- 文件數:\`${input.scaleSignal.fileCount}\``,
        `- 總行數:\`${input.scaleSignal.lineCount}\``,
        `- 匹配前綴:${input.scaleSignal.includePatterns.map((pattern) => `\`${pattern}\``).join("、")}`,
        ...(input.scaleSignal.excludePatterns.length > 0
          ? [`- 排除前綴:${input.scaleSignal.excludePatterns.map((pattern) => `\`${pattern}\``).join("、")}`]
          : []),
        "- 復算:`archctx docs plan --json`(掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`)"
      ]
      : ["- 未宣告 `source.include`,規模信號無法推導。"]),
    "",
    "### 1.4 依賴邊界",
    "",
    "出向關係:",
    "",
    ...(outgoing.length === 0 ? ["- 無。"] : outgoing.map((relation) => `- \`${relation.kind}\` → \`${relation.target}\` — ${relation.intent}`)),
    "",
    "入向關係:",
    "",
    ...(incoming.length === 0 ? ["- 無。"] : incoming.map((relation) => `- \`${relation.kind}\` ← \`${relation.source}\` — ${relation.intent}`)),
    "",
    "## 2. P2:端到端數據流",
    "",
    ...renderCapabilityDataFlowSequence(node, input.callGraph)
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * `### 1.1` body. Every drawn edge is the directory projection of at least one real `imports`
 * edge the index resolved to an existing file, and every real cross-directory edge in the input
 * is drawn — nothing is inferred, ranked, or filled in. When the footprint or the index data is
 * missing the section states which one is missing instead of emitting an empty mermaid fence.
 */
function renderCapabilityArchitectureFlowchart(node: NativeNode, graph: CapabilityImportGraph | undefined): string[] {
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  const entrypoints = source?.entrypoints ?? [];
  if (include.length === 0) return ["尚未生成:未宣告 `source.include`,無法界定模組範圍,架構圖省略。"];
  if (!graph) return ["尚未生成:未取得倉庫匯入邊索引,架構圖省略——本版投影不輸出未經驗證的圖表。"];

  const footprint = new Set(graph.files);
  const entrypointDirectories = new Set(entrypoints.map(repoDirectoryOf));
  const drawnEdges = new Map<string, CapabilityImportEdge>();
  for (const edge of [...graph.edges].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to))) {
    const from = repoDirectoryOf(edge.from);
    const to = repoDirectoryOf(edge.to);
    if (from === to) continue;
    drawnEdges.set(`${from}\0${to}`, { from, to });
  }
  if (drawnEdges.size === 0) {
    return [`尚未生成:匯入邊索引在本能力的 \`${graph.files.length}\` 個檔案上未解析出跨目錄 \`import\` 邊,架構圖省略。`];
  }

  const directories = [...new Set([...drawnEdges.values()].flatMap((edge) => [edge.from, edge.to]))].sort();
  for (const directory of [...entrypointDirectories].sort()) {
    if (!directories.includes(directory)) directories.push(directory);
  }
  const idByDirectory = new Map(directories.map((directory) => [directory, mermaidPathId("cap", directory)]));
  const lines = [
    "```mermaid",
    "flowchart TD",
    ...directories.map((directory) => {
      const id = idByDirectory.get(directory)!;
      const label = escapeMermaidLabel(directory);
      if (entrypointDirectories.has(directory)) return `  ${id}(["${label}"])`;
      const inFootprint = [...footprint].some((file) => repoDirectoryOf(file) === directory);
      return inFootprint ? `  ${id}["${label}"]` : `  ${id}[["${label}"]]`;
    }),
    ...[...drawnEdges.values()]
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
      .map((edge) => `  ${idByDirectory.get(edge.from)!} --> ${idByDirectory.get(edge.to)!}`),
    "```",
    "",
    "- 圖例:`([...])` 宣告入口所在目錄、`[...]` 能力範圍內目錄、`[[...]]` 能力範圍外的匯入目標目錄。",
    `- 邊:倉庫匯入邊索引解析到真實檔案的 \`import\` 邊,按目錄聚合去重後 \`${drawnEdges.size}\` 條(檔案級原始邊 \`${graph.edges.length}\` 條);同目錄內部的匯入不畫。`,
    `- 節點:僅含參與上述邊的目錄與宣告入口所在目錄;能力範圍共 \`${graph.files.length}\` 個檔案。`,
    "- 不含呼叫關係:呼叫索引的軌跡混入型別引用,不作為 P1 邊來源。"
  ];
  if (graph.truncated) lines.push("- 注意:匯入邊索引本次查詢達到上限,邊集可能不完整。");
  return lines;
}

/**
 * `## 2` body. A candidate handshake diagram: participants are the machine-readable file paths,
 * messages are the index's call trail out of each declared entrypoint. The trail mixes real calls
 * with type references, so the section labels itself as semi-automatic instead of claiming a
 * verified data flow. A node that declares entrypoints without a call graph never reaches here —
 * `assertCapabilityEntrypointCallGraphs` already threw.
 */
function renderCapabilityDataFlowSequence(node: NativeNode, graph: CapabilityEntrypointCallGraph | undefined): string[] {
  const entrypoints = nativeNodeSource(node)?.entrypoints ?? [];
  if (entrypoints.length === 0) return ["尚未生成:未宣告 `source.entrypoints`,端到端握手圖省略。"];
  if (!graph) throw new Error(`architecture-docs-projection-call-graph-missing: ${node.id}`);

  const participants: string[] = [];
  const remember = (path: string) => {
    if (!participants.includes(path)) participants.push(path);
  };
  const messages = new Map<string, { from: string; to: string; label: string }>();
  for (const trace of graph.entrypoints) {
    remember(trace.path);
    for (const seed of trace.seeds) {
      for (const call of seed.calls) {
        remember(call.path);
        const label = `${seed.symbol} → ${call.symbol}()`;
        messages.set(`${trace.path}\0${call.path}\0${label}`, { from: trace.path, to: call.path, label });
      }
    }
  }
  if (messages.size === 0) {
    return [`尚未生成:呼叫索引未在 \`${entrypoints.length}\` 個宣告入口上取得呼叫軌跡,端到端握手圖省略。`];
  }

  const idByPath = new Map(participants.map((path) => [path, mermaidPathId("seq", path)]));
  const seedLines = graph.entrypoints.flatMap((trace) => [
    `- 入口 \`${trace.path}\`:種子符號 ${trace.seeds.length > 0
      ? trace.seeds.map((seed) => `\`${seed.symbol}\`${seed.line ? `(:${seed.line})` : ""}`).join("、")
      : "無(索引未回報頂層函式)"}${trace.seedsTruncated ? ";另有頂層函式超出種子預算未列入" : ""}`
  ]);
  const truncatedSeeds = graph.entrypoints.flatMap((trace) => trace.seeds.filter((seed) => seed.callsTruncated).map((seed) => `\`${seed.symbol}\``));
  return [
    "> **半自動生成的候選圖**:participant 名稱直接取機器可得的檔案路徑,本版無語義命名覆寫機制;呼叫索引的呼叫軌跡混入型別引用,可能多列或漏列。修訂意見寫在 §3,本區每次投影都會被覆寫。",
    "",
    "```mermaid",
    "sequenceDiagram",
    "  autonumber",
    ...participants.map((path) => `  participant ${idByPath.get(path)!} as ${escapeMermaidLabel(path)}`),
    ...[...messages.values()].map((message) => `  ${idByPath.get(message.from)!}->>${idByPath.get(message.to)!}: ${escapeMermaidLabel(message.label)}`),
    "```",
    "",
    ...seedLines,
    `- 訊息:\`${messages.size}\` 條,全部來自呼叫索引對種子符號回報的呼叫軌跡。`,
    "- 錯誤路徑:呼叫索引未提供 throw/error 分支資訊,本圖不列錯誤分支,也不編造。",
    ...(truncatedSeeds.length > 0 ? [`- 注意:${truncatedSeeds.join("、")} 的呼叫軌跡被索引截斷,訊息可能不完整。`] : [])
  ];
}

/** Directory of a repo-relative POSIX path; `.` for a file at the repository root. */
function repoDirectoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

/**
 * Collision-free mermaid node id for a repo path: readable slug plus a digest suffix, so `a/b`
 * and `a-b` never collapse onto the same node and the id never starts with a digit.
 */
function mermaidPathId(prefix: string, path: string): string {
  const slug = path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${slug === "" ? "root" : slug}_${digestJson(path as unknown as Json).slice(7, 15)}`;
}

/**
 * Single-pass mermaid label escape. `"` closes a quoted flowchart label; `#` and `;` delimit
 * entity codes; `,` terminates a sequence-diagram participant alias. One pass, so an escape
 * never re-enters the matcher.
 */
function escapeMermaidLabel(value: string): string {
  const codes: Record<string, string> = { "\"": "'", "#": "#35;", ";": "#59;", ",": "#44;" };
  return value.replace(/["#;,]/g, (char) => codes[char]);
}

/** `extensions.localContracts` as declared on the node; nothing is inferred from the file tree. */
function nodeLocalContracts(node: NativeNode): string[] {
  const value = node.extensions?.localContracts;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/**
 * Handoff title form `<domain>/<name>`: the node id with its `capability.` prefix dropped and the
 * remaining dotted segments joined by `/`. A single remaining segment is used on its own. The id is
 * used rather than `node.name` because the title is the document's stable address, and ids are the
 * only part of the model guaranteed to be unique and path-shaped.
 */
function entitySummaryTitle(node: NativeNode): string {
  const segments = node.id.replace(/^capability\./, "").split(".").filter((segment) => segment !== "");
  return segments.length > 0 ? segments.join("/") : node.id;
}

function entitySummarySkeleton(node: NativeNode): { prefix: string; suffix: string } {
  return {
    prefix: `# ${entitySummaryTitle(node)} 架構文檔\n\n`,
    suffix: [
      "",
      "## 3. P3:設計決策與不變量",
      "",
      "## 4. 歷史決策記錄(append-only)",
      "",
      "## Optimization Backlog",
      ""
    ].join("\n")
  };
}

function renderRelationSummary(relation: NativeRelation, model: NativeModel): string {
  const source = model.nodes.find((node) => node.id === relation.source);
  const target = model.nodes.find((node) => node.id === relation.target);
  const lines = [
    `# ${relation.source} -> ${relation.target}`,
    "",
    `- ID: \`${relation.id}\``,
    `- Kind: \`${relation.kind}\``,
    `- Source: \`${relation.source}\`${source ? ` (${source.name})` : ""}`,
    `- Target: \`${relation.target}\`${target ? ` (${target.name})` : ""}`,
    `- Intent: ${relation.intent}`
  ];
  return `${lines.join("\n")}\n`;
}

function renderDecisionIndex(decisions: ArchitectureDecisionRecord[]): string {
  const lines = [
    "# Architecture Decision Index",
    "",
    ...(decisions.length === 0
      ? ["- No ADRs selected for this projection."]
      : decisions.map((decision) => `- [${decision.title}](../../${decision.path})${decision.status ? ` — ${decision.status}` : ""}`))
  ];
  return `${lines.join("\n")}\n`;
}

function renderArchitectureChangelog(timeline: ArchitectureDocumentationTimelineEntry[]): string {
  const lines = [
    "# Architecture Changelog",
    "",
    ...(timeline.length === 0
      ? ["- No accepted architecture ledger events selected for this projection."]
      : timeline.map((entry) => {
        const affected = entry.affectedSubjects && entry.affectedSubjects.length > 0 ? ` (${entry.affectedSubjects.join(", ")})` : "";
        return `- ${entry.timestamp} — ${entry.title ?? entry.eventId}${affected}${entry.summary ? `: ${entry.summary}` : ""}`;
      }))
  ];
  return `${lines.join("\n")}\n`;
}

function wrapGeneratedRegion(target: ProjectionTargetV1, generatedBody: string): string {
  return [
    target.generatedRegion.startMarker,
    generatedBody.trimEnd(),
    target.generatedRegion.endMarker,
    ""
  ].join("\n");
}

function mergeGeneratedRegion(
  target: ProjectionTargetV1,
  wrapped: string,
  existing?: string,
  skeleton?: { prefix: string; suffix: string }
): string {
  if (!existing) return skeleton ? `${skeleton.prefix}${wrapped}${skeleton.suffix}` : wrapped;
  const region = findGeneratedRegion(existing, target.targetId);
  if (!region) {
    if (target.ownership === "mixed") {
      return `${existing.trimEnd()}\n\n${wrapped}`;
    }
    return wrapped;
  }
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

function architectureDocumentationProjectionDrift(input: {
  targets: ProjectionTargetV1[];
  expectedFiles: ArchitectureDocumentationProjectionFile[];
  expectedManifest: ArchitectureDocumentationExistingFile & { digest: string };
  existingFiles: ArchitectureDocumentationExistingFile[];
}): { ok: boolean; reasonCodes: ArchitectureDocumentationDriftReason[]; diffs: ArchitectureDocumentationProjectionDrift[] } {
  const existingByPath = new Map(input.existingFiles.map((file) => [file.path, file]));
  const expectedByPath = new Map(input.expectedFiles.map((file) => [file.path, file]));
  const targetIds = new Set(input.targets.map((target) => target.targetId));
  const diffs: ArchitectureDocumentationProjectionDrift[] = [];

  const existingManifest = existingByPath.get(input.expectedManifest.path);
  if (!existingManifest) {
    diffs.push({
      path: input.expectedManifest.path,
      reasonCode: "projection-manifest-missing",
      expectedDigest: input.expectedManifest.digest
    });
  } else {
    try {
      const parsed = JSON.parse(existingManifest.body) as Json;
      const actualDigest = digestJson(parsed);
      if (actualDigest !== input.expectedManifest.digest) {
        diffs.push({
          path: input.expectedManifest.path,
          reasonCode: "projection-manifest-stale",
          expectedDigest: input.expectedManifest.digest,
          actualDigest
        });
      }
    } catch {
      diffs.push({
        path: input.expectedManifest.path,
        reasonCode: "projection-manifest-invalid",
        expectedDigest: input.expectedManifest.digest,
        actualDigest: digestJson({ path: existingManifest.path, body: existingManifest.body } as unknown as Json)
      });
    }
  }

  for (const expected of input.expectedFiles) {
    const existing = existingByPath.get(expected.path);
    if (!existing) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-file-missing", expectedDigest: expected.digest });
      continue;
    }
    const region = findGeneratedRegion(existing.body, expected.target.targetId);
    if (!region) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: expected.target.ownership === "generated" ? "projection-ambiguous-ownership" : "projection-generated-region-missing",
        expectedDigest: expected.digest,
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
      continue;
    }
    const metadata = parseGeneratedRegionMetadata(region.startMarker);
    if (metadata.sourceDigest !== expected.target.sourceDigest || metadata.rendererVersion !== expected.target.rendererVersion) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-generated-region-stale", expectedDigest: expected.digest, actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json) });
      continue;
    }
    const actualGeneratedBodyDigest = digestJson({
      targetId: expected.target.targetId,
      body: `${region.body.trimEnd()}\n`
    } as unknown as Json);
    if (actualGeneratedBodyDigest !== metadata.outputDigest) {
      // The region body no longer digests to what its own marker records: someone edited machine text.
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-manually-edited",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
      continue;
    }
    if (metadata.outputDigest !== expected.generatedBodyDigest) {
      // Internally consistent, but not what this run renders. The only render input outside
      // `sourceDigest` is the sticky stamp, so this is a document awaiting re-verification — a
      // stale projection, not a hand edit.
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-stale",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
    }
  }

  for (const existing of input.existingFiles) {
    if (existing.path === input.expectedManifest.path) continue;
    if (!isManagedArchitectureDocumentationPath(existing.path) || expectedByPath.has(existing.path)) continue;
    const region = findAnyGeneratedRegion(existing.body);
    if (region && !targetIds.has(region.targetId)) {
      diffs.push({
        path: existing.path,
        targetId: region.targetId,
        reasonCode: "projection-orphaned",
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
    }
  }

  const reasonCodes = [...new Set(diffs.map((diff) => diff.reasonCode))].sort() as ArchitectureDocumentationDriftReason[];
  return { ok: diffs.length === 0, reasonCodes, diffs: diffs.sort((left, right) => left.path.localeCompare(right.path) || (left.targetId ?? "").localeCompare(right.targetId ?? "")) };
}

function findGeneratedRegion(body: string, targetId: string): { start: number; end: number; startMarker: string; body: string } | undefined {
  const startPattern = new RegExp(`<!-- BEGIN ARCHCONTEXT:generated target="${escapeRegExp(targetId)}"[^>]*-->`);
  const startMatch = startPattern.exec(body);
  if (!startMatch || startMatch.index === undefined) return undefined;
  const endMarker = generatedEndMarker(targetId);
  const endIndex = body.indexOf(endMarker, startMatch.index + startMatch[0].length);
  if (endIndex < 0) return undefined;
  const regionStart = startMatch.index;
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const generatedBody = body.slice(startMatch.index + startMatch[0].length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { start: regionStart, end: regionEnd, startMarker: startMatch[0], body: generatedBody };
}

function findAnyGeneratedRegion(body: string): { targetId: string } | undefined {
  const match = body.match(/<!-- BEGIN ARCHCONTEXT:generated target="([^"]+)"/);
  return match ? { targetId: match[1] } : undefined;
}

function parseGeneratedRegionMetadata(marker: string): {
  sourceDigest?: string;
  rendererVersion?: string;
  outputDigest?: string;
  verifiedAgainst?: string;
} {
  return {
    sourceDigest: marker.match(/sourceDigest="([^"]+)"/)?.[1],
    rendererVersion: marker.match(/rendererVersion="([^"]+)"/)?.[1],
    outputDigest: marker.match(/outputDigest="([^"]+)"/)?.[1],
    verifiedAgainst: marker.match(/verifiedAgainst="([^"]+)"/)?.[1]
  };
}

function generatedStartMarker(
  targetId: string,
  sourceDigest: string,
  rendererVersion: string,
  outputDigest: string,
  verifiedAgainst?: ArchitectureProjectionVerifiedAgainst
): string {
  const stamp = verifiedAgainst ? serializeMarkerVerifiedAgainst(verifiedAgainst) : undefined;
  return `${ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX} target="${targetId}" sourceDigest="${sourceDigest}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}"${stamp ? ` verifiedAgainst="${stamp}"` : ""} -->`;
}

/**
 * Marker encoding of the sticky stamp: `<branch>@<commit>@<committedAt>`. Neither a commit sha nor
 * an ISO timestamp can contain `@`, so the branch is recovered by taking everything before the last
 * two segments. A branch carrying `"` or `>` would break the HTML comment marker, so it is not
 * serialised at all: the target simply re-stamps on every render instead of writing a marker the
 * region scanner can no longer parse.
 */
function serializeMarkerVerifiedAgainst(value: ArchitectureProjectionVerifiedAgainst): string | undefined {
  const stamp = `${value.branch}@${value.commit}@${value.committedAt}`;
  return /["<>]/.test(stamp) ? undefined : stamp;
}

function parseMarkerVerifiedAgainst(value: string | undefined): ArchitectureProjectionVerifiedAgainst | undefined {
  if (!value) return undefined;
  const parts = value.split("@");
  if (parts.length < 3) return undefined;
  try {
    return assertArchitectureProjectionVerifiedAgainst({
      branch: parts.slice(0, -2).join("@"),
      commit: parts[parts.length - 2],
      committedAt: parts[parts.length - 1]
    });
  } catch {
    return undefined;
  }
}

type StickyVerifiedAgainstDecision =
  | { kind: "reuse"; verifiedAgainst: ArchitectureProjectionVerifiedAgainst }
  | { kind: "restamp" }
  | { kind: "restamp-unmeasured"; stampedCommit: string; detail: string };

/**
 * Decides whether an entity-summary target keeps the stamp its existing region already carries.
 * `verifiedAgainst` records *when this content was last generated or verified*, not the HEAD that
 * happened to be checked out during a re-render, so an unchanged document keeps its stamp and the
 * projection reaches a fixed point instead of invalidating itself on every commit.
 *
 * A stamp sticks when **both** hold:
 *
 * 1. The region was rendered from the inputs this run computed (`entitySourceDigest` matches, so
 *    the body would be byte-identical), and
 * 2. no file inside the node's declared `source.include` footprint changed after the stamped
 *    commit — as measured by the caller.
 *
 * Condition 2 is what keeps the stamp honest. A covered source edit that changes no rendered
 * assertion (same line count, same files, same import edges) leaves the digest identical, so
 * condition 1 alone would pin the stamp to a commit the document was never re-verified against —
 * and the freshness gate would then be impossible to clear by re-projecting. Re-stamping there is
 * truthful: this render did read the current tree.
 *
 * An unmeasurable range (the stamped commit is not in this repository — a rebase, a shallow clone)
 * re-stamps and reports a notice rather than failing: a hard failure would make `docs apply`
 * permanently unrunnable after a rebase, which is a worse deadlock than the one being fixed.
 * A missing or malformed stamp re-stamps silently; it never throws and never lets an unparseable
 * value reach the rendered prose.
 */
function stickyVerifiedAgainst(
  existing: string | undefined,
  targetId: string,
  entitySourceDigest: string,
  node: { nodeDeclaresSource: boolean; measurement: CapabilitySourceChangeSinceStamp | undefined }
): StickyVerifiedAgainstDecision {
  if (!existing) return { kind: "restamp" };
  const region = findGeneratedRegion(existing, targetId);
  if (!region) return { kind: "restamp" };
  const metadata = parseGeneratedRegionMetadata(region.startMarker);
  if (metadata.sourceDigest !== entitySourceDigest) return { kind: "restamp" };
  const stamp = parseMarkerVerifiedAgainst(metadata.verifiedAgainst);
  if (!stamp) return { kind: "restamp" };
  // A node that declares no source footprint has nothing that can change under it, so its stamp
  // sticks without a measurement — the caller has nothing to measure.
  if (!node.nodeDeclaresSource) return { kind: "reuse", verifiedAgainst: stamp };
  const measurement = node.measurement;
  if (!measurement) {
    return {
      kind: "restamp-unmeasured",
      stampedCommit: stamp.commit,
      detail: `no changed-path measurement was supplied for the commit this document is stamped with (${stamp.commit}); re-stamping with the current ref`
    };
  }
  if (measurement.commit !== stamp.commit) {
    return {
      kind: "restamp-unmeasured",
      stampedCommit: stamp.commit,
      detail: `changed paths were measured against ${measurement.commit} but this document is stamped with ${stamp.commit}; re-stamping with the current ref`
    };
  }
  if (measurement.status === "unmeasurable") {
    return {
      kind: "restamp-unmeasured",
      stampedCommit: stamp.commit,
      detail: `changed paths since ${stamp.commit} could not be measured (${measurement.reason}); re-stamping with the current ref`
    };
  }
  if (measurement.status === "changed") return { kind: "restamp" };
  return { kind: "reuse", verifiedAgainst: stamp };
}

function generatedEndMarker(targetId: string): string {
  return `${ARCHITECTURE_DOCS_GENERATED_END_PREFIX} target="${targetId}" -->`;
}

function isManagedArchitectureDocumentationPath(path: string): boolean {
  return /^docs\/architecture\/(modules|relations)\/.+\.md$/.test(path)
    || /^docs\/architecture\/diagrams\/architecture\.(mmd|likec4|structurizr\.json)$/.test(path)
    || path === "docs/architecture/index.md"
    || path === "docs/architecture/changelog.md"
    || path === "docs/architecture/decisions/index.md"
    || path === "docs/architecture/.projection-manifest.json";
}

function pathSegment(id: string): string {
  return stableId(id).replace(/\./g, "-");
}

function documentationLikeC4Kind(kind: string): string {
  if (kind === "external-system") return "external_system";
  if (kind === "datastore") return "datastore";
  if (["capability", "module", "component", "interface"].includes(kind)) return kind;
  return "component";
}

function documentationStructurizrElementType(kind: string): "Software System" | "Container" | "Component" | "Database" | "External System" {
  if (kind === "capability") return "Software System";
  if (kind === "module") return "Container";
  if (kind === "datastore") return "Database";
  if (kind === "external-system") return "External System";
  return "Component";
}

function escapeDsl(value: string): string {
  return value.replace(/"/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Agent Context Provider (ADR-0043) ---
//
// Projects one capability node's identity/source/extensions into a marker-owned region
// inside that capability's own primary source directory (CLAUDE.md and AGENTS.md).
// `type: "agent-context"` is a new `ProjectionTarget` target type (see
// schemas/runtime/projection-target.schema.json); the shape below intentionally does not
// import the strict `ProjectionTargetV1`/`ProjectionTargetType` TS union from
// @archcontext/contracts, whose `packages/contracts/src` is out of scope for this change.

export const AGENT_CONTEXT_RENDERER_VERSION = CONTRACT_AGENT_CONTEXT_RENDERER_VERSION;
export const AGENT_CONTEXT_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT AGENT CONTEXT";
export const AGENT_CONTEXT_END_PREFIX = "<!-- END ARCHCONTEXT AGENT CONTEXT";

const AGENT_CONTEXT_FILE_NAMES = [
  { fileName: "CLAUDE.md", slug: "claude" },
  { fileName: "AGENTS.md", slug: "agents" }
] as const;

export interface AgentContextProjectionTargetScope {
  kind: "entity";
  id: string;
  entityKind: string;
}

export interface AgentContextProjectionTarget {
  schemaVersion: typeof PROJECTION_TARGET_SCHEMA_VERSION;
  targetId: string;
  type: "agent-context";
  scope: AgentContextProjectionTargetScope;
  path: string;
  ownership: "mixed";
  generatedRegion: { startMarker: string; endMarker: string };
  rendererVersion: string;
  format: "markdown";
  sourceDigest: string;
  outputDigest: string;
}

export interface AgentContextProjectionFile {
  path: string;
  body: string;
  targets: AgentContextProjectionTarget[];
}

export interface AgentContextProjectionPlan {
  schemaVersion: "archcontext.agent-context-projection-plan/v1";
  rendererVersion: typeof AGENT_CONTEXT_RENDERER_VERSION;
  sourceDigest: string;
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
  const wildcardIndex = pattern.search(/[*?]/);
  const literalPrefix = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const lastSlash = literalPrefix.lastIndexOf("/");
  return lastSlash === -1 ? "." : literalPrefix.slice(0, lastSlash);
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
 * than projected: the root `CLAUDE.md`/`AGENTS.md` are the human-authored routing contract, and no
 * derivation may put them on the machine write surface.
 */
export function agentContextProjectionTargetPaths(model: NativeModel): AgentContextProjectionTargetPath[] {
  const out: AgentContextProjectionTargetPath[] = [];
  for (const node of [...model.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    if (node.kind !== "capability") continue;
    const firstInclude = nativeNodeSource(node)?.include?.[0];
    if (!firstInclude) continue;
    const primarySourceDir = primarySourceDirectoryFromInclude(firstInclude);
    if (primarySourceDir === ".") {
      throw new Error(`agent-context-primary-source-dir-is-repository-root: ${node.id}`);
    }
    for (const { fileName } of AGENT_CONTEXT_FILE_NAMES) {
      out.push({ nodeId: node.id, primarySourceDir, path: `${primarySourceDir}/${fileName}` });
    }
  }
  return out;
}

/** Reads back whatever already exists at the derived agent-context target paths. */
export function loadAgentContextProjectionFiles(root: string, model: NativeModel): ArchitectureDocumentationExistingFile[] {
  const paths = [...new Set(agentContextProjectionTargetPaths(model).map((target) => target.path))]
    .sort((left, right) => left.localeCompare(right));
  return paths
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({ path, body: readFileSync(resolve(root, path), "utf8") }));
}

export function renderAgentContextProjection(input: {
  model: NativeModel;
  sourceDigest: string;
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
    const outputDigest = digestJson({ id: node.id, body: generatedBody } as unknown as Json);

    for (const { path } of derivedPaths) {
      const slug = agentContextSlugForPath(path);
      const target: AgentContextProjectionTarget = {
        schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
        targetId: `projection_target.agent-context.${slug}.${stableId(node.id)}`,
        type: "agent-context",
        scope: { kind: "entity", id: node.id, entityKind: node.kind },
        path,
        ownership: "mixed",
        generatedRegion: {
          startMarker: agentContextStartMarker(node.id, input.sourceDigest, rendererVersion, outputDigest),
          endMarker: agentContextEndMarker(node.id)
        },
        rendererVersion,
        format: "markdown",
        sourceDigest: input.sourceDigest,
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
    sourceDigest: input.sourceDigest,
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

/** Target-id slug for a derived agent-context path, keyed off its file name. */
function agentContextSlugForPath(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const entry = AGENT_CONTEXT_FILE_NAMES.find((candidate) => candidate.fileName === fileName);
  if (!entry) throw new Error(`agent-context-unknown-target-file: ${path}`);
  return entry.slug;
}

function agentContextStartMarker(nodeId: string, sourceDigest: string, rendererVersion: string, outputDigest: string): string {
  return `${AGENT_CONTEXT_BEGIN_PREFIX} id="${nodeId}" sourceDigest="${sourceDigest}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
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
  if (!region) return `${existing.trimEnd()}\n\n${wrapped}`;
  const markerDigest = /\boutputDigest="([^"]+)"/.exec(region.startMarker)?.[1];
  if (!markerDigest) {
    throw new Error(`agent-context-marker-output-digest-missing: ${target.path} (node ${target.scope.id})`);
  }
  const generatedBody = `${existing.slice(region.contentStart, region.contentEnd).trimEnd()}\n`;
  const actualDigest = digestJson({ id: target.scope.id, body: generatedBody } as unknown as Json);
  if (markerDigest !== actualDigest) {
    throw new Error(
      `agent-context-marker-output-digest-mismatch: ${target.path} (node ${target.scope.id}; marker records ${markerDigest}, region body digests to ${actualDigest})`
    );
  }
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

function findAgentContextRegion(body: string, nodeId: string): {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  startMarker: string;
} | undefined {
  const startPattern = new RegExp(`<!-- BEGIN ARCHCONTEXT AGENT CONTEXT id="${escapeRegExp(nodeId)}"[^>]*-->`);
  const startMatch = startPattern.exec(body);
  if (!startMatch || startMatch.index === undefined) return undefined;
  const endMarker = agentContextEndMarker(nodeId);
  const endIndex = body.indexOf(endMarker, startMatch.index + startMatch[0].length);
  if (endIndex < 0) return undefined;
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const afterMarker = startMatch.index + startMatch[0].length;
  const contentStart = afterMarker + (body[afterMarker] === "\n" ? 1 : 0);
  return {
    start: startMatch.index,
    end: regionEnd,
    contentStart,
    contentEnd: endIndex,
    startMarker: startMatch[0]
  };
}

// --- Path Ownership Resolution (ADR-0043 tie-break) ---
//
// Single implementation of the ADR-0043 tie-break: apply `source.exclude` first, then the
// most-specific (longest literal prefix) matching `source.include` wins, and an equal-
// specificity tie is rejected as ambiguous. `archctx resolve --path`
// (packages/surfaces/cli/src/main.ts) is the only caller today; a future repo-harness
// adapter is expected to call the CLI rather than re-deriving this glob semantics.

export type ResolveArchitectureOwnerResult =
  | { status: "matched"; node: NativeNode }
  | { status: "no-match" }
  | { status: "ambiguous"; candidates: NativeNode[] };

export function resolveArchitectureOwnerForPath(nodes: NativeNode[], path: string): ResolveArchitectureOwnerResult {
  const candidates: { node: NativeNode; specificity: number }[] = [];
  for (const node of nodes) {
    const source = nativeNodeSource(node);
    const include = source?.include ?? [];
    if (include.length === 0) continue;
    const excluded = (source?.exclude ?? []).some((pattern) => matchesGlob(path, pattern));
    if (excluded) continue;
    const specificity = include
      .filter((pattern) => matchesGlob(path, pattern))
      .reduce((max, pattern) => Math.max(max, globLiteralPrefixLength(pattern)), -1);
    if (specificity >= 0) candidates.push({ node, specificity });
  }
  if (candidates.length === 0) return { status: "no-match" };
  const maxSpecificity = candidates.reduce((max, candidate) => Math.max(max, candidate.specificity), -1);
  const winners = candidates.filter((candidate) => candidate.specificity === maxSpecificity).map((candidate) => candidate.node);
  if (winners.length > 1) return { status: "ambiguous", candidates: winners };
  return { status: "matched", node: winners[0] };
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

/** Length of the glob's literal prefix (before its first `*`/`?`); used as the ADR-0043 specificity score. */
export function globLiteralPrefixLength(pattern: string): number {
  const index = pattern.search(/[*?]/);
  return index === -1 ? pattern.length : index;
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      out += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      out += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index];
    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(char);
    }
    index += 1;
  }
  return new RegExp(`^${out}$`);
}
