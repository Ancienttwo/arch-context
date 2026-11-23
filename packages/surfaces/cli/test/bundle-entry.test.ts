import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { type RmDirOptions, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync as nodeRmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ARCHCONTEXT_NODE_RANGE, stableYaml, type Json } from "@archcontext/contracts";
import { selectDarwinSqliteLibrary } from "../bin/bun-darwin-sqlite";

/**
 * #297: the published `bin/archctx.mjs` is a `bun build` bundle run by Node. In-process `runCli`
 * tests import the module, so `import.meta.main` is false and every module constant is set before
 * any test calls it. Only the real bundle shows when the entry block runs before late module
 * initializers. Keep these build flags equal to the release build in
 * `scripts/fg6-npm-release-dry-run.ts` and `scripts/local-product-tarball-smoke.mjs`.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PROCESS_TIMEOUT_MS = process.platform === "win32" ? 120_000 : 30_000;
const TEST_TIMEOUT_MS = process.platform === "win32" ? 300_000 : 90_000;
const NODE_FILE = ".archcontext/model/nodes/module.bundle-smoke.yaml";

// Windows can hold a temp repo briefly after `daemon stop`; cleanup must not fail the test.
function rmSync(path: string, options?: RmDirOptions): void {
  try {
    nodeRmSync(path, { maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100, ...options });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
}

let buildRoot: string;
let bundlePath: string;

beforeAll(() => {
  // The bundle keeps the local-runtime native dependencies external, so it must sit where Node resolves them
  // the way an installed package does: under the owning workspace's node_modules.
  const cacheRoot = join(REPO_ROOT, "packages", "local-runtime", "node_modules", ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  buildRoot = mkdtempSync(join(cacheRoot, "archctx-bundle-entry-"));
  execFileSync("bun", [
    "build",
    "packages/surfaces/cli/src/main.ts",
    "--target=node",
    "--format=esm",
    "--outdir",
    buildRoot,
    "--entry-naming",
    "archctx.mjs",
    "--external=@colbymchenry/codegraph",
    "--external=@node-rs/jieba",
    "--external=@node-rs/jieba/dict.js",
    "--external=koffi"
  ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  bundlePath = join(buildRoot, "archctx.mjs");
  expect(existsSync(bundlePath)).toBe(true);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  if (buildRoot) rmSync(buildRoot, { recursive: true, force: true });
});

describe("bundled bin/archctx.mjs (#297)", () => {
  test("the CLI entry block stays after every top-level declaration of main.ts", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/surfaces/cli/src/main.ts"), "utf8");
    const entry = source.indexOf("\nif (import.meta.main) {");
    expect(entry).toBeGreaterThan(0);
    expect(source.slice(entry).match(/^(export )?(const|let|var|class) .*/gm) ?? []).toEqual([]);
  });

  test("plan --help and hash --help print their help text", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "archctx-bundle-help-"));
    try {
      const planHelp = await runBundle(cwd, ["plan", "--help"]);
      expect(planHelp.ok, JSON.stringify(planHelp)).toBe(true);
      expect(planHelp.data?.command).toContain("--operations-file");
      expect(planHelp.data?.operations).toContain("--operations-file");
      for (const format of [[], ["--format", "json"]]) {
        const hashHelp = await runBundle(cwd, ["hash", "--help", ...format]);
        expect(hashHelp.ok, JSON.stringify(hashHelp)).toBe(true);
        expect(hashHelp.data?.command).toBe("archctx hash --path <repo-relative file>");
        expect(hashHelp.data?.formula).toContain("digestJson");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  test("plan --operations-file plans an empty array, a real operation and stdin input; argument errors are not runtime outages", async () => {
    const repo = mkdtempSync(join(tmpdir(), "archctx-bundle-plan-"));
    const stateDir = mkdtempSync(join(tmpdir(), "archctx-bundle-state-"));
    const env = { ...process.env, ARCHCONTEXT_STATE_DIR: stateDir };
    try {
      writeFileSync(join(repo, "README.md"), "# bundle smoke\n", "utf8");
      execFileSync("git", ["init", "-q"], { cwd: repo });
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "fixture"], { cwd: repo });
      expect((await runBundle(repo, ["init", "--name", "Bundle Smoke"], { env })).ok).toBe(true);

      writeFileSync(join(repo, "empty.json"), "[]", "utf8");
      const empty = await runBundle(repo, ["plan", "--id", "changeset.bundle-empty", "--operations-file", "empty.json"], { env });
      expect(empty.ok, JSON.stringify(empty)).toBe(true);
      expect(empty.data?.draft?.operations).toEqual([]);

      const operations = [{ op: "create_entity", path: NODE_FILE, expectedHash: "missing", body: stableYaml(bundleNode()) }];
      writeFileSync(join(repo, "create.json"), JSON.stringify(operations), "utf8");
      const fromFile = await runBundle(repo, ["plan", "--id", "changeset.bundle-file", "--operations-file", "create.json"], { env });
      expect(fromFile.ok, JSON.stringify(fromFile)).toBe(true);
      expect(fromFile.data?.draft?.operations).toHaveLength(1);
      expect(fromFile.data?.preview?.allowed).toBe(true);

      const fromStdin = await runBundle(repo, ["plan", "--id", "changeset.bundle-stdin", "--operations-file", "-"], { env, stdin: JSON.stringify(operations) });
      expect(fromStdin.ok, JSON.stringify(fromStdin)).toBe(true);
      expect(fromStdin.data?.draft?.operations).toEqual(fromFile.data?.draft?.operations);

      // A missing required flag is the caller's error: not retryable, not a reconnect hint.
      const missingDigest = await runBundle(repo, ["apply", "--id", "changeset.bundle-file", "--approved"], { env, allowFailure: true });
      expect(missingDigest.ok).toBe(false);
      expect(missingDigest.error).toMatchObject({ code: "AC_SCHEMA_INVALID", retryable: false, message: "--expected-worktree-digest is required" });

      const applied = await runBundle(repo, ["apply", "--id", "changeset.bundle-file", "--approved", "--expected-worktree-digest", fromFile.data?.draft?.base?.worktreeDigest], { env });
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      expect(existsSync(join(repo, NODE_FILE))).toBe(true);
    } finally {
      await runBundle(repo, ["daemon", "stop"], { env, allowFailure: true }).catch(() => undefined);
      rmSync(repo, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  test("Node bundle isolates v2 cache in local-cache-v2.sqlite and refuses unproven or legacy stores unchanged", async () => {
    const repo = mkdtempSync(join(tmpdir(), "archctx-bundle-sqlite-upgrade-"));
    const stateDir = mkdtempSync(join(tmpdir(), "archctx-bundle-sqlite-state-"));
    const dbDir = mkdtempSync(join(tmpdir(), "archctx-bundle-sqlite-dbs-"));
    const generatedIndexDbPath = join(dbDir, "legacy-generated-index.sqlite");
    const v2CustomIndexDbPath = join(dbDir, "v2-custom-index.sqlite");
    const foreignDbPath = join(dbDir, "foreign-overlap.sqlite");
    try {
      writeFileSync(join(repo, "README.md"), "# sqlite isolation fixture\n", "utf8");
      execFileSync("git", ["init", "-q"], { cwd: repo });
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "fixture"], { cwd: repo });

      const env = { ...process.env, ARCHCONTEXT_STATE_DIR: stateDir };
      const pathsRes = await runBundle(repo, ["paths", "--json"], { env });
      expect(pathsRes.ok, JSON.stringify(pathsRes)).toBe(true);
      const workspaceStateDir = String(pathsRes.data?.workspaceStateDir ?? "");
      const defaultV2CachePath = String(pathsRes.data?.localStorePath ?? "");
      const legacyRuntimePath = join(workspaceStateDir, "runtime.sqlite");
      expect(defaultV2CachePath).toBe(join(workspaceStateDir, "local-cache-v2.sqlite"));
      expect(String(pathsRes.data?.legacyLocalStorePath ?? "")).toContain("runtime.sqlite");

      execFileSync("node", [
        "--input-type=module",
        "-e",
        `
          import { mkdirSync } from "node:fs";
          import { DatabaseSync } from "node:sqlite";
          mkdirSync(${JSON.stringify(workspaceStateDir)}, { recursive: true });
          const db = new DatabaseSync(${JSON.stringify(legacyRuntimePath)});
          db.exec(\`
            CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE repository_sessions (repository_id TEXT PRIMARY KEY, root TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE snapshots (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT);
            CREATE TABLE task_states (task_session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE observed_evidence (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, selector_json TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE review_results (review_id TEXT PRIMARY KEY, task_session_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE changeset_journal (
              journal_id TEXT PRIMARY KEY, changeset_id TEXT NOT NULL, root TEXT NOT NULL, status TEXT NOT NULL,
              metadata_json TEXT NOT NULL, files_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
            );
            CREATE TABLE projection_apply_receipts (
              lookup_key TEXT PRIMARY KEY, apply_id TEXT NOT NULL UNIQUE, journal_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL,
              refresh_consumed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, recovery_proof_json TEXT,
              FOREIGN KEY(journal_id) REFERENCES changeset_journal(journal_id)
            );
            CREATE TABLE waivers (
              waiver_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, storage_repository_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL, storage_workspace_id TEXT NOT NULL, event_id TEXT NOT NULL,
              target_kind TEXT NOT NULL, target_id TEXT NOT NULL, waiver_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT
            );
            CREATE TRIGGER preserve_legacy_trigger AFTER INSERT ON snapshots BEGIN SELECT 1; END;
            CREATE VIRTUAL TABLE architecture_ledger_fts USING fts5(kind, summary, rationale, title, evidence_summary, content='');
            CREATE VIEW recent_architecture_changes_view AS SELECT id FROM snapshots;
            INSERT INTO schema_migrations VALUES ('0001_runtime_state', '2026-11-20T00:00:00.000Z');
            INSERT INTO changeset_journal VALUES ('j1', 'cs1', '/repo', 'applied', '{}', '[]', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
            INSERT INTO projection_apply_receipts VALUES ('lk1', 'ap1', 'j1', '{}', NULL, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL);
            INSERT INTO waivers VALUES ('wv1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'module', 'm1', '{}', '2026-11-20T00:00:00.000Z', NULL);
          \`);
          db.close();

          const gdb = new DatabaseSync(${JSON.stringify(generatedIndexDbPath)});
          gdb.exec(\`
            CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE repository_sessions (repository_id TEXT PRIMARY KEY, root TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE snapshots (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT);
            CREATE TABLE task_states (task_session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE observed_evidence (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, selector_json TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE review_results (review_id TEXT PRIMARY KEY, task_session_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE waivers (
              waiver_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, storage_repository_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL, storage_workspace_id TEXT NOT NULL, event_id TEXT NOT NULL,
              target_kind TEXT NOT NULL, target_id TEXT NOT NULL, waiver_json TEXT NOT NULL,
              created_at TEXT NOT NULL, expires_at TEXT,
              local_reporting TEXT GENERATED ALWAYS AS (waiver_id || ':' || target_id) STORED
            );
            CREATE INDEX custom_reporting_idx ON waivers(local_reporting);
            INSERT INTO schema_migrations VALUES ('0001_runtime_state', '2026-11-20T00:00:00.000Z');
            INSERT INTO waivers (waiver_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, target_kind, target_id, waiver_json, created_at, expires_at)
              VALUES ('wv1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'module', 'm1', '{}', '2026-11-20T00:00:00.000Z', NULL);
          \`);
          gdb.close();

          const v2IdxDb = new DatabaseSync(${JSON.stringify(v2CustomIndexDbPath)});
          v2IdxDb.exec(\`
            CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE external_docs_cache (
              provider TEXT NOT NULL, library_id TEXT NOT NULL, version TEXT NOT NULL, query_digest TEXT NOT NULL,
              content_digest TEXT NOT NULL, resource_json TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
              PRIMARY KEY (provider, library_id, version, query_digest)
            );
            CREATE TABLE kv_cache (
              namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
              gen_key TEXT GENERATED ALWAYS AS (namespace || ':' || cache_key) STORED,
              PRIMARY KEY (namespace, cache_key)
            );
            CREATE INDEX custom_kv_idx ON kv_cache(updated_at);
            PRAGMA user_version = 200;
          \`);
          v2IdxDb.close();

          const fdb = new DatabaseSync(${JSON.stringify(foreignDbPath)});
          fdb.exec(\`
            CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
            CREATE TABLE snapshots (id INTEGER PRIMARY KEY, body TEXT);
            CREATE TABLE recommendations (id INTEGER PRIMARY KEY);
            CREATE TABLE waivers (id INTEGER PRIMARY KEY);
            INSERT INTO snapshots (id, body) VALUES (1, 'preserve-me');
          \`);
          fdb.close();
        `
      ]);

      const legacyBytesBefore = readFileSync(legacyRuntimePath);
      const status = await runBundle(repo, ["status", "--json"], { env });
      expect(status.ok, JSON.stringify(status)).toBe(true);
      expect(readFileSync(legacyRuntimePath)).toEqual(legacyBytesBefore);

      const inspected = JSON.parse(execFileSync("node", [
        "--input-type=module",
        "-e",
        `
          import { DatabaseSync } from "node:sqlite";
          const db = new DatabaseSync(${JSON.stringify(defaultV2CachePath)}, { readOnly: true });
          const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger', 'index') AND name NOT LIKE 'sqlite_%' AND (type != 'index' OR sql IS NOT NULL) ORDER BY name").all();
          const userVersion = Number(db.prepare("PRAGMA user_version").get().user_version);
          const applicationId = Number(db.prepare("PRAGMA application_id").get().application_id);
          db.close();
          console.log(JSON.stringify({ objects, userVersion, applicationId }));
        `
      ], { encoding: "utf8" }));
      expect(inspected).toEqual({
        objects: [
          { type: "table", name: "architecture_debt_base_cache" },
          { type: "table", name: "external_docs_cache" },
          { type: "table", name: "kv_cache" }
        ],
        userVersion: 200,
        applicationId: 0x41435458
      });

      for (const blockedDbPath of [legacyRuntimePath, generatedIndexDbPath, v2CustomIndexDbPath, foreignDbPath]) {
        const bytesBefore = readFileSync(blockedDbPath);
        const dirBefore = readdirSync(dirname(blockedDbPath)).sort();
        const refused = await runBundle(repo, ["status", "--json"], {
          env: { ...env, ARCHCONTEXT_LOCAL_STORE_PATH: blockedDbPath },
          allowFailure: true
        });
        expect(refused.ok).toBe(false);
        expect(refused.error).toMatchObject({
          code: "AC_PRECONDITION_FAILED",
          reasonCode: "local-store-unproven-file"
        });
        expect(readFileSync(blockedDbPath)).toEqual(bytesBefore);
        expect(readdirSync(dirname(blockedDbPath)).sort()).toEqual(dirBefore);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(dbDir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);
});

describe("Node engine range at the bundled entry (#322)", () => {
  test("every entry branch refuses a Node.js outside the engine range with a typed error and starts nothing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "archctx-bundle-node-range-"));
    const stateDir = mkdtempSync(join(tmpdir(), "archctx-bundle-node-range-state-"));
    const stubDir = mkdtempSync(join(tmpdir(), "archctx-bundle-node-range-stub-"));
    const env = { ...process.env, ARCHCONTEXT_STATE_DIR: stateDir };
    try {
      writeFileSync(join(cwd, "README.md"), "# node range\n", "utf8");
      execFileSync("git", ["init", "-q"], { cwd });
      // Node keeps `process.versions.node` configurable, so a preload can pose as an unsupported
      // Node.js without installing one; the bundle reads the same property the release bin does.
      const stub = join(stubDir, "node-26.mjs");
      writeFileSync(stub, 'Object.defineProperty(process.versions, "node", { value: "26.10.0" });\n', "utf8");
      const nodeArgs = ["--import", pathToFileURL(stub).href];
      for (const args of [["validate"], ["capabilities", "--json"], ["daemon", "start"], ["daemon", "start", "--foreground", "--port", "0"], ["docs", "--help"]]) {
        const result = await runBundle(cwd, args, { env, nodeArgs, allowFailure: true, expectExitCode: 1 });
        expect(result, args.join(" ")).toMatchObject({
          ok: false,
          requestId: args[0],
          error: {
            code: "AC_NODE_VERSION_UNSUPPORTED",
            retryable: false,
            action: "use-supported-node-version",
            details: { nodeVersion: "26.10.0", supportedRange: ARCHCONTEXT_NODE_RANGE }
          }
        });
      }
      expect(readdirSync(stateDir)).toEqual([]);
      // Control: the same bundle on this (supported) Node.js answers normally.
      expect((await runBundle(cwd, ["capabilities", "--json"], { env })).schemaVersion).toBeString();
    } finally {
      await runBundle(cwd, ["daemon", "stop"], { env, allowFailure: true }).catch(() => undefined);
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);
});

describe("Darwin SQLite library selection (#574)", () => {
  const arm = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
  const intel = "/usr/local/opt/sqlite/lib/libsqlite3.dylib";

  test.each([
    [[arm, intel], arm, [arm]],
    [[arm], arm, [arm]],
    [[intel], intel, [arm, intel]],
    [[], undefined, [arm, intel]]
  ] as const)("selects from %j in closed-list order", (available, expected, probes) => {
    const seen: string[] = [];
    const select = () => selectDarwinSqliteLibrary(path => {
      seen.push(path);
      return (available as readonly string[]).includes(path);
    });
    if (expected === undefined) {
      expect(select).toThrow(`none of ${arm}, ${intel} exists. Install it with \`brew install sqlite\`.`);
    } else {
      expect(select()).toBe(expected);
    }
    expect(seen).toEqual([...probes]);
  });
});

function bundleNode(): Json {
  return {
    schemaVersion: "archcontext.node/v2",
    id: "module.bundle-smoke",
    kind: "module",
    name: "Bundle smoke",
    status: "active",
    summary: "Created through the bundled CLI.",
    source: { include: ["src/bundle-smoke/**"] }
  };
}

interface BundleRunOptions {
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  allowFailure?: boolean;
  /** With `allowFailure`, the exit code the run must end with. */
  expectExitCode?: number;
  nodeArgs?: string[];
  runtime?: "node" | "bun";
}

/** Runs the bundle with Node by default, the runtime the published `bin/archctx.mjs` targets. */
function runBundle(cwd: string, args: string[], options: BundleRunOptions = {}): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const childArgs = [...(options.nodeArgs ?? []), bundlePath, ...args];
    const childOptions = { cwd, env: options.env ?? process.env };
    const child = options.runtime === "bun"
      ? spawn("bun", childArgs, childOptions)
      : spawn("node", childArgs, childOptions);
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`archctx ${args.join(" ")} timed out: ${stderr || stdout}`));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !options.allowFailure) {
        rejectPromise(new Error(`archctx ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
        return;
      }
      if (options.expectExitCode !== undefined && code !== options.expectExitCode) {
        rejectPromise(new Error(`archctx ${args.join(" ")} exited ${code}, expected ${options.expectExitCode}: ${stderr || stdout}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        rejectPromise(new Error(`archctx ${args.join(" ")} did not print JSON: ${stderr || stdout}`));
      }
    });
    child.stdin.end(options.stdin ?? "");
  });
}
