import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import { join, resolve } from "node:path";
import {
  FailureError, toEnvelope, NATIVE_CONTEXT_LIMITS, NATIVE_CONTEXT_PROFILE, NATIVE_CONTEXT_SCHEMA_VERSION, NativeContextError, assertNativeContextLimit,
  assertNativeContextPath, canonicalize, digestJson, nativeAllowedNodeKinds, nativeByteCompare,
  nativeContextModelIssues, okEnvelope, type Json, type NativeCapabilityProfile, type NativeContextContract,
  type NativeContextDocument, type NativeContextExportV1, type NativeContextInput, type NativeContextModel,
  type NativeContextSchemas, type NativeContextSnapshot, type NativeModelRecord
} from "@archcontext/contracts";
import { ADR_FILE_PATH, DuplicateModelKeyError, parseArchitectureDecisionRecord, readAdrAppliesTo, parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { analyzeNativeDocument, absentNativeSection, parseRepoHarnessNodeProfile, repoHarnessIncludeAnchors, resolveArchitectureDocumentationLayout, type ProjectionLayoutNode } from "@archcontext/core/projection-engine";
import { assertNativeGitRevision, decodeUtf8, readGitBlobTree, readGitBlobs, readNativeGitRoot, readOnlyGit, resolveNativeGitSnapshot, type GitBlobTreeEntry } from "../../git-adapter/src/blob-reader";
import nodeSchema from "../../../../schemas/repo/architecture-node.schema.json";
import relationSchema from "../../../../schemas/repo/architecture-relation.schema.json";
import flowSchema from "../../../../schemas/repo/architecture-flow.schema.json";

const SCHEMAS = { node: nodeSchema, relation: relationSchema, flow: flowSchema } as unknown as NativeContextSchemas;
const MANIFEST = ".archcontext/manifest.yaml";
const MODEL_KINDS = ["nodes", "relations", "flows"] as const;
type ModelKind = (typeof MODEL_KINDS)[number];
type InputSpec = Pick<NativeContextInput, "path" | "role" | "requirement">;
interface CapturedInput { input: NativeContextInput; bytes: Buffer | null; identity: string }
export type NativeContextSelector = { source: "ref"; ref: string } | { source: "worktree" };
/** Deterministic test/read observers. No CLI flag or retry loop exposes them. */
export interface NativeContextReadHooks { onBoundary?: (boundary: string, details: { path?: string; observation?: number }) => void }

function contentDigest(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function record(value: Json): NativeModelRecord | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value : undefined; }
function changed(category: string, paths: string[] = []): never {
  throw new NativeContextError("native-context-input-changed", { category, changedPaths: paths.slice(0, 32), omittedDiagnosticCount: Math.max(0, paths.length - 32) });
}

abstract class CapturedSource {
  readonly captured = new Map<string, CapturedInput>();
  protected byteCount = 0;
  constructor(readonly root: string, readonly hooks: NativeContextReadHooks, readonly observation: number) {}
  abstract modelEntries(): string[];
  abstract decisionEntries(): string[];
  abstract assertModelDirectories(): void;
  abstract readUncached(specs: InputSpec[]): CapturedInput[];
  read(specs: InputSpec[]): void {
    const fresh = specs.filter(spec => !this.captured.has(spec.path));
    assertNativeContextLimit("inputFiles", this.captured.size + fresh.length);
    for (const spec of fresh) assertNativeContextPath(spec.path);
    const inputs = this.readUncached(fresh);
    for (const captured of inputs) {
      if (captured.bytes !== null) {
        assertNativeContextLimit("fileBytes", captured.bytes.length);
        this.byteCount += captured.bytes.length;
        assertNativeContextLimit("inputBytes", this.byteCount);
      }
      this.captured.set(captured.input.path, captured);
      this.hooks.onBoundary?.("after-input-read", { path: captured.input.path, observation: this.observation });
    }
  }
  input(path: string): CapturedInput { return this.captured.get(path)!; }
  text(path: string): string | null {
    const bytes = this.input(path).bytes;
    try { return bytes === null ? null : decodeUtf8(bytes); }
    catch { throw new NativeContextError("native-context-text-invalid", { path, encoding: "utf-8" }); }
  }
}

class RefSource extends CapturedSource {
  readonly entries: GitBlobTreeEntry[];
  private readonly byPath = new Map<string, GitBlobTreeEntry[]>();
  constructor(root: string, treeOid: string, hooks: NativeContextReadHooks) {
    super(root, hooks, 1);
    // Only selected OIDs get a size preflight. Listing every blob size would also read
    // unrelated promised/missing objects, violating the selected input closure.
    this.entries = readGitBlobTree(root, treeOid, { sizes: false });
    for (const entry of this.entries) {
      const entries = this.byPath.get(entry.path) ?? [];
      entries.push(entry); this.byPath.set(entry.path, entries);
    }
  }
  private lookup(path: string, directory = false): GitBlobTreeEntry | undefined {
    assertNativeContextPath(path);
    const segments = path.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index + 1).join("/");
      const candidates = this.byPath.get(prefix) ?? [];
      if (candidates.some(entry => !entry.utf8Valid) || candidates.length > 1) throw new NativeContextError("native-context-path-unsafe", { category: "path-encoding-or-alias", path });
      const entry = candidates[0];
      if (!entry) return undefined;
      const isDirectory = index < segments.length - 1 || directory;
      if (isDirectory ? entry.type !== "tree" || entry.mode !== "040000" : entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
        throw new NativeContextError("native-context-entry-kind-unsupported", { path: prefix, mode: entry.mode, kind: entry.type });
      }
      if (index === segments.length - 1) return entry;
    }
    return undefined;
  }
  assertModelDirectories(): void { for (const kind of MODEL_KINDS) this.lookup(`.archcontext/model/${kind}`, true); }
  modelEntries(): string[] {
    return this.entries.filter(entry => MODEL_KINDS.some(kind => entry.path.startsWith(`.archcontext/model/${kind}/`))).map(entry => {
      if (!entry.utf8Valid) throw new NativeContextError("native-context-path-unsafe", { category: "model-path-encoding" });
      return entry.path;
    });
  }
  decisionEntries(): string[] {
    this.lookup("docs/adr", true);
    return this.entries.filter(entry => ADR_FILE_PATH.test(entry.path)).map(entry => {
      if (!entry.utf8Valid) throw new NativeContextError("native-context-path-unsafe", { category: "decision-path-encoding" });
      return entry.path;
    }).sort(nativeByteCompare);
  }
  readUncached(specs: InputSpec[]): CapturedInput[] {
    const entries = specs.map(spec => this.lookup(spec.path));
    const requests = entries.flatMap(entry => entry ? [entry] : []);
    assertNativeContextLimit("inputBytes", this.byteCount + requests.reduce((total, request) => total + (request.byteLength ?? 0), 0));
    const remainingBytes = NATIVE_CONTEXT_LIMITS.inputBytes - this.byteCount;
    const blobs = readGitBlobs(this.root, requests, { fileBytes: NATIVE_CONTEXT_LIMITS.fileBytes, inputBytes: remainingBytes, responseBytes: remainingBytes + NATIVE_CONTEXT_LIMITS.batchOverheadBytes });
    let index = 0;
    return specs.map((spec, position) => {
      const entry = entries[position];
      const bytes = entry ? blobs[index++]! : null;
      if (bytes === null && spec.requirement === "required") throw new NativeContextError(spec.role === "manifest" ? "native-context-model-missing" : "native-context-input-missing", { path: spec.path });
      return { input: { ...spec, presence: bytes === null ? "missing" : "present", mode: entry ? entry.mode as NativeContextInput["mode"] : null, byteLength: bytes?.length ?? null, contentDigest: bytes === null ? null : contentDigest(bytes) }, bytes, identity: entry ? `${entry.objectId}:${entry.mode}` : "missing" };
    });
  }
}

interface PathObservation { exists: boolean; identity: string; stat?: BigIntStats; absolute: string }
function statIdentity(stat: BigIntStats, directory: boolean): string {
  return directory ? `${stat.dev}:${stat.ino}:${stat.mode}` : `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

/** Every existing ancestor is checked; safe absence is distinct from any other IO failure. */
function observePath(root: string, path: string, directory = false): PathObservation {
  assertNativeContextPath(path);
  if (process.platform === "win32" && path.split("/").some(segment => segment.includes(":") || /[. ]$/.test(segment))) throw new NativeContextError("native-context-path-unsafe", { path, category: "windows-path-alias" });
  let absolute = root;
  const identities: string[] = [];
  const segments = path.split("/");
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) absolute = join(absolute, segments[index]!);
    let stat: BigIntStats;
    try { stat = lstatSync(absolute, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, identity: identities.join("/") + "/missing", absolute: resolve(root, path) };
      throw new NativeContextError("native-context-input-unreadable", { path, category: "stat" });
    }
    const needsDirectory = index < segments.length - 1 || directory;
    if (stat.isSymbolicLink() || (needsDirectory ? !stat.isDirectory() : !stat.isFile())) throw new NativeContextError("native-context-entry-kind-unsupported", { path, category: stat.isSymbolicLink() ? "link" : "non-regular" });
    if (index >= 0 && realpathSync.native(absolute) !== absolute) throw new NativeContextError("native-context-path-unsafe", { path, category: "filesystem-path-alias" });
    if (needsDirectory && index >= 0) {
      try {
        lstatSync(join(absolute, ".git"));
        throw new NativeContextError("native-context-entry-kind-unsupported", { path: segments.slice(0, index + 1).join("/"), category: "nested-repository" });
      } catch (error) {
        if (error instanceof NativeContextError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new NativeContextError("native-context-input-unreadable", { path, category: "repository-boundary-stat" });
      }
    }
    identities.push(statIdentity(stat, needsDirectory));
    if (index === segments.length - 1) {
      return { exists: true, identity: identities.join("/"), stat, absolute };
    }
  }
  throw new NativeContextError("native-context-path-unsafe", { path });
}

class WorktreeSource extends CapturedSource {
  private membership: string[] | undefined;
  private decisionMembership: string[] | undefined;
  private readonly windowsModes: Map<string, NativeContextInput["mode"]> | undefined;
  private readonly gitlinks: string[];
  constructor(root: string, hooks: NativeContextReadHooks, observation: number, treeOid: string) {
    super(root, hooks, observation);
    this.gitlinks = this.readGitlinks();
    // Windows does not expose a Git executable bit. Retain the fixed HEAD's logical mode
    // for tracked regular files; current file-kind/identity checks still use lstat/fstat.
    if (process.platform === "win32") this.windowsModes = new Map(readGitBlobTree(root, treeOid, { sizes: false }).filter(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode)).map(entry => [entry.path, entry.mode as NativeContextInput["mode"]]));
  }
  private readGitlinks(): string[] {
    const staged = readOnlyGit(this.root, "ls-files", ["--stage", "-z", "--"]);
    return staged.toString("utf8").split("\0").flatMap(row => row.startsWith("160000 ") ? [row.slice(row.indexOf("\t") + 1)] : []);
  }
  assertModelDirectories(): void { for (const kind of MODEL_KINDS) observePath(this.root, `.archcontext/model/${kind}`, true); }
  private enumerate(decisions = false): string[] {
    const bytes = readOnlyGit(this.root, "ls-files", ["--cached", "--others", "--exclude-standard", "-z", "--", ...(decisions ? ["docs/adr"] : [".archcontext/model/nodes", ".archcontext/model/relations", ".archcontext/model/flows"])]);
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0) throw new NativeContextError("native-context-git-read-failed", { operation: "ls-files", category: "missing-terminator" });
    let paths: string[];
    try { paths = decodeUtf8(bytes).split("\0").filter(Boolean).sort(nativeByteCompare); }
    catch { throw new NativeContextError("native-context-path-unsafe", { category: "model-path-encoding" }); }
    if (new Set(paths).size !== paths.length) throw new NativeContextError("native-context-input-ambiguous", { branch: "git-membership" });
    return decisions ? paths.filter(path => ADR_FILE_PATH.test(path)) : paths;
  }
  modelEntries(): string[] {
    this.membership = this.enumerate();
    this.hooks.onBoundary?.("after-model-enumeration", { observation: this.observation });
    return this.membership;
  }
  decisionEntries(): string[] {
    observePath(this.root, "docs/adr", true);
    this.decisionMembership = this.enumerate(true);
    return this.decisionMembership;
  }
  readUncached(specs: InputSpec[]): CapturedInput[] {
    let batchBytes = this.byteCount;
    return specs.map(spec => {
      if (this.gitlinks.some(path => spec.path === path || spec.path.startsWith(`${path}/`))) throw new NativeContextError("native-context-entry-kind-unsupported", { path: spec.path, category: "gitlink" });
      const before = observePath(this.root, spec.path);
      if (!before.exists) {
        if (spec.requirement === "required") throw new NativeContextError(spec.role === "manifest" ? "native-context-model-missing" : "native-context-input-missing", { path: spec.path });
        return { input: { ...spec, presence: "missing" as const, mode: null, byteLength: null, contentDigest: null }, bytes: null, identity: before.identity };
      }
      assertNativeContextLimit("fileBytes", Number(before.stat!.size));
      assertNativeContextLimit("inputBytes", batchBytes + Number(before.stat!.size));
      let descriptor: number | undefined;
      let bytes: Buffer;
      try {
        descriptor = openSync(before.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(descriptor, { bigint: true });
        if (!opened.isFile() || statIdentity(opened, false) !== statIdentity(before.stat!, false)) changed("descriptor-identity", [spec.path]);
        const buffer = Buffer.alloc(Number(opened.size) + 1);
        let length = 0;
        while (length < buffer.length) {
          const count = readSync(descriptor, buffer, length, buffer.length - length, null);
          if (count === 0) break;
          length += count;
        }
        assertNativeContextLimit("fileBytes", length);
        const after = fstatSync(descriptor, { bigint: true });
        if (statIdentity(after, false) !== statIdentity(opened, false) || length !== Number(opened.size)) changed("descriptor-content", [spec.path]);
        bytes = buffer.subarray(0, length);
      } catch (error) {
        if (error instanceof NativeContextError) throw error;
        throw new NativeContextError("native-context-input-unreadable", { path: spec.path, category: "open-or-read" });
      } finally { if (descriptor !== undefined) closeSync(descriptor); }
      const after = observePath(this.root, spec.path);
      if (after.identity !== before.identity) changed("path-identity", [spec.path]);
      batchBytes += bytes.length;
      assertNativeContextLimit("inputBytes", batchBytes);
      const mode = this.windowsModes?.get(spec.path) ?? ((before.stat!.mode & 0o111n) !== 0n ? "100755" as const : "100644" as const);
      return { input: { ...spec, presence: "present" as const, mode, byteLength: bytes.length, contentDigest: contentDigest(bytes) }, bytes, identity: before.identity };
    });
  }
  assertStable(): void {
    if (canonicalize(this.enumerate()) !== canonicalize(this.membership!)) changed("model-membership");
    if (canonicalize(this.enumerate(true)) !== canonicalize(this.decisionMembership!)) changed("decision-membership");
    const gitlinks = this.readGitlinks();
    const paths: string[] = [];
    for (const [path, captured] of this.captured) {
      if (gitlinks.some(link => path === link || path.startsWith(`${link}/`))) { paths.push(path); continue; }
      try { if (observePath(this.root, path).identity !== captured.identity) paths.push(path); }
      catch { paths.push(path); }
    }
    if (paths.length > 0) changed("path-presence-or-identity", paths);
  }
}

function modelSpecs(source: CapturedSource): InputSpec[] {
  source.assertModelDirectories();
  const entries = source.modelEntries();
  const specs: InputSpec[] = [{ path: MANIFEST, role: "manifest", requirement: "required" }];
  for (const path of entries) {
    assertNativeContextPath(path);
    const kind = MODEL_KINDS.find(kind => path.startsWith(`.archcontext/model/${kind}/`));
    if (!kind) throw new NativeContextError("native-context-entry-kind-unsupported", { path, category: "model-layout" });
    const name = path.slice(`.archcontext/model/${kind}/`.length);
    if (name === ".gitkeep") continue;
    if (name.includes("/") || !/\.ya?ml$/.test(name)) throw new NativeContextError("native-context-entry-kind-unsupported", { path, category: "model-layout" });
    specs.push({ path, role: kind === "nodes" ? "node" : kind === "relations" ? "relation" : "flow", requirement: "required" });
  }
  if (!specs.some(spec => spec.role === "node")) throw new NativeContextError("native-context-model-missing", { category: "no-native-nodes" });
  return specs.sort((a, b) => nativeByteCompare(a.path, b.path));
}

function parseInput(source: CapturedSource, path: string): Json {
  try { return parseJsonOrStableYaml(source.text(path)!, path); }
  catch (error) {
    if (error instanceof NativeContextError) throw error;
    if (error instanceof DuplicateModelKeyError) {
      const fields = Object.getOwnPropertyDescriptors(error);
      const offset = fields.offset?.value;
      if (!["branch", "key", "offset"].every(key => fields[key] && "value" in fields[key]) || typeof fields.branch.value !== "string" || typeof fields.key.value !== "string" || typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new FailureError("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", {stage: "failure-metadata"});
      const key = fields.key.value as string;
      throw new NativeContextError("native-context-input-ambiguous", {path, branch: fields.branch.value, key, offset, omittedKeyCharacters: Buffer.byteLength(key, "utf8") > 256 ? key.length : 0});
    }
    throw new NativeContextError("native-context-model-invalid", { path, invariant: "model-parse" });
  }
}

function profiles(model: NativeContextModel): NativeCapabilityProfile[] {
  const byId = new Map(model.nodes.map(node => [node.id as string, node]));
  const children = new Map<string, string[]>();
  const components = new Map<string, string[]>();
  const nearest = new Map<string, string | null>();
  const nearestCapability = (start: string): string | null => {
    const trail: string[] = [];
    let cursor: string | undefined = start;
    let capability: string | null = null;
    while (cursor !== undefined) {
      if (nearest.has(cursor)) { capability = nearest.get(cursor)!; break; }
      const node = byId.get(cursor)!;
      if (node.kind === "capability") { capability = cursor; break; }
      trail.push(cursor); cursor = node.parent as string | undefined;
    }
    for (const id of trail) nearest.set(id, capability);
    return capability;
  };
  for (const node of model.nodes) {
    if (typeof node.parent === "string") {
      const direct = children.get(node.parent) ?? [];
      direct.push(node.id as string); children.set(node.parent, direct);
      if (node.kind === "component") {
        const capability = nearestCapability(node.parent);
        if (capability !== null) { const group = components.get(capability) ?? []; group.push(node.id as string); components.set(capability, group); }
      }
    }
  }
  return model.nodes.filter(node => node.kind === "capability").map(node => {
    const extensions = node.extensions === undefined ? {} : record(node.extensions);
    const files = extensions?.contractFiles === undefined ? undefined : record(extensions.contractFiles);
    if (typeof files?.agents !== "string" || typeof files?.claude !== "string" || !files.agents || !files.claude) throw new NativeContextError("native-context-profile-incomplete", { nodeId: node.id, field: "extensions.contractFiles" });
    assertNativeContextPath(files.agents); assertNativeContextPath(files.claude);
    let profile: ReturnType<typeof parseRepoHarnessNodeProfile>;
    try { profile = parseRepoHarnessNodeProfile(node as unknown as ProjectionLayoutNode); }
    catch { throw new NativeContextError("native-context-profile-incomplete", { nodeId: node.id, field: "identity-or-contractFiles" }); }
    const lspProfile = extensions?.lspProfile;
    const verification = extensions?.verification;
    if (lspProfile !== undefined && (typeof lspProfile !== "string" || lspProfile.trim().length === 0)) throw new NativeContextError("native-context-profile-incomplete", { nodeId: node.id, field: "extensions.lspProfile" });
    if (verification !== undefined && (!Array.isArray(verification) || verification.some(value => typeof value !== "string"))) throw new NativeContextError("native-context-profile-incomplete", { nodeId: node.id, field: "extensions.verification" });
    const directChildNodeIds = (children.get(node.id as string) ?? []).sort(nativeByteCompare);
    const componentNodeIds = (components.get(node.id as string) ?? []).sort(nativeByteCompare);
    const include = (node.source as { include?: string[] } | undefined)?.include ?? [];
    return { nodeId: node.id as string, status: node.status as string, domain: profile.domain, name: profile.name, modulePath: profile.modulePath, contractFiles: profile.contractFiles, includeAnchors: repoHarnessIncludeAnchors(include), lspProfile: lspProfile as string | undefined ?? null, verification: verification as string[] | undefined ?? null, directChildNodeIds, componentNodeIds };
  }).sort((a, b) => nativeByteCompare(a.nodeId, b.nodeId));
}

function capture(source: CapturedSource, snapshot: NativeContextSnapshot): NativeContextExportV1 {
  const specs = modelSpecs(source);
  source.read(specs);
  source.hooks.onBoundary?.("after-model-batch", { observation: source.observation });
  const manifest = record(parseInput(source, MANIFEST));
  if (!manifest || manifest.schemaVersion !== "archcontext.manifest/v1" || record(manifest.model ?? null)?.layout !== "split" || record(manifest.model ?? null)?.root !== ".archcontext/model") throw new NativeContextError("native-context-model-invalid", { path: MANIFEST, invariant: "supported-manifest-layout" });
  const budget = record(manifest.runtime ?? null)?.contextBudgetBytes;
  if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0) throw new NativeContextError("native-context-budget-invalid", { path: MANIFEST, field: "runtime.contextBudgetBytes" });
  const layers = record(manifest.model ?? null)?.layers;
  const model: NativeContextModel = { ...(layers === undefined ? {} : { layers: layers as string[] }), nodes: [], relations: [], flows: [], sourcePaths: { nodes: {}, relations: {}, flows: {} } };
  const recordPaths = new Map<NativeModelRecord, string>();
  for (const spec of specs) if (spec.role !== "manifest") {
    const value = record(parseInput(source, spec.path));
    if (!value) throw new NativeContextError("native-context-model-invalid", { path: spec.path, invariant: "entity-object-required" });
    const kind: ModelKind = spec.role === "node" ? "nodes" : spec.role === "relation" ? "relations" : "flows";
    model[kind].push(value);
    recordPaths.set(value, spec.path);
    if (typeof value.id === "string") model.sourcePaths[kind][value.id] = spec.path;
  }
  const issues = nativeContextModelIssues(model, SCHEMAS, recordPaths);
  if (issues.length > 0) throw new NativeContextError(issues.some(issue => issue.invariant === "path-unsafe") ? "native-context-path-unsafe" : "native-context-model-invalid", { issues: issues.slice(0, 32) as unknown as Json, omittedDiagnosticCount: Math.max(0, issues.length - 32) });
  for (const kind of MODEL_KINDS) model[kind].sort((a, b) => nativeByteCompare(a.id as string, b.id as string));
  const decisionPaths = source.decisionEntries();
  source.read(decisionPaths.map(path => ({ path, role: "decision", requirement: "required" })));
  const nodeIds = new Set(model.nodes.map(node => node.id));
  const decisions = decisionPaths.map(path => {
    const body = source.text(path)!;
    const appliesTo = readAdrAppliesTo(body);
    if (appliesTo.kind === "malformed") throw new NativeContextError("native-context-model-invalid", { path, invariant: "adr-applies-to-invalid" });
    if (appliesTo.kind === "ids" && appliesTo.ids.some(id => !nodeIds.has(id))) throw new NativeContextError("native-context-model-invalid", { path, invariant: "adr-node-missing" });
    try { return parseArchitectureDecisionRecord(path, body); }
    catch { throw new NativeContextError("native-context-model-invalid", { path, invariant: "adr-metadata-invalid" }); }
  }).sort((a, b) => nativeByteCompare(a.id, b.id) || nativeByteCompare(a.path, b.path));
  if (new Set(decisions.map(decision => decision.id)).size !== decisions.length) throw new NativeContextError("native-context-model-invalid", { invariant: "adr-id-ambiguous" });
  const capabilityProfiles = profiles(model);
  const declared = new Map<string, { roles: ("agents" | "claude")[]; capabilityNodeIds: string[] }>();
  for (const profile of capabilityProfiles) for (const role of ["agents", "claude"] as const) {
    const path = profile.contractFiles[role];
    const current = declared.get(path) ?? { roles: [], capabilityNodeIds: [] };
    if (!current.roles.includes(role)) current.roles.push(role);
    current.capabilityNodeIds.push(profile.nodeId); declared.set(path, current);
  }
  let layout: ReturnType<typeof resolveArchitectureDocumentationLayout>;
  try { layout = resolveArchitectureDocumentationLayout({ nodes: model.nodes as unknown as ProjectionLayoutNode[], relations: model.relations as unknown as Array<{ id: string } & Record<string, Json>>, profile: NATIVE_CONTEXT_PROFILE }); }
  catch { throw new NativeContextError("native-context-profile-incomplete", { field: "layout-target-identity" }); }
  const targets = layout.targets.filter(target => target.ownership === "mixed" && target.format === "markdown");
  source.read([...declared.keys()].map(path => ({ path, role: "contract", requirement: "declared" })).concat(targets.map(target => ({ path: target.path, role: "document", requirement: "optional" }))) as InputSpec[]);
  source.hooks.onBoundary?.("after-document-batch", { observation: source.observation });
  const contracts: NativeContextContract[] = [...declared.entries()].map(([path, declaration]) => {
    const input = source.input(path).input;
    return { path, roles: declaration.roles.sort(nativeByteCompare), capabilityNodeIds: [...new Set(declaration.capabilityNodeIds)].sort(nativeByteCompare), presence: input.presence, text: source.text(path), byteLength: input.byteLength, byteDigest: input.contentDigest };
  }).sort((a, b) => nativeByteCompare(a.path, b.path));
  const documents: NativeContextDocument[] = targets.map((target): NativeContextDocument => {
    const body = source.text(target.path);
    const capabilityNodeIds = target.scope.kind === "entity" ? [target.scope.id!] : capabilityProfiles.map(profile => profile.nodeId);
    return body === null ? { path: target.path, targetId: target.targetId, capabilityNodeIds, presence: "missing", markerState: "missing", humanRegions: [], section3: absentNativeSection("missing"), backlog: absentNativeSection("missing") }
      : { path: target.path, targetId: target.targetId, capabilityNodeIds, presence: "present", ...analyzeNativeDocument(body, target.path, target.targetId) };
  }).sort((a, b) => nativeByteCompare(a.path, b.path));
  const inputs = [...source.captured.values()].map(value => value.input).sort((a, b) => nativeByteCompare(a.path, b.path));
  const inputDigest = digestJson({ protocol: NATIVE_CONTEXT_SCHEMA_VERSION, profile: NATIVE_CONTEXT_PROFILE, inputs: inputs as unknown as Json });
  return { schemaVersion: NATIVE_CONTEXT_SCHEMA_VERSION, profile: NATIVE_CONTEXT_PROFILE, snapshot, inputDigest, inputs, allowedNodeKinds: nativeAllowedNodeKinds(SCHEMAS), contextBudgetBytes: budget, model, capabilityProfiles, contracts, documents, decisions };
}

/** Stateless native read. The success payload contains no local paths, timestamps or daemon identity. */
export function exportNativeContext(start: string, selector: NativeContextSelector, hooks: NativeContextReadHooks = {}): NativeContextExportV1 {
  try { return readNativeContext(start, selector, hooks); }
  catch (error) {
    let typed: NativeContextError | undefined;
    try { if (error instanceof NativeContextError) typed = error; } catch { /* Uninspectable throws remain unknown. */ }
    if (typed) throw typed;
    const failure = toEnvelope("export.native", error, "native-export").error;
    throw new FailureError(failure.code, failure.reasonCode, failure.details, failure);
  }
}

function readNativeContext(start: string, selector: NativeContextSelector, hooks: NativeContextReadHooks): NativeContextExportV1 {
  if (selector.source === "ref") assertNativeGitRevision(selector.ref);
  const root = readNativeGitRoot(start);
  if (selector.source === "ref") {
    const fixed = resolveNativeGitSnapshot(root, selector.ref);
    hooks.onBoundary?.("after-ref-resolution", {});
    const source = new RefSource(root, fixed.treeOid, hooks);
    const data = capture(source, { source: "ref", ...fixed, validation: "immutable-tree" });
    assertNativeContextLimit("responseBytes", Buffer.byteLength(JSON.stringify(okEnvelope("export.native", data as unknown as Json)) + "\n", "utf8"));
    return data;
  }
  const worktreeRoot = realpathSync.native(root);
  const head = resolveNativeGitSnapshot(worktreeRoot, "HEAD");
  const snapshot: NativeContextSnapshot = { source: "worktree", headSha: head.commitSha, headTreeOid: head.treeOid, validation: "stable-read" };
  const first = new WorktreeSource(worktreeRoot, hooks, 1, head.treeOid);
  const data = capture(first, snapshot);
  first.assertStable();
  assertNativeContextLimit("responseBytes", Buffer.byteLength(JSON.stringify(okEnvelope("export.native", data as unknown as Json)) + "\n", "utf8"));
  hooks.onBoundary?.("after-first-observation", { observation: 1 });
  const second = new WorktreeSource(worktreeRoot, hooks, 2, head.treeOid);
  let observed: NativeContextExportV1;
  try {
    observed = capture(second, snapshot);
    second.assertStable();
  } catch (error) {
    if (error instanceof NativeContextError && error.reasonCode === "native-context-input-changed") throw error;
    changed("second-observation-invalid");
  }
  if (observed!.inputDigest !== data.inputDigest) changed("input-digest", [...new Set([...first.captured.keys(), ...second.captured.keys()])].filter(path => canonicalize(first.captured.get(path)?.input as unknown as Json ?? null) !== canonicalize(second.captured.get(path)?.input as unknown as Json ?? null)));
  const replaced = [...first.captured.keys()].filter(path => first.captured.get(path)!.identity !== second.captured.get(path)?.identity);
  if (replaced.length > 0) changed("input-identity", replaced);
  hooks.onBoundary?.("after-second-observation", { observation: 2 });
  second.assertStable();
  const finalHead = resolveNativeGitSnapshot(worktreeRoot, "HEAD");
  if (canonicalize(head) !== canonicalize(finalHead)) changed("head-or-tree");
  return data;
}
