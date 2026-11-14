import { assertLocalEgressAllowed, localEgressMode } from "@archcontext/local-runtime/egress-admission";
import { execFileSync } from "node:child_process";
import { accessSync, closeSync, constants as fsConstants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { codeGraphChildEnv } from "./child-env";
import { digestJson, type Json } from "@archcontext/contracts";
import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION } from "./read-session";

// The CodeGraph CLI as archctx starts it: resolving the binary, attesting the packaged runtime, and
// running `sync`, which builds the index. Reads never start the CLI (ADR-0058).

export const CODEGRAPH_TELEMETRY_ENV = "DO_NOT_TRACK";
export const CODEGRAPH_TELEMETRY_DISABLED_VALUE = "1";
export const DEFAULT_CODEGRAPH_BINARY = "codegraph";
const requireFromAdapter = createRequire(import.meta.url);

type MutableEnv = Record<string, string | undefined>;
export const CODEGRAPH_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;

export function disableCodeGraphTelemetryByDefault(env: MutableEnv = process.env): string {
  localEgressMode(env);
  if (env[CODEGRAPH_TELEMETRY_ENV] !== undefined && env[CODEGRAPH_TELEMETRY_ENV] !== CODEGRAPH_TELEMETRY_DISABLED_VALUE) assertLocalEgressAllowed("codegraph-telemetry", env);
  env[CODEGRAPH_TELEMETRY_ENV] ??= CODEGRAPH_TELEMETRY_DISABLED_VALUE;
  return env[CODEGRAPH_TELEMETRY_ENV] ?? CODEGRAPH_TELEMETRY_DISABLED_VALUE;
}

/** Default bound on one `sync` of the index; the projection handshake passes its own. */
const CODEGRAPH_SYNC_TIMEOUT_MS = 30_000;

export interface CodeGraphCliInvocation {
  command: string;
  argsPrefix: string[];
}

/** Projection-runtime resolution is deliberately package-local; PATH is not an authority. */
export function packagedCodeGraphCliInvocation(): CodeGraphCliInvocation {
  const packagedShim = resolvePackagedCodeGraphShim();
  if (!packagedShim) {
    throw new Error(`CodeGraph package-local ${REQUIRED_CODEGRAPH_VERSION} binary is unavailable`);
  }
  return { command: process.execPath, argsPrefix: [packagedShim] };
}

export function codeGraphCliInvocation(binary: string, cwd: string, pathValue = process.env.PATH ?? ""): CodeGraphCliInvocation {
  const resolved = resolveExecutable(binary, cwd, pathValue);
  if (resolved && isNodeRuntimeScript(resolved)) {
    return { command: process.execPath, argsPrefix: [resolved] };
  }
  if (!resolved && binary === DEFAULT_CODEGRAPH_BINARY) {
    const packagedShim = resolvePackagedCodeGraphShim();
    if (packagedShim) return { command: process.execPath, argsPrefix: [packagedShim] };
  }
  return { command: binary, argsPrefix: [] };
}

function resolveExecutable(binary: string, cwd: string, pathValue: string): string | undefined {
  if (binary.includes("/") || binary.includes("\\")) {
    const path = isAbsolute(binary) ? binary : join(cwd, binary);
    return existsSync(path) ? realpathSync.native(path) : undefined;
  }
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const path = join(dir, binary);
    if (isExecutablePath(path)) return realpathSync.native(path);
  }
  return undefined;
}

export function isExecutablePath(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePackagedCodeGraphShim(): string | undefined {
  try {
    const manifestPath = requireFromAdapter.resolve(`${REQUIRED_CODEGRAPH_PACKAGE}/package.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: string;
      bin?: Record<string, string>;
    };
    const relativeBin = manifest.bin?.codegraph;
    if (manifest.version !== REQUIRED_CODEGRAPH_VERSION || !relativeBin) return undefined;
    const shimPath = resolve(dirname(manifestPath), relativeBin);
    return existsSync(shimPath) ? realpathSync.native(shimPath) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binds the projection receipt to the executable platform bundle, not only to the npm launcher.
 * CodeGraph's public package is a thin shim which execs a platform package containing its own
 * Node runtime and CLI entrypoint, so all of those executable layers are part of the authority.
 */
export function packagedCodeGraphRuntimeDigest(): string {
  try {
    const manifestPath = requireFromAdapter.resolve(`${REQUIRED_CODEGRAPH_PACKAGE}/package.json`);
    const packageRequire = createRequire(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: string;
      bin?: Record<string, string>;
    };
    if (manifest.version !== REQUIRED_CODEGRAPH_VERSION || !manifest.bin?.codegraph) {
      throw new Error(`package manifest is not exact ${REQUIRED_CODEGRAPH_VERSION}`);
    }
    const platformPackage = `${REQUIRED_CODEGRAPH_PACKAGE}-${process.platform}-${process.arch}`;
    const platformManifestPath = packageRequire.resolve(`${platformPackage}/package.json`);
    const platformManifest = JSON.parse(readFileSync(platformManifestPath, "utf8")) as { version?: string };
    if (platformManifest.version !== REQUIRED_CODEGRAPH_VERSION) {
      throw new Error(`platform bundle is not exact ${REQUIRED_CODEGRAPH_VERSION}`);
    }
    const packageRoot = dirname(manifestPath);
    const platformRoot = dirname(platformManifestPath);
    const runtimeFiles = process.platform === "win32"
      ? ["node.exe", "lib/dist/bin/codegraph.js"]
      : ["bin/codegraph", "node", "lib/dist/bin/codegraph.js"];
    return digestJson({
      packageName: REQUIRED_CODEGRAPH_PACKAGE,
      packageVersion: REQUIRED_CODEGRAPH_VERSION,
      packageManifestDigest: digestFile(manifestPath),
      launcherDigest: digestFile(resolve(packageRoot, manifest.bin.codegraph)),
      platformPackage,
      platformManifestDigest: digestFile(platformManifestPath),
      runtimeFileDigests: runtimeFiles.map((path) => ({ path, digest: digestFile(resolve(platformRoot, path)) }))
    } as unknown as Json);
  } catch (error) {
    throw new Error(`CodeGraph package-local runtime is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isNodeRuntimeScript(path: string): boolean {
  if (/\.[cm]?js$/i.test(path)) return true;
  const prefix = readFilePrefix(path, 256);
  return prefix.startsWith("#!/usr/bin/env node")
    || prefix.startsWith("#!/usr/bin/env bun")
    || prefix.startsWith("#!/usr/bin/node")
    || prefix.startsWith("#!/usr/local/bin/node");
}

function readFilePrefix(path: string, length: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytes).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function digestFile(path: string): string {
  try {
    return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  } catch (error) {
    throw new Error(`CodeGraph binary is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The CLI that runs `sync`: the packaged one unless the caller names another binary. PATH is not
 * an authority here; a named binary is resolved as a path, then spawned as given.
 */
export function codeGraphSyncInvocation(workspaceRoot: string, binary: string = DEFAULT_CODEGRAPH_BINARY): CodeGraphCliInvocation {
  return binary === DEFAULT_CODEGRAPH_BINARY ? packagedCodeGraphCliInvocation() : codeGraphCliInvocation(binary, workspaceRoot, "");
}

/**
 * Brings the index of `workspaceRoot` up to its sources with the CodeGraph CLI. `sync` is the only
 * command archctx starts (ADR-0058 Decision 2), under `codeGraphChildEnv`; no read goes through
 * the CLI. A failure carries the deadline, the elapsed time and how the child ended, never its
 * arguments, which may contain repository paths.
 */
export function syncCodeGraphIndex(workspaceRoot: string, options: { binary?: string; timeoutMs?: number } = {}): void {
  const invocation = codeGraphSyncInvocation(workspaceRoot, options.binary);
  const timeout = options.timeoutMs ?? CODEGRAPH_SYNC_TIMEOUT_MS;
  disableCodeGraphTelemetryByDefault();
  const startedAt = performance.now();
  try {
    execFileSync(invocation.command, [...invocation.argsPrefix, "sync", workspaceRoot, "--quiet"], {
      cwd: workspaceRoot,
      env: codeGraphChildEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
      timeout
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    const child = error as { code?: string | number; status?: number | null; signal?: string | null } | null;
    const diagnostics = {
      subcommand: "sync",
      deadlineMs: timeout,
      elapsedMs: Math.round(performance.now() - startedAt),
      code: child?.code ?? null,
      exitCode: child?.status ?? null,
      signal: child?.signal ?? null
    };
    throw new Error(`CodeGraph sync failed: ${message}\nCodeGraph sync diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}
