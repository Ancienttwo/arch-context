#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const coreManifest = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"));
const releasePackageName = "archctx";
const releaseHomeUrl = "https://archcontext.repoharness.com";
const releaseAssetFiles = [
  "assets/catalog.yaml",
  "assets/practices/s6-expanded.yaml",
  "assets/profiles/s6.yaml",
  "assets/sources/core.yaml",
  "assets/sources/s6.yaml"
];
const releaseSchemaFiles = [
  "schemas/repo/practices/practice.schema.json",
  "schemas/repo/practices/practice-source.schema.json",
  "schemas/repo/practices/practice-profile.schema.json",
  "schemas/runtime/practice-catalog-manifest.schema.json",
  "schemas/runtime/practice-match.schema.json",
  "schemas/runtime/practice-guidance.schema.json",
  "schemas/runtime/practice-checkpoint.schema.json"
];
const args = parseArgs(process.argv.slice(2));
const PROCESS_TIMEOUT_MS = Number(args["timeout-ms"] ?? 30_000);
const cleanupRoots = [];
let activeDaemon;

try {
  const artifactDir = resolve(String(args["artifact-dir"] ?? mkdtempTracked("archctx-local-product-artifact-")));
  mkdirSync(artifactDir, { recursive: true });
  const { tarballPath, stageDir } = await buildLocalProductTarball(artifactDir);
  const installDir = await installTarball(tarballPath);
  const binDir = join(installDir, "node_modules", ".bin");
  const archctxBin = resolveArchctxBin(binDir);
  assert(existsSync(archctxBin), `installed archctx bin missing: ${archctxBin}`);
  const codeGraphBin = resolveCodeGraphBin(binDir);
  assert(existsSync(codeGraphBin), `installed CodeGraph dependency bin missing: ${codeGraphBin}`);
  const installedPackageDir = join(installDir, "node_modules", releasePackageName);
  assertReleaseSupportFiles(installedPackageDir);

  const repo = createGitFixture();
  const stateRoot = mkdtempTracked("archctx-local-product-state-");
  const env = nodeOnlyRuntimeEnv(stateRoot);
  const bunProbe = await runOptional("bun", ["--version"], { cwd: repo, env });
  assert(bunProbe.code !== 0, "tarball smoke runtime PATH must not expose bun");
  const codeGraphProbe = await runOptional("codegraph", ["--version"], { cwd: repo, env });
  assert(codeGraphProbe.code !== 0, "tarball smoke runtime PATH must not expose codegraph");

  await run(codeGraphBin, ["init", repo], { cwd: repo, env });

  const doctor = await runArchctx(archctxBin, ["doctor"], { cwd: repo, env });
  assert(doctor.ok === true, "doctor must succeed from installed tarball");
  assert(doctor.data?.product?.product?.distribution === "one-package", "doctor must report one-package distribution");
  assert(doctor.data?.egress?.cloudContentUpload === "deny", "doctor must preserve local-only cloud content policy");

  const started = await runArchctx(archctxBin, ["daemon", "start"], { cwd: repo, env });
  assert(started.ok === true, "daemon start must succeed from installed tarball");
  assert(started.data?.background === true, "daemon start must report background mode");
  assert(/^http:\/\/127\.0\.0\.1:/.test(String(started.data?.url)), "daemon must bind loopback RPC");
  activeDaemon = { bin: archctxBin, repo, env };

  const init = await runArchctx(archctxBin, ["init", "--name", "Tarball Smoke"], { cwd: repo, env });
  assert(init.ok === true, "init must succeed from installed tarball");

  const sync = await runArchctx(archctxBin, ["sync", "--changed", "src/index.ts"], { cwd: repo, env });
  assert(sync.ok === true, "sync must succeed with installed codegraph dependency");
  assert(/^sha256:/.test(String(sync.data?.codeFactsDigest)), "sync must return a code facts digest");

  const practiceValidation = await runArchctx(archctxBin, ["practices", "validate", "--strict"], { cwd: repo, env });
  assert(practiceValidation.ok === true, "practices validate must succeed from installed tarball");
  assert(practiceValidation.data?.valid === true, "installed practice catalog must validate");
  assert(Number(practiceValidation.data?.practiceCount ?? 0) >= 40, "installed practice catalog must include S6 built-in assets");
  assert(Number(practiceValidation.data?.sourceCount ?? 0) >= 19, "installed practice catalog must include source registry");

  const prepared = await runArchctx(archctxBin, ["prepare", "--task", "inspect tarball smoke", "--max-items", "2"], { cwd: repo, env });
  assert(prepared.ok === true, "prepare must succeed through installed daemon");

  const mcp = await runArchctxMcp(archctxBin, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list"
  }, { cwd: repo, env });
  assert(mcp.jsonrpc === "2.0", "MCP must return JSON-RPC");
  assert(mcp.id === 1, "MCP must preserve request id");
  const toolNames = (mcp.result?.tools ?? []).map((tool) => tool.name);
  assert(toolNames.includes("archcontext_prepare_task"), "MCP must expose archcontext_prepare_task");

  const stopped = await runArchctx(archctxBin, ["daemon", "stop"], { cwd: repo, env });
  assert(stopped.ok === true, "daemon stop must succeed from installed tarball");
  activeDaemon = undefined;
  const pathsBeforeUpgrade = await runArchctx(archctxBin, ["paths"], { cwd: repo, env });
  assert(pathsBeforeUpgrade.ok === true, "paths must succeed before reinstall upgrade");
  assert(existsSync(pathsBeforeUpgrade.data?.localStorePath), "runtime state must exist before reinstall upgrade");

  await run("npm", ["install", "--no-audit", "--no-fund", tarballPath], { cwd: installDir, env: process.env });
  const upgradedBin = resolveArchctxBin(binDir);
  assert(existsSync(upgradedBin), "archctx bin must remain available after reinstall upgrade");
  const upgradedValidation = await runArchctx(upgradedBin, ["practices", "validate", "--strict"], { cwd: repo, env });
  assert(upgradedValidation.ok === true && upgradedValidation.data?.valid === true, "practice catalog must validate after reinstall upgrade");
  const pathsAfterUpgrade = await runArchctx(upgradedBin, ["paths"], { cwd: repo, env });
  assert(pathsAfterUpgrade.data?.localStorePath === pathsBeforeUpgrade.data?.localStorePath, "reinstall upgrade must retain runtime store path");

  await run("npm", ["uninstall", "--no-audit", "--no-fund", releasePackageName], { cwd: installDir, env: process.env });
  assert(!existsSync(upgradedBin), "archctx bin must be removed after uninstall");
  assert(existsSync(pathsBeforeUpgrade.data?.localStorePath), "uninstall must retain user runtime state outside package install dir");

  const evidence = {
    schemaVersion: "archcontext.local-product-tarball-smoke/v1",
    package: {
      name: releasePackageName,
      version: rootManifest.version,
      tarball: basename(tarballPath),
      stageDir: displayPath(stageDir)
    },
    install: {
      installer: "npm install <local-tarball>",
      installDir: displayPath(installDir),
      bin: displayPath(archctxBin)
    },
    runtime: {
      cli: true,
      daemon: {
        started: true,
        protocol: started.data?.protocol,
        loopbackOnly: String(started.data?.url ?? "").startsWith("http://127.0.0.1:")
      },
      mcp: {
        transport: "stdio",
        tools: toolNames
      },
      codeGraph: {
        dependency: rootManifest.dependencies?.["@colbymchenry/codegraph"],
        bin: displayPath(codeGraphBin),
        source: "dependency-provided-local-bin",
        digest: sync.data?.codeFactsDigest
      },
      practices: {
        validation: "strict",
        valid: practiceValidation.data?.valid,
        practiceCount: practiceValidation.data?.practiceCount,
        sourceCount: practiceValidation.data?.sourceCount,
        profileCount: practiceValidation.data?.profileCount,
        catalogDigest: practiceValidation.data?.catalogDigest
      }
    },
    product: {
      distribution: doctor.data?.product?.product?.distribution,
      version: doctor.data?.product?.product?.version,
      rpcSchemaVersion: doctor.data?.version?.rpcSchemaVersion
    },
    lifecycle: {
      install: "passed",
      upgrade: "reinstall-retained-state",
      uninstall: "package-removed-state-retained",
      retainedStore: displayPath(pathsBeforeUpgrade.data?.localStorePath),
      stateRoot: displayPath(stateRoot)
    }
  };
  if (args.out) {
    const outPath = resolve(String(args.out));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (activeDaemon) {
    await runArchctx(activeDaemon.bin, ["daemon", "stop"], {
      cwd: activeDaemon.repo,
      env: activeDaemon.env
    }).catch(() => undefined);
  }
  if (!args["keep-temp"]) {
    for (const path of cleanupRoots.reverse()) rmSync(path, { recursive: true, force: true });
  }
}

async function buildLocalProductTarball(artifactDir) {
  const stageDir = mkdtempTracked("archctx-local-product-stage-");
  const binDir = join(stageDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, "archctx.mjs");
  await run("bun", [
    "build",
    "packages/surfaces/cli/src/main.ts",
    "--target=node",
    "--format=esm",
    "--outdir",
    binDir,
    "--entry-naming",
    "archctx.mjs",
    "--external=@node-rs/jieba",
    "--external=@node-rs/jieba/dict.js"
  ], { cwd: root, env: process.env });
  rewriteShebang(binPath, "#!/usr/bin/env node");
  chmodSync(binPath, 0o755);
  copyReleaseSupportFiles(stageDir);

  writeFileSync(join(stageDir, "README.md"), [
    "# archctx",
    "",
    "ArchContext local runtime and CLI for agentic coding workflows.",
    "",
    `Product home: ${releaseHomeUrl}`,
    "",
    "This package contains the one-package Local Core distribution.",
    "It does not require a GitHub App, Cloud account, subscription, or LLM provider for Local Core."
  ].join("\n"), "utf8");
  writeFileSync(join(stageDir, "package.json"), JSON.stringify({
    name: releasePackageName,
    version: rootManifest.version,
    description: "Local architecture context CLI for agentic coding workflows.",
    private: false,
    type: "module",
    bin: {
      archctx: "./bin/archctx.mjs"
    },
    homepage: releaseHomeUrl,
    license: "Apache-2.0",
    publishConfig: {
      registry: "https://registry.npmjs.org/"
    },
    engines: rootManifest.engines,
    files: [
      "bin",
      "assets",
      "schemas",
      "NOTICE.md",
      "README.md"
    ],
    dependencies: {
      "@colbymchenry/codegraph": rootManifest.dependencies?.["@colbymchenry/codegraph"],
      "@node-rs/jieba": coreManifest.dependencies?.["@node-rs/jieba"]
    }
  }, null, 2), "utf8");
  assertNodeOnlyReleaseRuntime(stageDir, binPath);
  assertReleaseSupportFiles(stageDir);

  const output = await run("npm", ["pack", "--silent", "--pack-destination", artifactDir], {
    cwd: stageDir,
    env: process.env
  });
  const tarballName = output.stdout.trim().split("\n").at(-1);
  assert(tarballName, "npm pack did not return a tarball name");
  return { tarballPath: join(artifactDir, tarballName), stageDir };
}

function copyReleaseSupportFiles(stageDir) {
  cpSync(join(root, "packages/core/practice-catalog/assets"), join(stageDir, "assets"), { recursive: true });
  cpSync(join(root, "schemas"), join(stageDir, "schemas"), { recursive: true });
  writeFileSync(join(stageDir, "NOTICE.md"), renderNotice(stageDir), "utf8");
}

function renderNotice(stageDir) {
  const sources = readSourceRecords(join(stageDir, "assets", "sources"));
  return [
    "# archctx Notices",
    "",
    "This package includes curated architecture practice assets. The source registry bundled in `assets/sources/` is the authoritative provenance record.",
    "",
    ...sources.map((source) => `- ${String(source.name ?? source.id)} (${String(source.id ?? "unknown")}): ${String(source.licenseSpdx ?? "unknown license")}; ${String(source.attribution ?? "missing attribution")}; revision ${String(source.revision ?? "unknown")}.`),
    ""
  ].join("\n");
}

async function installTarball(tarballPath) {
  const installDir = mkdtempTracked("archctx-local-product-install-");
  await run("npm", ["init", "-y"], { cwd: installDir, env: process.env });
  await run("npm", ["install", "--no-audit", "--no-fund", tarballPath], {
    cwd: installDir,
    env: process.env
  });
  return installDir;
}

function createGitFixture() {
  const workspace = mkdtempTracked("archctx-local-product-repo-");
  const repo = join(workspace, "fixture");
  cpSync(join(root, "packages/surfaces/cli/test/fixtures/single-repo-basic"), repo, { recursive: true });
  runSync("git", ["init"], { cwd: repo, env: process.env });
  runSync("git", ["add", "."], { cwd: repo, env: process.env });
  runSync("git", [
    "-c",
    "user.name=ArchContext Test",
    "-c",
    "user.email=archcontext@example.test",
    "commit",
    "-m",
    "fixture"
  ], { cwd: repo, env: process.env });
  return repo;
}

function runArchctx(bin, commandArgs, options) {
  return run(bin, commandArgs, options).then(({ stdout }) => JSON.parse(stdout));
}

async function runArchctxMcp(bin, message, options) {
  const result = await run(bin, ["mcp"], {
    ...options,
    stdin: `${JSON.stringify(message)}\n`
  });
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  return JSON.parse(line ?? "");
}

function runSync(command, commandArgs, options) {
  execFileSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function run(command, commandArgs, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`${command} ${commandArgs.join(" ")} timed out: ${stderr || stdout}`));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectPromise(new Error(`${command} ${commandArgs.join(" ")} failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

function runOptional(command, commandArgs, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({ code: 124, stdout, stderr });
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolvePromise({ code: 127, stdout, stderr: error instanceof Error ? error.message : String(error) });
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function resolveArchctxBin(binDir) {
  const candidates = process.platform === "win32"
    ? [join(binDir, "archctx.cmd"), join(binDir, "archctx.exe"), join(binDir, "archctx")]
    : [join(binDir, "archctx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveCodeGraphBin(binDir) {
  const candidates = process.platform === "win32"
    ? [join(binDir, "codegraph.cmd"), join(binDir, "codegraph.exe"), join(binDir, "codegraph")]
    : [join(binDir, "codegraph")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function rewriteShebang(path, shebang) {
  const source = readFileSync(path, "utf8");
  const withoutShebang = source.replace(/^#!.*\n/, "");
  writeFileSync(path, `${shebang}\n${withoutShebang}`, "utf8");
}

function assertNodeOnlyReleaseRuntime(stageDir, binPath) {
  const bin = readFileSync(binPath, "utf8");
  assert(bin.startsWith("#!/usr/bin/env node\n"), "release bin must use a node shebang");
  assert(!bin.startsWith("#!/usr/bin/env bun"), "release bin must not require bun");
  const manifest = JSON.parse(readFileSync(join(stageDir, "package.json"), "utf8"));
  assert(!("packageManager" in manifest), "release package must not declare a packageManager runtime contract");
  assert(manifest.license === "Apache-2.0", "release package must declare Apache-2.0 license");
  assert(manifest.engines?.node === rootManifest.engines?.node, "release package must declare the root node engine");
  assert(!("bun" in (manifest.engines ?? {})), "release package must not declare a bun engine");
  assert(
    Object.keys(manifest.bin ?? {}).length === 1 && manifest.bin?.archctx === "./bin/archctx.mjs",
    "release package bin must expose only archctx"
  );
  assert(!existsSync(join(stageDir, "bin", "codegraph.mjs")), "release package must not ship an ArchContext-owned CodeGraph shim");
  assert(
    manifest.dependencies?.["@colbymchenry/codegraph"] === rootManifest.dependencies?.["@colbymchenry/codegraph"],
    "release package must preserve the exact CodeGraph dependency"
  );
  assert(manifest.dependencies?.["@node-rs/jieba"] === coreManifest.dependencies?.["@node-rs/jieba"], "release package must declare native tokenizer dependency");
}

function nodeOnlyRuntimeEnv(stateRoot) {
  return {
    ...process.env,
    DO_NOT_TRACK: "1",
    ARCHCONTEXT_STATE_DIR: stateRoot,
    PATH: [
      dirname(process.execPath),
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ].join(delimiter)
  };
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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function mkdtempTracked(prefix) {
  const path = mkdtempSync(join(tmpdir(), prefix));
  cleanupRoots.push(path);
  return path;
}

function displayPath(path) {
  return path.startsWith(tmpdir()) ? join("$TMPDIR", path.slice(tmpdir().length + 1)) : path;
}

function assert(condition, message) {
  if (!condition) throw new Error(`[local-product-tarball-smoke] ${message}`);
}
