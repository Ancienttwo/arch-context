import { expect } from "bun:test";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { type RmDirOptions, rmSync as nodeRmSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStartedDaemon } from "../src/index";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

export function rmSync(path: string, options?: RmDirOptions): void {
  try {
    nodeRmSync(path, { maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100, ...options });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

export function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  return root;
}

export function removeTempRepo(root: string): void {
  removeTempPath(root);
}

export function removeTempPath(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

export function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

export function createStartedTestDaemon(deps: Parameters<typeof createStartedDaemon>[0] = {}) {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore(),
    ...deps
  });
}

export function createGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

export function createInitializedGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-initialized-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  initializeArchContextModel(root, "Digest App");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

export function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function expectSameExistingPath(actual: string, expected: string): void {
  expect(normalizeExistingPath(actual)).toBe(normalizeExistingPath(expected));
}

export function normalizeExistingPath(path: string): string {
  const real = realpathSync.native(path);
  return process.platform === "win32" ? real.toLowerCase() : real;
}
