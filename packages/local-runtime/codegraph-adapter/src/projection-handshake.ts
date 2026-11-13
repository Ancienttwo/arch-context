import { CODE_FACTS_ISSUE_MESSAGES } from "@archcontext/contracts";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { codeGraphChildEnv } from "./child-env";
import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION, codeGraphIndexBuildInProgress, type CodeGraphReadProvider } from "./read-session";
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
import { statusImportNodeCount } from "./import-population";
import { assertRepositoryCodeFactsReady, codeGraphIndexAvailable } from "./repository-code-facts";
import { loadCapabilityCodeGraphProjectionInputs, type CapabilityCodeGraphProjectionInputs } from "./selector-index";

// --- Capability documentation projection measurements and exact semantic bindings ---
//
// A thin read-only query surface over the same CodeGraph CLI the provider uses. It exists so the
// documentation projection stays a pure function in @archcontext/core: the child process lives
// here, the renderer only receives measured facts. Import graphs remain diagnostic measurements;
// exact node-v2 selectors are the only CodeGraph facts that can bind a semantic flow step.

export interface CodeGraphProjectionStatusV1 {
  initialized: boolean;
  version: string;
  projectPath: string;
  lastIndexed: string | null;
  fileCount?: number;
  nodeCount?: number;
  edgeCount?: number;
  nodesByKind?: Record<string, number>;
  languages?: string[];
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
    timeouts?: { versionMs?: number; statusMs?: number; syncMs?: number };
    /** The read-only provider the readiness gate reads through; the pinned one unless injected. */
    readProvider?: CodeGraphReadProvider;
  } = {}
): PreparedArchitectureDocumentationProjectionSnapshot {
  // Classify repository readiness with the same doctor evaluator the task commands use, before
  // any code-facts read. A present but incompatible index is a typed refusal; pending-only
  // freshness is accepted and cleared by the sync below. An absent index keeps its existing
  // AC_CODE_FACTS_UNAVAILABLE contract.
  const { readProvider, ...projectionOptions } = options;
  if (codeGraphIndexAvailable(root)) assertRepositoryCodeFactsReady(root, readProvider ? { provider: readProvider } : {});
  const baseHeadSha = readProjectionHeadSha(root);
  const sourceFiles = listGitVisibleFiles(root);
  const worktreeDigest = architectureDocumentationProjectionWorktreeDigest(root, model, sourceFiles);
  const footprints = loadCapabilitySourceFootprints(root, model, sourceFiles);
  const sourceTreeDigest = digestArchitectureDocumentationSourceTree(root, model, footprints);
  const modelDigest = digestJson(model as unknown as Json);
  const prepared = prepareProjectionCodeFacts(root, model, { ...projectionOptions, sourceTreeDigest, sourceFiles, footprints });
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
 * Freezes the public CodeGraph proof used by one docs projection. The adapter never reads the
 * `.codegraph` database: actual binary/version and both status snapshots come from the package-local
 * CLI. A missing index is an explicit unavailable state; an existing but stale/incompatible index
 * is an error and cannot produce verified facts.
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
    binary?: string;
    importNodeLimit?: number;
    timeouts?: { versionMs?: number; statusMs?: number; syncMs?: number };
    /** `false` reads selector evidence only (`flows check`); a projection always reads both. */
    importGraphs?: boolean;
  }
): PreparedProjectionCodeFacts {
  const invocation = options.binary
    ? codeGraphCliInvocation(options.binary, root, "")
    : packagedCodeGraphCliInvocation();
  const binaryPath = invocation.argsPrefix[0] ?? invocation.command;
  // `--version` starts the same launcher chain as `status`, so it gets the same stall budget. On
  // Windows CI it takes 94 ms (p50) and 2.4 s cold; a runner stall once pushed it past 5 s.
  const actualVersion = runProjectionCodeGraph(invocation, root, ["--version"], options.timeouts?.versionMs ?? 10_000).trim();
  if (actualVersion !== REQUIRED_CODEGRAPH_VERSION) {
    throw new Error(`CodeGraph ${REQUIRED_CODEGRAPH_VERSION} required, got actual binary ${actualVersion || "unknown"}`);
  }
  const binaryDigest = options.binary ? digestFile(binaryPath) : packagedCodeGraphRuntimeDigest();
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
        binaryDigest,
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

  const statusTimeout = options.timeouts?.statusMs ?? 10_000;
  const preStatus = readProjectionCodeGraphStatus(invocation, root, statusTimeout);
  assertProjectionCodeGraphStatus(preStatus, root, "pre-sync");
  runProjectionCodeGraph(invocation, root, ["sync", root, "--quiet"], options.timeouts?.syncMs ?? 120_000);
  const postStatus = readProjectionCodeGraphStatus(invocation, root, statusTimeout);
  assertProjectionCodeGraphStatus(postStatus, root, "post-sync");
  assertProjectionCodeGraphClean(postStatus, "post-sync");
  const inputs = loadCapabilityCodeGraphProjectionInputs(root, model, {
    ...(options.sourceFiles ? { sourceFiles: options.sourceFiles } : {}),
    ...(options.footprints ? { footprints: options.footprints } : {}),
    binary: binaryPath,
    importNodeLimit: options.importNodeLimit,
    importNodeCount: statusImportNodeCount(postStatus),
    ...(options.importGraphs === false ? { importGraphs: false } : {})
  });
  const finalStatus = readProjectionCodeGraphStatus(invocation, root, statusTimeout);
  assertProjectionCodeGraphStatus(finalStatus, root, "post-query");
  assertProjectionCodeGraphClean(finalStatus, "post-query");
  const postDigest = projectionCodeGraphStatusDigest(postStatus);
  const finalDigest = projectionCodeGraphStatusDigest(finalStatus);
  if (postDigest !== finalDigest) throw new Error("CodeGraph indexed snapshot changed during projection queries");
  const preDigest = projectionCodeGraphStatusDigest(preStatus);
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
      binaryDigest,
      availability: "ready",
      preSyncStatusDigest: preDigest,
      postSyncStatusDigest: postDigest,
      syncDigest: digestJson({ preSyncStatusDigest: preDigest, postSyncStatusDigest: postDigest } as unknown as Json),
      indexedWorktreeDigest,
      graphDigest
    }
  };
}

/**
 * `.codegraph/codegraph.lock` is the provider's cross-process writer lock, held for a whole
 * `codegraph init`, `index` or `sync` build. `codegraph status` is not a read of the live
 * database: 1.6.2 opens it writable and replays crash recovery, recreating the secondary indexes
 * and FTS triggers that a bulk build deliberately dropped. Those writes take SQLite write locks and
 * starve the running build into `database is locked` (#426), so no probe may touch a database that
 * is currently being built.
 */
class CodeGraphIndexBuildInProgressError extends Error {
  constructor() {
    super("CodeGraph index build is in progress");
    this.name = "CodeGraphIndexBuildInProgressError";
  }
}

export function readProjectionCodeGraphStatus(
  invocation: CodeGraphCliInvocation,
  root: string,
  timeout: number,
  envOverrides?: Record<string, string>
): CodeGraphProjectionStatusV1 {
  if (codeGraphIndexBuildInProgress(root)) throw new CodeGraphIndexBuildInProgressError();
  const output = runProjectionCodeGraph(invocation, root, ["status", "-j", root], timeout, envOverrides);
  try {
    return JSON.parse(output) as CodeGraphProjectionStatusV1;
  } catch (error) {
    throw new Error(`CodeGraph status JSON invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  /** The exact text `prepareProjectionCodeFacts` throws for this issue. */
  message: string;
}

/**
 * Pure evaluation of one `codegraph status -j` snapshot against the projection contract. It
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

function assertProjectionCodeGraphStatus(status: CodeGraphProjectionStatusV1, root: string, phase: string): void {
  const [first] = projectionCodeGraphStatusIssues(status, root, phase);
  if (first) throw new Error(first.message);
}

function assertProjectionCodeGraphClean(status: CodeGraphProjectionStatusV1, phase: string): void {
  const pending = status.pendingChanges;
  if (!pending || pending.added !== 0 || pending.modified !== 0 || pending.removed !== 0) {
    throw new Error(`CodeGraph ${phase} index still has pending source changes`);
  }
}

function projectionCodeGraphStatusDigest(status: CodeGraphProjectionStatusV1): string {
  return digestJson({
    version: status.version,
    projectPathDigest: digestJson(realpathSync.native(status.projectPath) as unknown as Json),
    lastIndexed: status.lastIndexed,
    fileCount: status.fileCount,
    nodeCount: status.nodeCount,
    edgeCount: status.edgeCount,
    nodesByKind: status.nodesByKind,
    languages: [...(status.languages ?? [])].sort(),
    pendingChanges: status.pendingChanges,
    worktreeMismatch: status.worktreeMismatch,
    index: status.index
  } as unknown as Json);
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
