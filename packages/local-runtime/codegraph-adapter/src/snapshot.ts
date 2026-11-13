import { FailureError } from "@archcontext/contracts";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { REQUIRED_CODEGRAPH_VERSION, codeGraphBundle, pinnedCodeGraphProvider } from "./read-session";
import { readSnapshotQueries, type SnapshotQueryRequest, type SnapshotQueryReader } from "./snapshot-query";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { nativeNodeSource, type NativeModel } from "@archcontext/core/projection-engine";
import { CODEGRAPH_OUTPUT_MAX_BYTES, isExecutablePath } from "./cli-provider";
import { inspectRepositoryCodeFacts } from "./repository-code-facts";
import { normalizedIndexPath } from "./selector-index";

/**
 * The SDK and its Node executable must come from the same provider-selected platform bundle.
 * Only the private snapshot reader uses it; S4 of #574 removes both.
 */
export function codeGraphSnapshotRuntime(): { node: string; sdk: string } {
  let bundle: ReturnType<typeof codeGraphBundle>;
  let version: string;
  try {
    bundle = codeGraphBundle();
    version = pinnedCodeGraphProvider().version;
  } catch {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
  }
  if (version !== REQUIRED_CODEGRAPH_VERSION) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
  const node = join(bundle.platformRoot, process.platform === "win32" ? "node.exe" : "node");
  if (!isExecutablePath(node)) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
  return { node, sdk: join(bundle.dist, "index.js") };
}

function codeGraphSourceScanner(): (root: string) => string[] {
  try { return pinnedCodeGraphProvider().scanSourceFiles; }
  catch { throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable"); }
}

/** Bytes bound the copied source/config, Git metadata, database and WAL; entries also count the uncopied Git objects. */
export const CODEGRAPH_SNAPSHOT_MAX_BYTES = 512 * 1024 * 1024;
export const CODEGRAPH_SNAPSHOT_MAX_ENTRIES = 100_000;

export function codeGraphSnapshotQueries(nodes: NativeModel["nodes"], purpose: "flow" | "ref" = "flow"): SnapshotQueryRequest {
  const names = new Set<string>();
  const sources = new Map<string, { name: string; path: string }>();
  for (const node of nodes) for (const entry of nativeNodeSource(node)?.entrypoints ?? []) {
    for (const symbol of entry.symbols) for (const sink of symbol.sinks) {
      names.add(symbol.name); names.add(sink.symbol);
      const path = normalizedIndexPath(entry.path);
      sources.set(`${path}\0${symbol.name}`, { path, name: symbol.name });
    }
  }
  return { names: [...names].sort(), sources: purpose === "flow" ? [...sources.values()] : [], includeFiles: purpose === "ref" };
}

/**
 * Runs synchronous readers against a private, ready CodeGraph snapshot. Provider status opens
 * writable and SQLite readOnly can create WAL/SHM files, so neither ever sees the original root.
 * The provider-enumerated filesystem mirror preserves source discovery and configuration rather
 * than approximating its source extensions, ignores or content hashes. Nothing is re-indexed.
 */
export function withExistingCodeGraphSnapshot<T>(
  root: string,
  queries: SnapshotQueryRequest,
  callback: (graph: SnapshotQueryReader) => T
): T {
  const originalRoot = realpathSync.native(root);
  const redirectedGitInputs = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"];
  if (redirectedGitInputs.some(key => process.env[key]) || process.env.CODEGRAPH_DIR) {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
  }
  const indexDir = join(originalRoot, ".codegraph");
  if (!existsSync(join(indexDir, "codegraph.db"))) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
  if (lstatSync(indexDir).isSymbolicLink()) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
  const gitPath = (flag: string) => realpathSync.native(execFileSync("git", ["rev-parse", "--path-format=absolute", flag], {
    cwd: originalRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000
  }).trim());
  const gitDir = gitPath("--git-dir");
  const commonDir = gitPath("--git-common-dir");
  assertSnapshotGitReadSafety(originalRoot);
  const temporaryParent = realpathSync.native(tmpdir());
  const temporaryRelative = relative(originalRoot, temporaryParent);
  if (!temporaryRelative || (temporaryRelative !== ".." && !temporaryRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(temporaryRelative))) {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
  }
  const temporaryRoot = mkdtempSync(join(temporaryParent, "archctx-codegraph-snapshot-"));
  try {
    const snapshotRoot = join(temporaryRoot, "repository");
    mkdirSync(snapshotRoot);
    const before = mirrorCodeGraphInputs(originalRoot, gitDir, commonDir, snapshotRoot);
    if (before !== mirrorCodeGraphInputs(originalRoot, gitDir, commonDir)) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-changed");
    }
    const scan = codeGraphSourceScanner();
    if (JSON.stringify([...scan(originalRoot)].sort()) !== JSON.stringify([...scan(snapshotRoot)].sort())) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    }
    const ready = inspectRepositoryCodeFacts(snapshotRoot);
    if (ready.state !== "ready") {
      // C2: an unopenable index keeps its own reason; any other unavailable answer is code-facts-unavailable.
      if (ready.state === "unavailable") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", ready.reasonCode === "index-open-failed" ? "index-open-failed" : "code-facts-unavailable");
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-read-not-ready", { issues: ready.issues });
    }
    // Readiness above opened the copied index in-process, through the read session, and closed it.
    // The queries below still run in the provider's Node child, whose exit releases its SQLite
    // handles before the copy is removed. S4 of #574 removes this path.
    const graph = readSnapshotQueries(codeGraphSnapshotRuntime(), snapshotRoot, queries);
    const result = callback(graph);
    if (result !== null && typeof result === "object" && "then" in result) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    }
    if (before !== mirrorCodeGraphInputs(originalRoot, gitDir, commonDir)) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-changed");
    }
    return result;
  } catch (error) {
    if (error instanceof FailureError) throw error;
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertSnapshotGitReadSafety(root: string): void {
  const options = { cwd: root, stdio: "pipe" as const, timeout: 5_000, maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES };
  const config = spawnSync("git", ["config", "--get-regexp", "^(core\\.(worktree|fsmonitor)|include\\.|include[iI]f\\.)"], { ...options, encoding: "utf8" });
  if ((config.status !== 0 && config.status !== 1) || config.stdout.trim()) {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
  }
  // Provider readiness runs git status, which may execute clean/process filters on tracked
  // content. Configuration alone (e.g. a system LFS installation) does not select a filter.
  // Git owns attribute evaluation, including macros, nested attributes and info/attributes.
  let attributes: string[];
  let ambiguousDrivers: Set<string>;
  try {
    const tracked = execFileSync("git", ["ls-files", "--cached", "-z"], options);
    if (tracked.length === 0) return;
    const output = execFileSync("git", ["check-attr", "-z", "--stdin", "filter"], { ...options, input: tracked }).toString("utf8");
    attributes = output.split("\0");
    if (attributes.pop() !== "" || attributes.length % 3 !== 0) throw new Error("Invalid attribute response");
    // check-attr prints literal driver names "unset"/"unspecified" identically to its
    // sentinels. A configured driver with either name makes that response ambiguous.
    const drivers = spawnSync("git", ["config", "--name-only", "--get-regexp", "^filter\\.(unspecified|unset)\\.(clean|process)$"], { ...options, encoding: "utf8" });
    if (drivers.status !== 0 && drivers.status !== 1) throw new Error("Cannot inspect filter drivers");
    ambiguousDrivers = new Set(drivers.stdout.trim().split(/\r?\n/).filter(Boolean).map(key => key.split(".")[1]!));
  } catch {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
  }
  for (let index = 0; index < attributes.length; index += 3) {
    if (attributes[index + 1] !== "filter" || !["unspecified", "unset"].includes(attributes[index + 2]!) || ambiguousDrivers.has(attributes[index + 2]!)) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    }
  }
}

/**
 * A repository-local core.hooksPath replaces any copied, global or system value, so provider Git
 * operations (an index refresh runs post-index-change) cannot execute repository or user hooks.
 * A higher-precedence source such as config.worktree would beat the pin, so the value Git will
 * actually use must be exactly the pinned directory.
 */
function pinSnapshotHooks(snapshotRepository: string): void {
  const gitDir = join(snapshotRepository, ".git");
  const hooks = join(gitDir, "archctx-empty-hooks");
  mkdirSync(hooks);
  const path = process.platform === "win32" ? hooks.replaceAll("\\", "/") : hooks;
  const options = { cwd: snapshotRepository, encoding: "utf8" as const, stdio: "pipe" as const, timeout: 5_000 };
  const pinned = spawnSync("git", ["config", "--file", join(gitDir, "config"), "--replace-all", "core.hooksPath", path], options);
  const effective = spawnSync("git", ["config", "--get", "core.hooksPath"], options);
  if (pinned.status !== 0 || effective.status !== 0 || effective.stdout.replace(/\r?\n$/, "") !== path) {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
  }
}

function mirrorCodeGraphInputs(root: string, gitDir: string, commonDir: string, destination?: string): string {
  const hash = createHash("sha256");
  const measured = { sourceBytes: 0, sourceEntries: 0, gitBytes: 0, gitEntries: 0, gitObjectEntries: 0, indexBytes: 0, indexEntries: 0 };
  let bytes = 0;
  let entries = 0;
  // After the first cap trips nothing more is read or copied; the walk only completes the counts.
  let limit: "bytes" | "entries" | undefined;
  const fingerprint = (source: string, target: string) => {
    const stat = lstatSync(source, { bigint: true });
    if (++entries > CODEGRAPH_SNAPSHOT_MAX_ENTRIES) limit ??= "entries";
    hash.update(JSON.stringify([source, target, String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]));
    return stat;
  };
  const visit = (part: "source" | "git" | "index", source: string, target: string, skip: ReadonlySet<string> = new Set()) => {
    const stat = fingerprint(source, target);
    measured[`${part}Entries`]++;
    if (stat.isDirectory()) {
      if (destination && !limit) mkdirSync(join(destination, target), { recursive: true });
      for (const name of readdirSync(source).sort()) {
        if (!skip.has(name)) visit(part, join(source, name), join(target, name));
      }
    } else if (stat.isFile()) {
      if (basename(target) === ".git") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
      measured[`${part}Bytes`] += Number(stat.size);
      bytes += Number(stat.size);
      if (bytes > CODEGRAPH_SNAPSHOT_MAX_BYTES) limit ??= "bytes";
      if (limit) return;
      // Bound the actual read as well as the prior stat: a growing file must not bypass the cap.
      const data = Buffer.alloc(Number(stat.size));
      const fd = openSync(source, "r");
      try {
        let offset = 0;
        while (offset < data.length) {
          const count = readSync(fd, data, offset, data.length - offset, offset);
          if (count === 0) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-changed");
          offset += count;
        }
        if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-changed");
      } finally { closeSync(fd); }
      hash.update(data);
      if (destination) {
        mkdirSync(dirname(join(destination, target)), { recursive: true });
        writeFileSync(join(destination, target), data, { mode: Number(stat.mode) & 0o777 });
      }
    } else {
      // Following a symlink can silently omit an external source/config population or let a
      // provider write outside the mirror. Such layouts require a separate snapshot contract.
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    }
  };
  // Objects are fingerprinted, never read or copied: a write to the original store changes the
  // fingerprint, and the copy grows with what the read needs rather than with history.
  const visitObjects = (source: string, target: string) => {
    const stat = fingerprint(source, target);
    measured.gitObjectEntries++;
    if (stat.isDirectory()) {
      for (const name of readdirSync(source).sort()) visitObjects(join(source, name), join(target, name));
    } else if (!stat.isFile()) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    }
  };
  // The snapshot reads the original objects read-only through a snapshot-local alternate.
  // An original alternates chain, or a path Git cannot store in that file, is a separate layout.
  // Repository hooks are not part of the read; the snapshot pins its own empty hooks directory.
  const visitRepository = (source: string, target: string, skip: ReadonlySet<string>) => {
    const objects = join(source, "objects");
    if (existsSync(join(objects, "info/alternates"))) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    visit("git", source, target, new Set([...skip, "objects", "hooks", "archctx-empty-hooks"]));
    visitObjects(objects, join(target, "objects"));
    const original = realpathSync.native(objects);
    const alternate = process.platform === "win32" ? original.replaceAll("\\", "/") : original;
    if (/[\r\n]/.test(alternate)) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    if (destination && !limit) {
      mkdirSync(join(destination, target, "objects/pack"), { recursive: true });
      mkdirSync(join(destination, target, "objects/info"), { recursive: true });
      writeFileSync(join(destination, target, "objects/info/alternates"), `${alternate}\n`);
    }
  };
  const sourceFiles = codeGraphSourceScanner()(root);
  const files = new Set([...sourceFiles, ...listGitVisibleFiles(root)]);
  const directories = new Set(["."]);
  const repositories = new Set(["."]);
  for (const path of files) {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    let directory = dirname(path);
    while (directory !== ".") { directories.add(directory); directory = dirname(directory); }
  }
  for (const directory of directories) {
    for (const name of [".gitignore", ".gitattributes", "codegraph.json"]) {
      const path = join(directory, name);
      if (existsSync(join(root, path))) files.add(path);
    }
    if (directory !== "." && existsSync(join(root, directory, ".git"))) {
      visitRepository(join(root, directory, ".git"), join(directory, ".git"), new Set());
      assertSnapshotGitReadSafety(join(root, directory));
      repositories.add(directory);
    }
  }
  hash.update(JSON.stringify([...sourceFiles].sort()));
  for (const file of [...files].sort()) {
    if (file.split(/[\\/]/).some(part => part === ".git" || part === ".codegraph")) {
      throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-layout-unsupported");
    }
    visit("source", join(root, file), file);
  }
  visitRepository(commonDir, ".git", new Set(["worktrees"]));
  if (gitDir !== commonDir) visit("git", gitDir, ".git", new Set(["commondir", "gitdir"]));
  for (const suffix of ["", "-wal"]) {
    const source = join(root, ".codegraph", `codegraph.db${suffix}`);
    hash.update(JSON.stringify([suffix, existsSync(source)]));
    if (existsSync(source)) visit("index", source, join(".codegraph", `codegraph.db${suffix}`));
  }
  if (limit) {
    throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-snapshot-limit-exceeded", {
      limit, maxBytes: CODEGRAPH_SNAPSHOT_MAX_BYTES, maxEntries: CODEGRAPH_SNAPSHOT_MAX_ENTRIES, ...measured
    });
  }
  // Recheck the exact copied attribute population before any provider status operation.
  if (destination) for (const repository of repositories) {
    pinSnapshotHooks(join(destination, repository));
    assertSnapshotGitReadSafety(join(destination, repository));
  }
  return hash.digest("hex");
}
