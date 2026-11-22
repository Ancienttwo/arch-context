import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
export const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
export const localRuntimeManifest = JSON.parse(readFileSync(join(root, "packages/local-runtime/package.json"), "utf8"));
export const releasePackageName = "archctx";
export const releaseHomeUrl = "https://github.com/Ancienttwo/arch-context";
export const releaseAssetFiles = [
  "assets/catalog.yaml",
  "assets/practices/s6-expanded.yaml",
  "assets/profiles/s6.yaml",
  "assets/sources/core.yaml",
  "assets/sources/s6.yaml"
];
export const releaseSchemaFiles = [
  "schemas/repo/practices/practice.schema.json",
  "schemas/repo/practices/practice-source.schema.json",
  "schemas/repo/practices/practice-profile.schema.json",
  "schemas/runtime/practice-catalog-manifest.schema.json",
  "schemas/runtime/practice-match.schema.json",
  "schemas/runtime/practice-guidance.schema.json",
  "schemas/runtime/practice-checkpoint.schema.json"
];

export function createSmokeHarness(timeoutMs) {
  const cleanupRoots = [];
  const mkdtempTracked = (prefix) => {
    const path = mkdtempSync(join(tmpdir(), prefix));
    cleanupRoots.push(path);
    return path;
  };
  const cleanupAll = () => {
    for (const path of cleanupRoots.reverse()) rmSync(path, { recursive: true, force: true });
  };
  const nodeOnlyRuntimeEnv = (stateRoot, home) => {
    const runtimeBinDir = mkdtempTracked("archctx-node-only-bin-");
    const runtimeNode = join(runtimeBinDir, process.platform === "win32" ? "node.cmd" : "node");
    writeFileSync(runtimeNode, process.platform === "win32"
      ? `@echo off\r\n${JSON.stringify(process.execPath)} %*\r\n`
      : `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`, "utf8");
    chmodSync(runtimeNode, 0o755);
    return {
      ...process.env,
      DO_NOT_TRACK: "1",
      HOME: home,
      USERPROFILE: home,
      ARCHCONTEXT_STATE_DIR: stateRoot,
      PATH: [runtimeBinDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter)
    };
  };
  const createGitFixture = () => {
    const workspace = mkdtempTracked("archctx-local-product-repo-");
    const repo = join(workspace, "fixture");
    cpSync(join(root, "packages/surfaces/cli/test/fixtures/single-repo-basic"), repo, { recursive: true });
    runSync("git", ["init"], { cwd: repo, env: process.env });
    runSync("git", ["add", "."], { cwd: repo, env: process.env });
    runSync("git", [
      "-c", "user.name=ArchContext Test",
      "-c", "user.email=archcontext@example.test",
      "commit", "-m", "fixture"
    ], { cwd: repo, env: process.env });
    return repo;
  };
  const buildLocalProductTarball = async (artifactDir) => {
    const stageDir = mkdtempTracked("archctx-local-product-stage-");
    const binDir = join(stageDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "archctx.mjs");
    await run("bun", [
      "build", "packages/surfaces/cli/src/main.ts",
      "--target=node", "--format=esm", "--outdir", binDir,
      "--entry-naming", "archctx.mjs",
      "--external=@colbymchenry/codegraph",
      "--external=@node-rs/jieba",
      "--external=@node-rs/jieba/dict.js",
      "--external=koffi"
    ], { cwd: root, env: process.env }, timeoutMs);
    rewriteShebang(binPath, "#!/usr/bin/env node");
    chmodSync(binPath, 0o755);
    copyReleaseSupportFiles(stageDir);

    writeFileSync(join(stageDir, "README.md"), [
      "# archctx", "",
      "ArchContext local runtime and CLI for agentic coding workflows.", "",
      `Product home: ${releaseHomeUrl}`, "",
      "This package contains the one-package Local Core distribution.",
      "It does not require a GitHub App, Cloud account, subscription, or LLM provider for Local Core."
    ].join("\n"), "utf8");
    writeFileSync(join(stageDir, "package.json"), JSON.stringify({
      name: releasePackageName,
      version: rootManifest.version,
      description: "Local architecture context CLI for agentic coding workflows.",
      private: false,
      type: "module",
      bin: { archctx: "./bin/archctx.mjs" },
      homepage: releaseHomeUrl,
      license: "Apache-2.0",
      publishConfig: { registry: "https://registry.npmjs.org/" },
      engines: rootManifest.engines,
      files: ["bin", "assets", "schemas", "NOTICE.md", "README.md"],
      dependencies: {
        "@colbymchenry/codegraph": rootManifest.dependencies?.["@colbymchenry/codegraph"],
        "@node-rs/jieba": localRuntimeManifest.dependencies?.["@node-rs/jieba"],
        koffi: localRuntimeManifest.dependencies?.koffi
      }
    }, null, 2), "utf8");
    assertNodeOnlyReleaseRuntime(stageDir, binPath);
    assertReleaseSupportFiles(stageDir);

    const output = await run("npm", ["pack", "--silent", "--pack-destination", artifactDir], { cwd: stageDir, env: process.env }, timeoutMs);
    const tarballName = output.stdout.trim().split("\n").at(-1);
    assert(tarballName, "npm pack did not return a tarball name");
    return { tarballPath: join(artifactDir, tarballName), stageDir };
  };
  const installTarball = async (tarballPath) => {
    const installDir = mkdtempTracked("archctx-local-product-install-");
    await run("npm", ["init", "-y"], { cwd: installDir, env: process.env }, timeoutMs);
    await run("npm", ["install", "--no-audit", "--no-fund", tarballPath], { cwd: installDir, env: process.env }, timeoutMs);
    return installDir;
  };
  return { mkdtempTracked, cleanupAll, nodeOnlyRuntimeEnv, createGitFixture, buildLocalProductTarball, installTarball };
}

function copyReleaseSupportFiles(stageDir) {
  cpSync(join(root, "packages/core/practice-catalog/assets"), join(stageDir, "assets"), { recursive: true });
  cpSync(join(root, "schemas"), join(stageDir, "schemas"), { recursive: true });
  writeFileSync(join(stageDir, "NOTICE.md"), renderNotice(stageDir), "utf8");
}

function renderNotice(stageDir) {
  const sources = readSourceRecords(join(stageDir, "assets", "sources"));
  return [
    "# archctx Notices", "",
    "This package includes curated architecture practice assets. The source registry bundled in `assets/sources/` is the authoritative provenance record.", "",
    ...sources.map((source) => `- ${String(source.name ?? source.id)} (${String(source.id ?? "unknown")}): ${String(source.licenseSpdx ?? "unknown license")}; ${String(source.attribution ?? "missing attribution")}; revision ${String(source.revision ?? "unknown")}.`),
    ""
  ].join("\n");
}

export function runArchctx(bin, commandArgs, options, timeoutMs) {
  return run(bin, commandArgs, options, timeoutMs).then(({ stdout }) => JSON.parse(stdout));
}

function runSync(command, commandArgs, options) {
  execFileSync(command, commandArgs, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
}

export function run(command, commandArgs, options, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`${command} ${commandArgs.join(" ")} timed out: ${stderr || stdout}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timeout); rejectPromise(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) { rejectPromise(new Error(`${command} ${commandArgs.join(" ")} failed (${code}): ${stderr || stdout}`)); return; }
      resolvePromise({ stdout, stderr });
    });
    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

export function runOptional(command, commandArgs, options, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, commandArgs, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { child.kill("SIGTERM"); resolvePromise({ code: 124, stdout, stderr }); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timeout); resolvePromise({ code: 127, stdout, stderr: error instanceof Error ? error.message : String(error) }); });
    child.once("exit", (code) => { clearTimeout(timeout); resolvePromise({ code: code ?? 1, stdout, stderr }); });
  });
}

export function resolveArchctxBin(binDir) {
  const candidates = process.platform === "win32"
    ? [join(binDir, "archctx.cmd"), join(binDir, "archctx.exe"), join(binDir, "archctx")]
    : [join(binDir, "archctx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function resolveCodeGraphBin(binDir) {
  const candidates = process.platform === "win32"
    ? [join(binDir, "codegraph.cmd"), join(binDir, "codegraph.exe"), join(binDir, "codegraph")]
    : [join(binDir, "codegraph")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function rewriteShebang(path, shebang) {
  const source = readFileSync(path, "utf8");
  writeFileSync(path, `${shebang}\n${source.replace(/^#!.*\n/, "")}`, "utf8");
}

function assertNodeOnlyReleaseRuntime(stageDir, binPath) {
  const bin = readFileSync(binPath, "utf8");
  assert(!bin.includes(root), "release bin must not embed the build root");
  assert(bin.startsWith("#!/usr/bin/env node\n"), "release bin must use a node shebang");
  assert(!bin.startsWith("#!/usr/bin/env bun"), "release bin must not require bun");
  const manifest = JSON.parse(readFileSync(join(stageDir, "package.json"), "utf8"));
  assert(!("packageManager" in manifest), "release package must not declare a packageManager runtime contract");
  assert(manifest.license === "Apache-2.0", "release package must declare Apache-2.0 license");
  assert(manifest.engines?.node === rootManifest.engines?.node, "release package must declare the root node engine");
  assert(!("bun" in (manifest.engines ?? {})), "release package must not declare a bun engine");
  assert(Object.keys(manifest.bin ?? {}).length === 1 && manifest.bin?.archctx === "./bin/archctx.mjs", "release package bin must expose only archctx");
  assert(!existsSync(join(stageDir, "bin", "codegraph.mjs")), "release package must not ship an ArchContext-owned CodeGraph shim");
  assert(manifest.dependencies?.["@colbymchenry/codegraph"] === rootManifest.dependencies?.["@colbymchenry/codegraph"], "release package must preserve the exact CodeGraph dependency");
  assert(manifest.dependencies?.["@node-rs/jieba"] === localRuntimeManifest.dependencies?.["@node-rs/jieba"], "release package must declare native tokenizer dependency");
  assert(manifest.dependencies?.koffi === localRuntimeManifest.dependencies?.koffi, "release package must declare descriptor-relative filesystem dependency");
}

function assertReleaseSupportFiles(packageDir) {
  for (const file of [...releaseAssetFiles, ...releaseSchemaFiles, "NOTICE.md"]) {
    assert(existsSync(join(packageDir, file)), `release package missing ${file}`);
  }
  const sources = readSourceRecords(join(packageDir, "assets", "sources"));
  assert(sources.length >= 19, "release package source registry must include S6 sources");
  const notice = readFileSync(join(packageDir, "NOTICE.md"), "utf8");
  for (const source of sources) {
    assert(String(source.contentDigest ?? "").startsWith("sha256:"), `source ${source.id} missing digest`);
    assert(Boolean(source.licenseSpdx), `source ${source.id} missing license`);
    assert(Boolean(source.attribution), `source ${source.id} missing attribution`);
    assert(notice.includes(String(source.attribution)), `NOTICE.md missing attribution for ${source.id}`);
  }
}

function readSourceRecords(dir) {
  return listFiles(dir)
    .filter((path) => path.endsWith(".yaml") || path.endsWith(".json"))
    .flatMap((path) => {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed) ? parsed : [parsed];
    });
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

export function displayPath(path) {
  return path.startsWith(tmpdir()) ? join("$TMPDIR", path.slice(tmpdir().length + 1)) : path;
}

export function assert(condition, message) {
  if (!condition) throw new Error(`[local-product-tarball-smoke] ${message}`);
}
