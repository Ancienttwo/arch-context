import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION, pinnedCodeGraphProvider, withCodeGraphReadSession, type CodeGraphReadProvider, type CodeGraphReadSession } from "./read-session";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  architectureDocumentationProjectionWorktreeDigest,
  digestArchitectureDocumentationSourceTree,
  loadCapabilitySourceFootprints,
  type CapabilitySourceFootprint,
  type ArchitectureDocumentationProjectionRuntimeSnapshot,
  type NativeModel
} from "@archcontext/core/projection-engine";
import { digestJson, type ArchitectureDocumentationProjectionProvenanceV3, type Json } from "@archcontext/contracts";
import { codeGraphSyncInvocation, digestFile, packagedCodeGraphRuntimeDigest, syncCodeGraphIndex } from "./cli-invocation";
import { assertRepositoryCodeFactsReady, codeGraphIndexAvailable, type RepositoryCodeFactsV1 } from "./repository-code-facts";
import { codeFactsReadinessAfterRead } from "./ready-index-read";
import { loadCapabilityCodeGraphProjectionInputs, type CapabilityCodeGraphProjectionInputs } from "./selector-index";

// --- Capability documentation projection measurements and exact semantic bindings ---
//
// The projection's code-facts handshake. It exists so the documentation projection stays a pure
// function in @archcontext/core: `codegraph sync` and the read-only session live here, the renderer
// only receives measured facts. Import graphs remain diagnostic measurements;
// exact node-v2 selectors are the only CodeGraph facts that can bind a semantic flow step.

export interface CodeGraphProjectionHandshakeV1 {
  schemaVersion: "archcontext.codegraph-projection-handshake/v1";
  packageName: typeof REQUIRED_CODEGRAPH_PACKAGE;
  requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
  actualVersion: string;
  binaryDigest: string;
  availability: "ready" | "unavailable";
  reasonCode?: "index-missing";
  /** Binds the source tree to the index state the projection read; `null` when no index answered. */
  indexedWorktreeDigest: string | null;
  /**
   * Digest of the CodeGraph version and the code evidence this handshake read (import graphs,
   * selector evidence). It excludes the binary digest and the index status, which differ per
   * machine and per index build, so re-indexing an unchanged tree never moves it.
   */
  graphDigest: string;
}

export interface PreparedProjectionCodeFacts extends CapabilityCodeGraphProjectionInputs {
  handshake: CodeGraphProjectionHandshakeV1;
}

export interface PreparedArchitectureDocumentationProjectionSnapshot extends PreparedProjectionCodeFacts {
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  /** HEAD, worktree and CodeGraph state this snapshot read; runtime receipts only, never committed. */
  runtimeSnapshot: ArchitectureDocumentationProjectionRuntimeSnapshot;
  /**
   * The Git-visible files (`listGitVisibleFiles`) this snapshot measured footprints over.
   * Callers stamp footprints and scale signals from this same list, so every digest of one run
   * agrees on which files exist.
   */
  sourceFiles: string[];
  /**
   * `loadCapabilitySourceFootprints` over `sourceFiles`, resolved once for the whole snapshot. The
   * source tree digest and the import graphs read it, and callers stamp footprint digests and scale
   * signals from it, so one build matches the globs once (#324).
   */
  footprints: CapabilitySourceFootprint[];
}

/** Single snapshot assembly shared by CLI, daemon completion gates, and verification tests. */
export function prepareArchitectureDocumentationProjectionSnapshot(
  root: string,
  model: NativeModel,
  options: {
    binary?: string;
    importNodeLimit?: number;
    timeouts?: { syncMs?: number };
    /** The read-only provider every index read goes through; the pinned one unless injected. */
    readProvider?: CodeGraphReadProvider;
    /** See `prepareProjectionCodeFacts`: this command already ran `codegraph sync` on `root` (#584). */
    indexSynced?: boolean;
  } = {}
): PreparedArchitectureDocumentationProjectionSnapshot {
  const baseHeadSha = readProjectionHeadSha(root);
  const sourceFiles = listGitVisibleFiles(root);
  const worktreeDigest = architectureDocumentationProjectionWorktreeDigest(root, model, sourceFiles);
  const footprints = loadCapabilitySourceFootprints(root, model, sourceFiles);
  const sourceTreeDigest = digestArchitectureDocumentationSourceTree(root, model, footprints);
  const modelDigest = digestJson(model as unknown as Json);
  const prepared = prepareProjectionCodeFacts(root, model, { ...options, sourceTreeDigest, sourceFiles, footprints });
  if (architectureDocumentationProjectionWorktreeDigest(root, model, listGitVisibleFiles(root)) !== worktreeDigest) {
    throw new Error("architecture-docs-projection-worktree-changed-during-codegraph-sync");
  }
  const provenance = architectureDocumentationProjectionProvenance({
    sourceTreeDigest,
    modelDigest,
    rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
    layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
    generatedFrom: {
      codeGraphPackage: prepared.handshake.packageName,
      codeGraphVersion: prepared.handshake.actualVersion
    }
  });
  return {
    ...prepared,
    provenance,
    runtimeSnapshot: {
      headSha: baseHeadSha,
      worktreeDigest,
      codeGraphDigest: prepared.handshake.graphDigest,
      indexedWorktreeDigest: prepared.handshake.indexedWorktreeDigest,
      codeGraphStatus: prepared.handshake.availability
    },
    sourceFiles,
    footprints
  };
}

/**
 * Thrown when `.archcontext/manifest.yaml` declares `codeFacts.required: true` and the projection
 * snapshot has no code facts. Without them every selector is unproven, so the major-change
 * classifier would report a flow-proof change for every capability; an environment failure must not
 * read as an architecture change. Surfaces map it to `AC_CODE_FACTS_UNAVAILABLE`.
 */
export class ProjectionCodeFactsUnavailableError extends Error {
  readonly code = "AC_CODE_FACTS_UNAVAILABLE" as const;
  constructor(readonly reasonCode: NonNullable<CodeGraphProjectionHandshakeV1["reasonCode"]>) {
    super(`code facts are required by .archcontext/manifest.yaml but unavailable (${reasonCode}); run \`codegraph init\` and retry`);
    this.name = "ProjectionCodeFactsUnavailableError";
  }
}

/** `codeFacts.required` from `.archcontext/manifest.yaml`; only an explicit `true` requires them. */
export function projectionCodeFactsRequired(root: string): boolean {
  const path = join(root, ".archcontext/manifest.yaml");
  if (!existsSync(path)) return false;
  let manifest: Json;
  try {
    manifest = parseJsonOrStableYaml(readFileSync(path, "utf8"), ".archcontext/manifest.yaml");
  } catch {
    // Manifest shape is validated by `archctx validate`; an unreadable file declares nothing here.
    return false;
  }
  const codeFacts = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.codeFacts : undefined;
  return !!codeFacts && typeof codeFacts === "object" && !Array.isArray(codeFacts) && codeFacts.required === true;
}

/**
 * Projection gate for required code facts. Runs before the snapshot reaches the renderer, so a
 * missing index never classifies a major change, writes an acceptance candidate or emits a refresh
 * signal.
 */
export function assertProjectionCodeFactsAvailable(root: string, prepared: PreparedProjectionCodeFacts): void {
  if (prepared.handshake.availability === "ready" || !projectionCodeFactsRequired(root)) return;
  throw new ProjectionCodeFactsUnavailableError(prepared.handshake.reasonCode ?? "index-missing");
}

/**
 * Freezes the CodeGraph proof used by one docs projection (ADR-0058). The version is the loaded
 * provider bundle's; every index fact comes from read-only sessions; `codegraph sync` is the only
 * CodeGraph process it starts. A missing index is an explicit unavailable state; an existing but
 * incompatible index is a typed refusal before the sync, and an index that is stale after the sync,
 * or moves while the projection reads it, is an error and cannot produce verified facts.
 */
export function prepareProjectionCodeFacts(
  root: string,
  model: NativeModel,
  options: {
    sourceTreeDigest: string;
    /** The Git-visible files (`listGitVisibleFiles`); read from `root` when omitted. */
    sourceFiles?: readonly string[];
    /** Footprints resolved over the Git-visible files; resolved from `root` when omitted. */
    footprints?: readonly CapabilitySourceFootprint[];
    /** The CodeGraph CLI that runs `sync`; the packaged one when omitted. It is never read. */
    binary?: string;
    /** The read-only provider every index read goes through; the pinned one unless injected. */
    readProvider?: CodeGraphReadProvider;
    importNodeLimit?: number;
    timeouts?: { syncMs?: number };
    /** `false` reads selector evidence only (`flows check`); a projection always reads both. */
    importGraphs?: boolean;
    /**
     * True when this command already ran `codegraph sync` on `root` (#584): the handshake starts no
     * second sync. The post-read freshness proof still runs, so an index behind the worktree fails
     * closed.
     * Nothing is cached across commands.
     */
    indexSynced?: boolean;
  }
): PreparedProjectionCodeFacts {
  const provider = options.readProvider ?? pinnedCodeGraphProvider();
  const actualVersion = provider.version;
  if (actualVersion !== REQUIRED_CODEGRAPH_VERSION) {
    throw new Error(`CodeGraph ${REQUIRED_CODEGRAPH_VERSION} required, got loaded provider ${actualVersion || "unknown"}`);
  }
  // Taken after the sync, so a binary that cannot start fails as a sync with its diagnostics.
  const binaryDigest = () => options.binary
    ? digestFile(codeGraphSyncInvocation(root, options.binary).argsPrefix[0] ?? options.binary)
    : packagedCodeGraphRuntimeDigest();
  if (!codeGraphIndexAvailable(root)) {
    const graphDigest = digestJson({
      schemaVersion: "archcontext.codegraph-projection-handshake/v1",
      actualVersion,
      availability: "unavailable",
      reasonCode: "index-missing"
    } as unknown as Json);
    return {
      importGraphs: [],
      selectorEvidence: [],
      handshake: {
        schemaVersion: "archcontext.codegraph-projection-handshake/v1",
        packageName: REQUIRED_CODEGRAPH_PACKAGE,
        requiredVersion: REQUIRED_CODEGRAPH_VERSION,
        actualVersion,
        binaryDigest: binaryDigest(),
        availability: "unavailable",
        reasonCode: "index-missing",
        indexedWorktreeDigest: null,
        graphDigest
      }
    };
  }

  // A present but incompatible index is a typed refusal before any sync. Freshness is proven once,
  // after the reads: a fresh change test, then an unchanged revision of the reading session.
  assertRepositoryCodeFactsReady(root, { provider });
  if (!options.indexSynced) {
    syncCodeGraphIndex(root, { ...(options.binary ? { binary: options.binary } : {}), timeoutMs: options.timeouts?.syncMs ?? 120_000 });
  }
  const { indexDigest, inputs } = withProjectionIndexSession(root, provider, (session) => {
    const digest = projectionIndexStateDigest(session);
    const read = loadCapabilityCodeGraphProjectionInputs(root, model, {
      ...(options.sourceFiles ? { sourceFiles: options.sourceFiles } : {}),
      ...(options.footprints ? { footprints: options.footprints } : {}),
      provider,
      importNodeLimit: options.importNodeLimit,
      ...(options.importGraphs === false ? { importGraphs: false } : {})
    });
    const after = codeFactsReadinessAfterRead(root, session, provider);
    if (after?.moved) throw new Error("CodeGraph indexed snapshot changed during projection queries");
    if (after) throw projectionIndexNotReady(after.facts);
    return { indexDigest: digest, inputs: read };
  });
  const indexedWorktreeDigest = digestJson({
    sourceTreeDigest: options.sourceTreeDigest,
    statusDigest: indexDigest
  } as unknown as Json);
  const graphDigest = digestJson({
    actualVersion,
    importGraphs: inputs.importGraphs,
    selectorEvidence: inputs.selectorEvidence
  } as unknown as Json);
  return {
    ...inputs,
    handshake: {
      schemaVersion: "archcontext.codegraph-projection-handshake/v1",
      packageName: REQUIRED_CODEGRAPH_PACKAGE,
      requiredVersion: REQUIRED_CODEGRAPH_VERSION,
      actualVersion,
      binaryDigest: binaryDigest(),
      availability: "ready",
      indexedWorktreeDigest,
      graphDigest
    }
  };
}

function projectionIndexNotReady(facts: RepositoryCodeFactsV1): Error {
  if (facts.state === "unavailable" || facts.state === "index-missing") {
    return new Error(`CodeGraph post-query index is not ready: ${facts.state === "unavailable" ? facts.reasonCode : "index-missing"}`);
  }
  if (facts.issues.some((issue) => issue.code === "pending-source-changes")) return new Error("CodeGraph post-query index still has pending source changes");
  return new Error(`CodeGraph post-query index is not ready: ${facts.issues.map((issue) => issue.code).join(", ")}`);
}

/** Runs `read` on a read-only session; an index the session cannot open fails the handshake. */
function withProjectionIndexSession<T>(root: string, provider: CodeGraphReadProvider, read: (session: CodeGraphReadSession) => T): T {
  return withCodeGraphReadSession(root, (opened) => {
    if (opened.state === "build-in-progress") throw new Error("CodeGraph index build is in progress");
    if (opened.state !== "open") throw new Error(`CodeGraph index could not be read: ${opened.state}`);
    return read(opened.session);
  }, { provider });
}

/**
 * The index state a projection binds to: its compatibility facts and its revision. The project
 * path enters as a digest, so the value does not carry an absolute path.
 */
function projectionIndexStateDigest(session: CodeGraphReadSession): string {
  const { projectPath, ...compatibility } = session.compatibility();
  return digestJson({
    ...compatibility,
    projectPathDigest: digestJson(realpathSync.native(projectPath) as unknown as Json),
    revision: session.revision()
  } as unknown as Json);
}

function readProjectionHeadSha(root: string): string {
  try {
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error("HEAD is not a full commit SHA");
    return headSha;
  } catch (error) {
    throw new Error(`Architecture projection HEAD is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
