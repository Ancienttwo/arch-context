#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releasePackageName = "archctx";
const releaseHomeUrl = "https://archcontext.repoharness.com";
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

  const repo = createGitFixture();
  const env = {
    ...process.env,
    DO_NOT_TRACK: "1",
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
  };

  await run("codegraph", ["init", repo], { cwd: repo, env });

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
        digest: sync.data?.codeFactsDigest
      }
    },
    product: {
      distribution: doctor.data?.product?.product?.distribution,
      version: doctor.data?.product?.product?.version,
      rpcSchemaVersion: doctor.data?.version?.rpcSchemaVersion
    }
  };
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
    "--outfile",
    binPath
  ], { cwd: root, env: process.env });
  rewriteShebang(binPath, "#!/usr/bin/env bun");
  chmodSync(binPath, 0o755);

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
    license: "UNLICENSED",
    publishConfig: {
      registry: "https://registry.npmjs.org/"
    },
    packageManager: rootManifest.packageManager,
    engines: {
      ...rootManifest.engines,
      bun: ">=1.3.10"
    },
    files: [
      "bin",
      "README.md"
    ],
    dependencies: {
      "@colbymchenry/codegraph": rootManifest.dependencies?.["@colbymchenry/codegraph"]
    }
  }, null, 2), "utf8");

  const output = await run("npm", ["pack", "--silent", "--pack-destination", artifactDir], {
    cwd: stageDir,
    env: process.env
  });
  const tarballName = output.stdout.trim().split("\n").at(-1);
  assert(tarballName, "npm pack did not return a tarball name");
  return { tarballPath: join(artifactDir, tarballName), stageDir };
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

function resolveArchctxBin(binDir) {
  const candidates = process.platform === "win32"
    ? [join(binDir, "archctx.cmd"), join(binDir, "archctx.exe"), join(binDir, "archctx")]
    : [join(binDir, "archctx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function rewriteShebang(path, shebang) {
  const source = readFileSync(path, "utf8");
  const withoutShebang = source.replace(/^#!.*\n/, "");
  writeFileSync(path, `${shebang}\n${withoutShebang}`, "utf8");
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
