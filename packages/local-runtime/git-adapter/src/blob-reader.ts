import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { NativeContextError, NATIVE_CONTEXT_LIMITS, nativeByteCompare } from "@archcontext/contracts";

export interface GitBlobTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  objectId: string;
  byteLength: number | null;
  utf8Valid: boolean;
}
export interface GitBlobRequest { objectId: string; byteLength?: number | null }
export interface GitBlobDecodeLimits { fileBytes: number; inputBytes: number; responseBytes: number }
export const NATIVE_GIT_BLOB_LIMITS: GitBlobDecodeLimits = {
  fileBytes: NATIVE_CONTEXT_LIMITS.fileBytes,
  inputBytes: NATIVE_CONTEXT_LIMITS.inputBytes,
  responseBytes: NATIVE_CONTEXT_LIMITS.inputBytes + NATIVE_CONTEXT_LIMITS.batchOverheadBytes
};

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function isGitRevisionArgument(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith("-") && !/[\s\u0000-\u001f\u007f-\u009f]/.test(ref);
}

export function assertNativeGitRevision(ref: string): void {
  if (!isGitRevisionArgument(ref)) throw new NativeContextError("native-context-ref-unsafe", { selector: "ref" });
}

type GitReadOperation = "rev-parse" | "ls-tree" | "ls-files" | "cat-file";
export interface GitReadOptions { input?: string; maxBytes?: number; timeoutMs?: number }

/** Whitelisted read operations only; never a shell, lazy fetch, filter or index writer. */
export function readOnlyGit(root: string, operation: GitReadOperation, args: string[], options: GitReadOptions = {}): Buffer {
  if (!["rev-parse", "ls-tree", "ls-files", "cat-file"].includes(operation)) throw new NativeContextError("native-context-git-read-failed", { category: "unsupported-operation" });
  const unsafeArguments = (): never => { throw new NativeContextError("native-context-git-read-failed", { operation, category: "unsupported-read-arguments" }); };
  if (operation === "rev-parse") {
    if (args.length === 1 && args[0] === "--show-toplevel") { /* root discovery */ }
    else if (args.length === 1 && isGitRevisionArgument(args[0]!)) { /* bounded metadata helper */ }
    else if (args.length === 3 && args[0] === "--verify" && args[1] === "--end-of-options") assertNativeGitRevision(args[2]!);
    else unsafeArguments();
  }
  if (operation === "ls-tree") {
    const flags = args.slice(0, -1);
    if (!flags.includes("-r") || !flags.includes("-z") || flags.some(flag => !["-r", "-z", "-t", "-l"].includes(flag)) || new Set(flags).size !== flags.length) unsafeArguments();
    assertNativeGitRevision(args[args.length - 1] ?? "");
  }
  if (operation === "ls-files") {
    const end = args.indexOf("--");
    if (end < 0 || !args.slice(0, end).includes("-z") || args.slice(0, end).some(flag => !["--cached", "--others", "--exclude-standard", "--stage", "-z"].includes(flag))) unsafeArguments();
    for (const path of args.slice(end + 1)) if (!path || path.startsWith("-") || /[\\\u0000-\u001f\u007f-\u009f]/.test(path)) unsafeArguments();
  }
  if (operation === "cat-file") {
    if (args.length !== 1 || !["--batch", "--batch-check"].includes(args[0]!)) unsafeArguments();
    if (options.input && (!options.input.endsWith("\n") || options.input.slice(0, -1).split("\n").some(oid => !OBJECT_ID.test(oid)))) unsafeArguments();
  }
  const env = { ...process.env, LC_ALL: "C", GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", GIT_ALLOW_PROTOCOL: "", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) delete (env as NodeJS.ProcessEnv)[key];
  const result = spawnSync("git", ["--no-pager", "-c", "core.fsmonitor=false", operation, ...args], {
    cwd: root,
    env,
    input: options.input,
    maxBuffer: options.maxBytes ?? NATIVE_CONTEXT_LIMITS.treeListingBytes,
    timeout: options.timeoutMs ?? NATIVE_CONTEXT_LIMITS.gitTimeoutMs,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOBUFS") throw new NativeContextError("native-context-limit-exceeded", { limit: "git-read-output", maximum: options.maxBytes ?? NATIVE_CONTEXT_LIMITS.treeListingBytes });
    throw new NativeContextError("native-context-git-read-failed", { operation, category: code === "ETIMEDOUT" ? "timeout" : "unavailable" });
  }
  // Git's normal disambiguation preference is not an unambiguous native selector.
  if (operation === "rev-parse" && /warning: refname .+ is ambiguous\./.test(result.stderr.toString("utf8"))) {
    throw new NativeContextError("native-context-ref-unavailable", { category: "ambiguous" });
  }
  return result.stdout;
}

export function readNativeGitRoot(start: string): string {
  try {
    const body = decodeUtf8(readOnlyGit(start, "rev-parse", ["--show-toplevel"]));
    if (!body.endsWith("\n")) throw new Error("root-output-invalid");
    return resolve(body.slice(0, -1));
  } catch { throw new NativeContextError("git-worktree-required"); }
}

export function resolveNativeGitSnapshot(root: string, ref: string): { commitSha: string; treeOid: string } {
  assertNativeGitRevision(ref);
  let commitSha: string;
  try { commitSha = decodeUtf8(readOnlyGit(root, "rev-parse", ["--verify", "--end-of-options", `${ref}^{commit}`])).trim(); }
  catch (error) {
    if (error instanceof NativeContextError && error.reasonCode === "native-context-ref-unavailable") throw error;
    throw new NativeContextError("native-context-ref-unavailable", { selector: "ref" });
  }
  if (!OBJECT_ID.test(commitSha)) throw new NativeContextError("native-context-ref-unavailable", { category: "invalid-oid" });
  let treeOid: string;
  try { treeOid = decodeUtf8(readOnlyGit(root, "rev-parse", ["--verify", "--end-of-options", `${commitSha}^{tree}`])).trim(); }
  catch { throw new NativeContextError("native-context-ref-unavailable", { category: "tree-unavailable" }); }
  if (!OBJECT_ID.test(treeOid)) throw new NativeContextError("native-context-ref-unavailable", { category: "invalid-tree-oid" });
  return { commitSha, treeOid };
}

export function decodeUtf8(bytes: Uint8Array): string {
  try { return UTF8.decode(bytes); }
  catch { throw new NativeContextError("native-context-text-invalid", { encoding: "utf-8" }); }
}

/** Names are NUL-delimited raw bytes, never C-quoted strings or whitespace-separated paths. */
export function decodeGitTreeEntries(bytes: Buffer): GitBlobTreeEntry[] {
  const entries: GitBlobTreeEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    const tab = bytes.indexOf(9, offset);
    if (end < 0 || tab < offset || tab >= end) throw new NativeContextError("native-context-git-read-failed", { operation: "ls-tree", category: "malformed-record" });
    const header = bytes.toString("ascii", offset, tab);
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]+)(?: +(\d+|-))?$/.exec(header);
    if (!match || !OBJECT_ID.test(match[3]!)) throw new NativeContextError("native-context-git-read-failed", { operation: "ls-tree", category: "malformed-header" });
    const rawPath = bytes.subarray(tab + 1, end);
    const name = rawPath.toString("hex");
    if (rawPath.length === 0 || names.has(name)) throw new NativeContextError("native-context-path-unsafe", { category: "ambiguous-tree-path" });
    names.add(name);
    let path: string;
    let utf8Valid = true;
    try { path = UTF8.decode(rawPath); }
    catch { path = rawPath.toString("utf8"); utf8Valid = false; }
    const byteLength = match[4] === undefined || match[4] === "-" ? null : Number(match[4]);
    if (byteLength !== null && (!Number.isSafeInteger(byteLength) || byteLength < 0)) throw new NativeContextError("native-context-git-read-failed", { operation: "ls-tree", category: "invalid-size" });
    entries.push({ mode: match[1]!, type: match[2] as GitBlobTreeEntry["type"], objectId: match[3]!, byteLength, path, utf8Valid });
    offset = end + 1;
  }
  return entries.sort((a, b) => nativeByteCompare(a.path, b.path));
}

export function readGitBlobTree(root: string, treeOid: string, options: { maxBytes?: number; sizes?: boolean; trees?: boolean } = {}): GitBlobTreeEntry[] {
  assertNativeGitRevision(treeOid);
  return decodeGitTreeEntries(readOnlyGit(root, "ls-tree", ["-r", "-z", ...(options.trees === false ? [] : ["-t"]), ...(options.sizes === false ? [] : ["-l"]), treeOid], { maxBytes: options.maxBytes }));
}

/** Shared by native export and existing tracked-source metrics, with their respective bounds. */
export function decodeGitBlobBatch(bytes: Buffer, requests: readonly GitBlobRequest[], limits: GitBlobDecodeLimits = NATIVE_GIT_BLOB_LIMITS): Buffer[] {
  if (bytes.length > limits.responseBytes) throw new NativeContextError("native-context-limit-exceeded", { limit: "batch-response-bytes", maximum: limits.responseBytes, observed: bytes.length });
  let offset = 0;
  let total = 0;
  const blobs: Buffer[] = [];
  for (const request of requests) {
    const headerEnd = bytes.indexOf(10, offset);
    if (headerEnd < 0) throw new NativeContextError("native-context-blob-unavailable", { category: "missing-header" });
    const header = bytes.toString("ascii", offset, headerEnd);
    const match = /^([a-f0-9]+) blob (0|[1-9]\d*)$/.exec(header);
    if (!match || !OBJECT_ID.test(match[1]!) || match[1] !== request.objectId) throw new NativeContextError("native-context-blob-unavailable", { category: "oid-or-type-mismatch" });
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size > limits.fileBytes) throw new NativeContextError("native-context-limit-exceeded", { limit: "fileBytes", maximum: limits.fileBytes, observed: size });
    if (request.byteLength !== undefined && request.byteLength !== null && size !== request.byteLength) throw new NativeContextError("native-context-blob-unavailable", { category: "size-mismatch" });
    total += size;
    if (total > limits.inputBytes) throw new NativeContextError("native-context-limit-exceeded", { limit: "inputBytes", maximum: limits.inputBytes, observed: total });
    const start = headerEnd + 1;
    const end = start + size;
    if (end >= bytes.length || bytes[end] !== 10) throw new NativeContextError("native-context-blob-unavailable", { category: "truncated-body-or-terminator" });
    const body = bytes.subarray(start, end);
    const actualOid = createHash(request.objectId.length === 64 ? "sha256" : "sha1").update(`blob ${size}\0`).update(body).digest("hex");
    if (actualOid !== request.objectId) throw new NativeContextError("native-context-blob-unavailable", { category: "object-content-mismatch" });
    blobs.push(body);
    offset = end + 1;
  }
  if (offset !== bytes.length) throw new NativeContextError("native-context-blob-unavailable", { category: "unexpected-trailing-bytes" });
  return blobs;
}

export function readGitBlobs(root: string, requests: readonly GitBlobRequest[], limits: GitBlobDecodeLimits = NATIVE_GIT_BLOB_LIMITS): Buffer[] {
  if (requests.length === 0) return [];
  if (requests.some(request => !OBJECT_ID.test(request.objectId))) throw new NativeContextError("native-context-blob-unavailable", { category: "invalid-request-oid" });
  let checked = [...requests];
  if (requests.some(request => request.byteLength === undefined || request.byteLength === null)) {
    const headers = decodeUtf8(readOnlyGit(root, "cat-file", ["--batch-check"], { input: `${requests.map(request => request.objectId).join("\n")}\n`, maxBytes: Math.min(limits.responseBytes, requests.length * 100 + 1) })).split("\n");
    if (headers.pop() !== "" || headers.length !== requests.length) throw new NativeContextError("native-context-blob-unavailable", { category: "metadata-count-mismatch" });
    checked = requests.map((request, index) => {
      const header = /^([a-f0-9]+) blob (0|[1-9]\d*)$/.exec(headers[index]!);
      if (!header || header[1] !== request.objectId) throw new NativeContextError("native-context-blob-unavailable", { category: "missing-object-or-metadata-mismatch" });
      const byteLength = Number(header[2]);
      if (!Number.isSafeInteger(byteLength)) throw new NativeContextError("native-context-blob-unavailable", { category: "invalid-metadata-size" });
      if (request.byteLength !== undefined && request.byteLength !== null && request.byteLength !== byteLength) throw new NativeContextError("native-context-blob-unavailable", { category: "metadata-size-mismatch" });
      return { objectId: request.objectId, byteLength };
    });
  }
  let knownTotal = 0;
  for (const request of checked) if (request.byteLength !== undefined && request.byteLength !== null) {
    if (request.byteLength > limits.fileBytes) throw new NativeContextError("native-context-limit-exceeded", { limit: "fileBytes", maximum: limits.fileBytes, observed: request.byteLength });
    knownTotal += request.byteLength;
  }
  if (knownTotal > limits.inputBytes) throw new NativeContextError("native-context-limit-exceeded", { limit: "inputBytes", maximum: limits.inputBytes, observed: knownTotal });
  const bytes = readOnlyGit(root, "cat-file", ["--batch"], {
    input: `${checked.map(request => request.objectId).join("\n")}\n`,
    maxBytes: limits.responseBytes
  });
  return decodeGitBlobBatch(bytes, checked, limits);
}
