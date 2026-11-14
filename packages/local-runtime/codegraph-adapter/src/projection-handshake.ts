import { CODE_FACTS_ISSUE_MESSAGES } from "@archcontext/contracts";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { codeGraphChildEnv } from "./child-env";
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
import {
  CODEGRAPH_OUTPUT_MAX_BYTES,
  codeGraphCliInvocation,
  digestFile,
  disableCodeGraphTelemetryByDefault,
  packagedCodeGraphCliInvocation,
  packagedCodeGraphRuntimeDigest,
  type CodeGraphCliInvocation
} from "./cli-provider";
import { assertRepositoryCodeFactsReady, codeGraphIndexAvailable, inspectRepositoryCodeFacts } from "./repository-code-facts";
import { loadCapabilityCodeGraphProjectionInputs, type CapabilityCodeGraphProjectionInputs } from "./selector-index";

// --- Capability documentation projection measurements and exact semantic bindings ---
//
// The projection's code-facts handshake. It exists so the documentation projection stays a pure
// function in @archcontext/core: `codegraph sync` and the read-only session live here, the renderer
// only receives measured facts. Import graphs remain diagnostic measurements;
// exact node-v2 selectors are the only CodeGraph facts that can bind a semantic flow step.

/** The compatibility and freshness facts of an index, as a read session reports them (ADR-0058). */
export interface CodeGraphProjectionStatusV1 {
  initialized: boolean;
  version: string;
  projectPath: string;
  lastIndexed: string | null;
  pendingChanges?: { added: number; modified: number; removed: number };
  worktreeMismatch?: unknown;
  index?: {
    builtWithVersion?: string;
    builtWithExtractionVersion?: number;
    currentExtractionVersion?: number;
    reindexRecommended?: boolean;
    state?: string;
    pendingRefs?: number;
  };
}

export interface CodeGraphProjectionHandshakeV1 {
  schemaVersion: "archcontext.codegraph-projection-handshake/v1";
  packageName: typeof REQUIRED_CODEGRAPH_PACKAGE;
  requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
  actualVersion: string;
  binaryDigest: string;
  availability: "ready" | "unavailable";
  reasonCode?: "index-missing";
  preSyncStatusDigest: string | null;
  postSyncStatusDigest: string | null;
  syncDigest: string | null;
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
     * second sync. The post-sync checks still run, so an index behind the worktree fails closed.
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
    ? digestFile(codeGraphCliInvocation(options.binary, root, "").argsPrefix[0] ?? options.binary)
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
        preSyncStatusDigest: null,
        postSyncStatusDigest: null,
        syncDigest: null,
        indexedWorktreeDigest: null,
        graphDigest
      }
    };
  }

  // A present but incompatible index is a typed refusal before any sync; pending source changes
  // are accepted here and cleared by the sync.
  assertRepositoryCodeFactsReady(root, { provider });
  let preDigest: string | undefined;
  if (!options.indexSynced) {
    preDigest = withProjectionIndexSession(root, provider, projectionIndexStateDigest);
    const invocation = options.binary ? codeGraphCliInvocation(options.binary, root, "") : packagedCodeGraphCliInvocation();
    runProjectionCodeGraph(invocation, root, ["sync", root, "--quiet"], options.timeouts?.syncMs ?? 120_000);
  }
  const { postDigest, inputs } = withProjectionIndexSession(root, provider, (session) => {
    const digest = projectionIndexStateDigest(session);
    const facts = inspectRepositoryCodeFacts(root, { provider });
    if (facts.state !== "ready") {
      const issues = facts.state === "unavailable" ? [] : facts.issues;
      if (issues.some((issue) => issue.code === "pending-source-changes")) throw new Error("CodeGraph post-sync index still has pending source changes");
      throw new Error(`CodeGraph post-sync index is not ready: ${facts.state === "unavailable" ? facts.reasonCode : issues.map((issue) => issue.code).join(", ")}`);
    }
    const read = loadCapabilityCodeGraphProjectionInputs(root, model, {
      ...(options.sourceFiles ? { sourceFiles: options.sourceFiles } : {}),
      ...(options.footprints ? { footprints: options.footprints } : {}),
      provider,
      importNodeLimit: options.importNodeLimit,
      ...(options.importGraphs === false ? { importGraphs: false } : {})
    });
    // Facts read across a sync or a build are not one index state (design G4).
    if (!session.unchangedSinceOpen()) throw new Error("CodeGraph indexed snapshot changed during projection queries");
    return { postDigest: digest, inputs: read };
  });
  // With the command's own sync reused there is no earlier observation; pre equals post then.
  const pre = preDigest ?? postDigest;
  const indexedWorktreeDigest = digestJson({
    sourceTreeDigest: options.sourceTreeDigest,
    statusDigest: postDigest
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
      preSyncStatusDigest: pre,
      postSyncStatusDigest: postDigest,
      syncDigest: digestJson({ preSyncStatusDigest: pre, postSyncStatusDigest: postDigest } as unknown as Json),
      indexedWorktreeDigest,
      graphDigest
    }
  };
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

export type ProjectionCodeGraphStatusIssueCode =
  | "not-initialized"
  | "version-mismatch"
  | "project-path-mismatch"
  | "index-incomplete"
  | "extraction-version-mismatch"
  | "worktree-mismatch"
  | "pending-source-changes";

export interface ProjectionCodeGraphStatusIssueV1 {
  code: ProjectionCodeGraphStatusIssueCode;
  /** The text a reader reports for this issue. */
  message: string;
}

/**
 * Pure evaluation of one index status snapshot against the projection contract. It
 * returns every issue in evaluation order; an uninitialized index returns only that issue because
 * the remaining fields carry no meaning then.
 */
export function projectionCodeGraphStatusIssues(
  status: CodeGraphProjectionStatusV1,
  root: string,
  phase: string
): ProjectionCodeGraphStatusIssueV1[] {
  const issue = (code: ProjectionCodeGraphStatusIssueCode, text: string): ProjectionCodeGraphStatusIssueV1 => ({
    code,
    message: phase === "repository" ? CODE_FACTS_ISSUE_MESSAGES[code] : `CodeGraph ${phase} ${text}`
  });
  if (!status.initialized) return [issue("not-initialized", "status is not initialized")];
  const issues: ProjectionCodeGraphStatusIssueV1[] = [];
  if (status.version !== REQUIRED_CODEGRAPH_VERSION || status.index?.builtWithVersion !== REQUIRED_CODEGRAPH_VERSION) {
    issues.push(issue("version-mismatch", "status version mismatch"));
  }
  if (!sameRealPath(status.projectPath, root)) issues.push(issue("project-path-mismatch", "project path mismatch"));
  if (status.index?.state !== "complete" || status.index.reindexRecommended !== false || status.index.pendingRefs !== 0) {
    issues.push(issue("index-incomplete", "index is not complete and compatible"));
  } else if (status.index.builtWithExtractionVersion !== status.index.currentExtractionVersion) {
    issues.push(issue("extraction-version-mismatch", "extraction version mismatch"));
  }
  if (status.worktreeMismatch !== null) issues.push(issue("worktree-mismatch", "worktree mismatch"));
  return issues;
}

function sameRealPath(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  try {
    return realpathSync.native(left) === realpathSync.native(right);
  } catch {
    return false;
  }
}

function runProjectionCodeGraph(
  invocation: CodeGraphCliInvocation,
  root: string,
  args: string[],
  timeout: number,
  envOverrides?: Record<string, string>
): string {
  disableCodeGraphTelemetryByDefault();
  const startedAt = performance.now();
  try {
    return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: root,
      env: codeGraphChildEnv(envOverrides),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
      timeout
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    const childError = error as { code?: string | number; status?: number | null; signal?: string | null } | null;
    // Only the fixed subcommand is recorded; arguments may contain repository paths.
    const diagnostics = {
      subcommand: args[0],
      deadlineMs: timeout,
      elapsedMs: Math.round(performance.now() - startedAt),
      code: childError?.code ?? null,
      exitCode: childError?.status ?? null,
      signal: childError?.signal ?? null
    };
    throw new Error(`CodeGraph projection handshake failed: ${message}\nCodeGraph handshake diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}
