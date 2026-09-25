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
