import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { type RmDirOptions, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync as nodeRmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stableYaml, type Json } from "@archcontext/contracts";

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
  // The bundle keeps the core native dependencies external, so it must sit where Node resolves them
  // the way an installed package does: under the owning workspace's node_modules.
  const cacheRoot = join(REPO_ROOT, "packages", "core", "node_modules", ".cache");
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
}

/** Runs the bundle with Node, the runtime the published `bin/archctx.mjs` targets. */
function runBundle(cwd: string, args: string[], options: BundleRunOptions = {}): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [bundlePath, ...args], { cwd, env: options.env ?? process.env });
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
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        rejectPromise(new Error(`archctx ${args.join(" ")} did not print JSON: ${stderr || stdout}`));
      }
    });
    child.stdin.end(options.stdin ?? "");
  });
}
