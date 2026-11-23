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

  test("Node bundle upgrades FK-linked v0.17.1 stores safely under foreign_keys=ON and refuses foreign DBs unchanged", async () => {
    const repo = mkdtempSync(join(tmpdir(), "archctx-bundle-sqlite-upgrade-"));
    const stateDir = mkdtempSync(join(tmpdir(), "archctx-bundle-sqlite-state-"));
    const dbDir = mkdtempSync(join(tmpdir(), "archctx-bundle-sqlite-dbs-"));
    const legacyDbPath = join(dbDir, "legacy-v0171.sqlite");
    const foreignDbPath = join(dbDir, "foreign-overlap.sqlite");
    try {
      writeFileSync(join(repo, "README.md"), "# sqlite upgrade fixture\n", "utf8");
      execFileSync("git", ["init", "-q"], { cwd: repo });
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "fixture"], { cwd: repo });

      execFileSync("node", [
        "--input-type=module",
        "-e",
        `
          import { DatabaseSync } from "node:sqlite";
          const db = new DatabaseSync(${JSON.stringify(legacyDbPath)});
          const fkEnabled = Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys);
          if (fkEnabled !== 1) throw new Error("expected node:sqlite foreign_keys=1 by default, got " + fkEnabled);
          db.exec(\`
            CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE repository_sessions (repository_id TEXT PRIMARY KEY, root TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE snapshots (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT);
            CREATE TABLE task_states (task_session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE observed_evidence (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, selector_json TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE review_results (review_id TEXT PRIMARY KEY, task_session_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE changeset_journal (
              journal_id TEXT PRIMARY KEY,
              changeset_id TEXT NOT NULL,
              root TEXT NOT NULL,
              status TEXT NOT NULL,
              metadata_json TEXT NOT NULL,
              files_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT
            );
            CREATE TABLE projection_apply_receipts (
              lookup_key TEXT PRIMARY KEY,
              apply_id TEXT NOT NULL UNIQUE,
              journal_id TEXT NOT NULL UNIQUE,
              receipt_json TEXT NOT NULL,
              refresh_consumed_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              recovery_proof_json TEXT,
              FOREIGN KEY(journal_id) REFERENCES changeset_journal(journal_id)
            );
            CREATE TABLE architecture_events (
              event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id TEXT NOT NULL UNIQUE,
              repository_id TEXT NOT NULL,
              storage_repository_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              storage_workspace_id TEXT NOT NULL,
              branch TEXT NOT NULL,
              head_sha TEXT NOT NULL,
              worktree_digest TEXT NOT NULL,
              event_type TEXT NOT NULL,
              payload_version TEXT NOT NULL,
              source TEXT NOT NULL,
              actor_kind TEXT NOT NULL,
              actor_id TEXT NOT NULL,
              base_digest TEXT NOT NULL,
              resulting_digest TEXT NOT NULL,
              previous_event_hash TEXT,
              event_hash TEXT NOT NULL UNIQUE,
              idempotency_key TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              provenance_json TEXT NOT NULL,
              event_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              compacted_by_snapshot_id TEXT
            );
            CREATE TABLE evidence_items (
              evidence_id TEXT PRIMARY KEY,
              repository_id TEXT NOT NULL,
              storage_repository_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              storage_workspace_id TEXT NOT NULL,
              event_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              strength TEXT NOT NULL,
              polarity TEXT NOT NULL,
              origin TEXT NOT NULL,
              subject TEXT NOT NULL,
              selector_json TEXT NOT NULL,
              summary TEXT NOT NULL,
              coverage_json TEXT NOT NULL,
              supports_json TEXT NOT NULL,
              provenance_json TEXT NOT NULL,
              evidence_json TEXT NOT NULL,
              digest TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
            );
            CREATE TABLE evidence_bindings (
              binding_id TEXT PRIMARY KEY,
              evidence_id TEXT NOT NULL,
              repository_id TEXT NOT NULL,
              storage_repository_id TEXT NOT NULL,
              workspace_id TEXT NOT NULL,
              storage_workspace_id TEXT NOT NULL,
              event_id TEXT NOT NULL,
              target_kind TEXT NOT NULL,
              target_id TEXT NOT NULL,
              binding_reason TEXT NOT NULL,
              authority_effect TEXT NOT NULL,
              provenance_json TEXT NOT NULL,
              binding_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT,
              FOREIGN KEY(evidence_id) REFERENCES evidence_items(evidence_id) ON DELETE RESTRICT
            );
            CREATE TABLE architecture_evidence_state_checkpoints (
              storage_repository_id TEXT NOT NULL,
              storage_workspace_id TEXT NOT NULL,
              event_id TEXT PRIMARY KEY,
              event_sequence INTEGER NOT NULL,
              scope_event_count INTEGER NOT NULL,
              event_hash TEXT NOT NULL,
              evidence_state_digest TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(event_id) REFERENCES architecture_events(event_id)
            );
            CREATE TRIGGER architecture_events_immutable_delete
              BEFORE DELETE ON architecture_events
              BEGIN
                SELECT RAISE(ABORT, 'architecture-events-immutable');
              END;
            CREATE TRIGGER architecture_evidence_state_checkpoints_immutable_delete
              BEFORE DELETE ON architecture_evidence_state_checkpoints
              BEGIN
                SELECT RAISE(ABORT, 'architecture-evidence-state-checkpoints-immutable');
              END;
            CREATE VIRTUAL TABLE architecture_ledger_fts USING fts5(kind, summary, rationale, title, evidence_summary, content='');
            CREATE VIEW recent_architecture_changes_view AS
              SELECT event_sequence, event_id, storage_repository_id, storage_workspace_id, branch, head_sha, event_type,
                source, actor_kind, actor_id, previous_event_hash, event_hash, created_at
              FROM architecture_events ORDER BY event_sequence DESC;
          \`);
          const insertMigration = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, '2026-11-20T00:00:00.000Z')");
          for (const id of [
            "0001_runtime_state", "0002_indexes", "0003_landscape_state", "0004_changeset_journal",
            "0005_external_docs_cache", "0006_architecture_ledger", "0007_runtime_job_queue",
            "0008_runtime_job_queue_hardening", "0009_architecture_ledger_search_fts", "0010_audit_runs",
            "0011_changeset_cleanup_cursor", "0012_explorer_projection_index", "0013_evidence_lifecycle",
            "0014_architecture_change_feed", "0015_snapshot_anchor_v2", "0016_manifest_addressed_projection_cache",
            "0017_explorer_cache_lifecycle", "0018_immutable_evidence_checkpoints", "0019_projection_apply_receipts",
            "0020_projection_apply_recovery_proof"
          ]) insertMigration.run(id);
          db.exec(\`
            INSERT INTO changeset_journal VALUES ('j1', 'cs1', '/repo', 'applied', '{}', '[]', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
            INSERT INTO projection_apply_receipts VALUES ('lk1', 'ap1', 'j1', '{}', NULL, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL);
            INSERT INTO architecture_events (
              event_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id,
              branch, head_sha, worktree_digest, event_type, payload_version, source, actor_kind, actor_id,
              base_digest, resulting_digest, previous_event_hash, event_hash, idempotency_key,
              payload_json, provenance_json, event_json, created_at, compacted_by_snapshot_id
            ) VALUES (
              'ev1', 'r1', 'sr1', 'w1', 'sw1', 'main', 'abc', 'wt1', 'changeset.applied', 'v1', 'cli', 'user', 'u1',
              'b1', 'r2', NULL, 'eh1', 'ik1', '{}', '{}', '{}', '2026-11-20T00:00:00.000Z', NULL
            );
            INSERT INTO evidence_items VALUES (
              'ei1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'test', 'strong', 'positive', 'cli', 'subj', '{}', 'ok', '{}', '[]', '{}', '{}', 'd1', '2026-11-20T00:00:00.000Z'
            );
            INSERT INTO evidence_bindings VALUES (
              'eb1', 'ei1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'module', 'm1', 'reason', 'supporting', '{}', '{}', '2026-11-20T00:00:00.000Z'
            );
            INSERT INTO architecture_evidence_state_checkpoints VALUES ('sr1', 'sw1', 'ev1', 1, 1, 'eh1', 'ed1', '2026-11-20T00:00:00.000Z');
          \`);
          db.close();
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

      const upgraded = await runBundle(repo, ["status", "--json"], {
        env: { ...process.env, ARCHCONTEXT_STATE_DIR: stateDir, ARCHCONTEXT_LOCAL_STORE_PATH: legacyDbPath }
      });
      expect(upgraded.ok, JSON.stringify(upgraded)).toBe(true);

      const inspected = JSON.parse(execFileSync("node", [
        "--input-type=module",
        "-e",
        `
          import { DatabaseSync } from "node:sqlite";
          const db = new DatabaseSync(${JSON.stringify(legacyDbPath)}, { readOnly: true });
          const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
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

      const foreignBytesBefore = readFileSync(foreignDbPath);
      const foreignFilesBefore = readdirSync(dbDir).sort();
      const refused = await runBundle(repo, ["status", "--json"], {
        env: { ...process.env, ARCHCONTEXT_STATE_DIR: stateDir, ARCHCONTEXT_LOCAL_STORE_PATH: foreignDbPath },
        allowFailure: true
      });
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatchObject({
        code: "AC_PRECONDITION_FAILED",
        reasonCode: "local-store-unproven-file"
      });
      expect(readFileSync(foreignDbPath)).toEqual(foreignBytesBefore);
      expect(readdirSync(dbDir).sort()).toEqual(foreignFilesBefore);
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
