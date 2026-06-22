#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";

const ROOT = process.cwd();
const BIN_DIR = join(ROOT, "node_modules", ".bin");
const ARCHCTX_BIN = resolveArchctxBin(BIN_DIR);
const CODEGRAPH_BIN = resolveCodeGraphBin(BIN_DIR);
const FIXTURE_ROOT = join(ROOT, "packages/surfaces/cli/test/fixtures/single-repo-basic");
const PROCESS_TIMEOUT_MS = 20_000;
const REMOVED_PROVIDER_ENV = providerEnvKeys(process.env);
const MCP_HOST = "codex";

if (!existsSync(ARCHCTX_BIN)) {
  fail(`missing installed archctx bin at ${ARCHCTX_BIN}; run bun install first`);
}

const workspace = mkdtempSync(join(tmpdir(), "archctx-local-no-cloud-"));
const repo = join(workspace, basename(FIXTURE_ROOT));
const env = localOnlyEnv();

try {
  cpSync(FIXTURE_ROOT, repo, { recursive: true });
  git(repo, "init");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
  const headSha = gitOut(repo, "rev-parse", "HEAD");
  await run(process.execPath, [CODEGRAPH_BIN, "init", repo], { cwd: repo, env });

  const doctor = await runArchctx(repo, "doctor");
  assert(doctor.ok === true, "doctor must succeed without cloud or LLM provider env");
  assert(doctor.data?.egress?.defaultOutbound === "local-only", "doctor must report local-only default outbound");
  assert(doctor.data?.egress?.cloudContentUpload === "deny", "doctor must deny cloud content upload");
  assert(doctor.data?.egress?.secureMcpTunnel === "disabled-by-default", "doctor must keep secure MCP tunnel disabled by default");
  assert(doctor.data?.egress?.thirdPartyTelemetry === "disabled", "doctor must report third-party telemetry disabled");

  const mcpInstall = await runArchctx(repo, "mcp", "install", "--host", MCP_HOST);
  assert(mcpInstall.ok === true, "mcp install must succeed without GitHub, Cloud, or LLM");
  assert(mcpInstall.data?.host === MCP_HOST, "mcp install must report the requested host");
  assert(mcpInstall.data?.config?.mcpServers?.archcontext?.command === "archctx", "mcp install must use installed archctx command");
  assert(Array.isArray(mcpInstall.data?.config?.mcpServers?.archcontext?.args), "mcp install must return MCP args");
  assert(mcpInstall.data.config.mcpServers.archcontext.args.join(" ") === "mcp", "mcp install must use local MCP stdio entrypoint");

  const init = await runArchctx(repo, "init", "--name", "Local No Cloud");
  assert(init.ok === true, "init must succeed without GitHub, Cloud, or LLM");
  assert(/^sha256:/.test(String(init.data?.modelDigest)), "init must return model digest");

  const sync = await runArchctx(repo, "sync", "--changed", "src/index.ts");
  assert(sync.ok === true, "sync must succeed with local CodeGraph only");
  assert(/^sha256:/.test(String(sync.data?.codeFactsDigest)), "sync must return code facts digest");

  const context = await runArchctx(repo, "context", "--task", "inspect greeting module", "--max-symbols", "2");
  assert(context.ok === true, "context must succeed without GitHub, Cloud, or LLM");
  assert(context.data?.schemaVersion === "archcontext.task-context/v1", "context must return task-context schema");
  assert(context.data?.resources?.some((resource) => resource.type === "codefacts"), "context must include local codefacts resource");
  assert(context.data?.resources?.some((resource) => resource.type === "model"), "context must include local model resource");

  const prepared = await runArchctx(repo, "prepare", "--task", "inspect greeting module", "--max-items", "2");
  assert(prepared.ok === true, "prepare must succeed without GitHub, Cloud, or LLM");
  assert(Boolean(prepared.data?.posture), "prepare must return local posture");

  const status = await runArchctx(repo, "status");
  assert(status.ok === true, "status must succeed after local context");
  assert(status.data?.running === true, "status must report daemon running");
  assert(/^sha256:/.test(String(status.data?.worktreeDigest)), "status must return worktree digest");

  const checkpoint = await runArchctx(repo, "checkpoint", "--expected-worktree-digest", status.data.worktreeDigest);
  assert(checkpoint.ok === true, "checkpoint must succeed without GitHub, Cloud, or LLM");
  assert(checkpoint.data?.fresh === true, "checkpoint must report a fresh worktree");

  const complete = await runArchctx(
    repo,
    "complete",
    "--task-session-id",
    "task_local_no_cloud_complete",
    "--head-sha",
    headSha
  );
  assert(complete.ok === true, "complete must succeed without GitHub, Cloud, or LLM");
  assert(complete.data?.schemaVersion === "archcontext.review/v1", "complete must return review schema");
  assert(complete.data?.result === "pass", "complete must pass for the clean local fixture");

  const review = await runArchctx(
    repo,
    "review",
    "--task-session-id",
    "task_local_no_cloud",
    "--head-sha",
    headSha
  );
  assert(review.ok === true, "review must succeed without GitHub, Cloud, or LLM");
  assert(review.requestId === "review", "review command must identify its request");
  assert(review.data?.schemaVersion === "archcontext.review/v1", "review must return review schema");
  assert(review.data?.result === "pass", "review must pass for the clean local fixture");
  assert(review.data?.summary?.errors === 0, "review must report zero errors");

  const stopped = await runArchctx(repo, "daemon", "stop");
  assert(stopped.ok === true, "daemon stop must succeed");

  console.log(JSON.stringify({
    schemaVersion: "archcontext.local-no-cloud-e2e/v1",
    commands: ["doctor", "mcp install", "init", "sync", "context", "prepare", "status", "checkpoint", "complete", "review"],
    providerEnvRemoved: REMOVED_PROVIDER_ENV,
    git: {
      headSha
    },
    egress: doctor.data.egress,
    mcp: {
      host: mcpInstall.data.host,
      command: mcpInstall.data.config.mcpServers.archcontext.command,
      args: mcpInstall.data.config.mcpServers.archcontext.args
    },
    taskLifecycle: {
      preparePosture: String(prepared.data.posture),
      checkpointFresh: checkpoint.data.fresh,
      completeSchemaVersion: complete.data.schemaVersion,
      completeResult: complete.data.result
    },
    review: {
      schemaVersion: review.data.schemaVersion,
      result: review.data.result,
      errors: review.data.summary.errors,
      warnings: review.data.summary.warnings
    },
    paths: {
      repo: displayPath(realpathSync.native(repo)),
      bin: displayPath(realpathSync.native(ARCHCTX_BIN))
    }
  }, null, 2));
} finally {
  await runArchctx(repo, "daemon", "stop").catch(() => undefined);
  rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}

function localOnlyEnv() {
  const env = { ...process.env };
  for (const key of REMOVED_PROVIDER_ENV) delete env[key];
  env.DO_NOT_TRACK = "1";
  env.PATH = `${BIN_DIR}${delimiter}${process.env.PATH ?? ""}`;
  return env;
}

function providerEnvKeys(env) {
  return Object.keys(env).filter((key) =>
    /^(GITHUB|GH|OPENAI|ANTHROPIC|ARCHCONTEXT_CLOUD|CLOUDFLARE|STRIPE|SLACK)_/.test(key)
    || key.endsWith("_API_KEY")
    || key.endsWith("_ACCESS_TOKEN")
  ).sort();
}

function git(repo, ...args) {
  execFileSync("git", args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(repo, ...args) {
  return execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runArchctx(cwd, ...args) {
  return run(ARCHCTX_BIN, args, { cwd, env }).then(({ stdout }) => JSON.parse(stdout));
}

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`${command} ${args.join(" ")} timed out: ${stderr || stdout}`));
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
        rejectPromise(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolvePromise({ stdout, stderr });
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
  const packageShim = join(ROOT, "node_modules", "@colbymchenry", "codegraph", "npm-shim.js");
  const candidates = process.platform === "win32"
    ? [packageShim, join(binDir, "codegraph.cmd"), join(binDir, "codegraph.exe"), join(binDir, "codegraph")]
    : [packageShim, join(binDir, "codegraph")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function displayPath(path) {
  const tempRoots = [tmpdir(), realpathSync.native(tmpdir())];
  const tempRoot = tempRoots.find((root) => path === root || path.startsWith(`${root}/`));
  return tempRoot ? join("$TMPDIR", path.slice(tempRoot.length + 1)) : path;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`[local-no-cloud-e2e] FAILED: ${message}`);
  process.exit(1);
}
