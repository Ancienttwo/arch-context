// Diagnostic only (#358). Runs the official CodeGraph 1.6.2 CLI entry under two runtimes on the
// same Windows runner at the same time, with the shim's own V8 flags:
//   bundled: the node.exe shipped in @colbymchenry/codegraph-win32-x64 (measured, not assumed)
//   host:    the setup-node runtime, which must be >= 24.20.0 (carries nodejs/node#61999)
// Each worker loops fresh fixture -> init -> (edit, sync --quiet, status -j) until the deadline.
// Every child exit is recorded. A nonzero exit is never counted as success.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cgDir = required("CG_DIR");
const outDir = required("PROBE_OUT");
const durationMs = Number(process.env.PROBE_DURATION_MS ?? "1200000");
const workersPerRuntime = Number(process.env.PROBE_WORKERS ?? "4");
const expectedVersion = "1.6.2";
const fixtureFiles = 40;
const cyclesPerFixture = 20;
const childTimeoutMs = 120_000;

mkdirSync(outDir, { recursive: true });
const eventsPath = join(outDir, "events.jsonl");
writeFileSync(eventsPath, "");

const modules = join(cgDir, "node_modules", "@colbymchenry");
const wrapperVersion = JSON.parse(readFileSync(join(modules, "codegraph", "package.json"), "utf8")).version;
const platformRoot = join(modules, `codegraph-${process.platform}-${process.arch}`);
const platformVersion = JSON.parse(readFileSync(join(platformRoot, "package.json"), "utf8")).version;
if (wrapperVersion !== expectedVersion || platformVersion !== expectedVersion) {
  throw new Error(`expected CodeGraph ${expectedVersion}, got wrapper ${wrapperVersion} platform ${platformVersion}`);
}
const bundledNode = join(platformRoot, process.platform === "win32" ? "node.exe" : "node");
const entry = join(platformRoot, "lib", "dist", "bin", "codegraph.js");
const bundledVersion = spawnSync(bundledNode, ["--version"], { encoding: "utf8", windowsHide: true });
if (bundledVersion.status !== 0) throw new Error(`bundled node --version exited ${bundledVersion.status}`);
const [hostMajor, hostMinor] = process.versions.node.split(".").map(Number);
if (hostMajor !== 24 || hostMinor < 20) throw new Error(`host runtime must be Node >= 24.20 on the 24 line, got ${process.version}`);

const runtimes = { bundled: bundledNode, host: process.execPath };
const identity = {
  codegraph: { wrapperVersion, platformVersion },
  bundledNodeVersion: bundledVersion.stdout.trim(),
  hostNodeVersion: process.version,
  flags: ["--liftoff-only", "--disable-warning=ExperimentalWarning"],
  durationMs, workersPerRuntime, fixtureFiles, cyclesPerFixture
};
writeFileSync(join(outDir, "identity.json"), JSON.stringify(identity, null, 2));
console.log(JSON.stringify(identity));

const env = { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" };
const deadline = Date.now() + durationMs;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function classify(code, signal) {
  if (code === 0) return "ok";
  if (code === null) return `signal:${signal}`;
  const unsigned = code >>> 0;
  if (unsigned === 0xC0000409) return "fail-fast-0xC0000409";
  if (unsigned === 0xC0000005) return "access-violation-0xC0000005";
  return `exit:${code}`;
}

function runChild(runtime, args, cwd) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(runtimes[runtime], [...identity.flags, entry, ...args], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-400); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-800); });
    const timer = setTimeout(() => child.kill(), childTimeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve(record(runtime, args[0], null, `spawn:${error.code}`, startedAt, "", String(error.message))); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve(record(runtime, args[0], code, signal, startedAt, stdout, stderr)); });
  });
}

function record(runtime, subcommand, code, signal, startedAt, stdout, stderr) {
  const outcome = classify(code, signal);
  const event = { runtime, subcommand, outcome, code, codeHex: code === null ? null : `0x${(code >>> 0).toString(16).toUpperCase()}`, elapsedMs: Math.round(performance.now() - startedAt) };
  if (outcome !== "ok") Object.assign(event, { stderrTail: stderr, stdoutTail: stdout });
  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
  if (outcome !== "ok") console.log(`NONZERO ${JSON.stringify(event)}`);
  return event;
}

function moduleSource(index, revision) {
  const previous = index === 0 ? "" : `import { compute${index - 1} } from "./mod${index - 1}";\n`;
  const call = index === 0 ? "value" : `compute${index - 1}(value)`;
  return `${previous}export interface Shape${index} { id: number; label: string }\n`
    + `export function compute${index}(value: number): number { return ${call} + ${index} + ${revision}; }\n`
    + `export class Service${index} { run(shape: Shape${index}): number { return compute${index}(shape.id); } }\n`;
}

function git(cwd, args) {
  const result = spawnSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args], { cwd, windowsHide: true, stdio: "ignore" });
  if (result.status !== 0) throw new Error(`git ${args[0]} exited ${result.status}`);
}

function createFixture() {
  const root = mkdtempSync(join(process.env.RUNNER_TEMP ?? outDir, "cg-exit-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "cg-exit-fixture", private: true }));
  for (let index = 0; index < fixtureFiles; index++) writeFileSync(join(root, "src", `mod${index}.ts`), moduleSource(index, 0));
  git(root, ["init", "--quiet"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

async function worker(runtime, id) {
  let rounds = 0;
  while (Date.now() < deadline) {
    const root = createFixture();
    try {
      const init = await runChild(runtime, ["init", root], root);
      if (init.outcome === "ok") {
        for (let cycle = 1; cycle <= cyclesPerFixture && Date.now() < deadline; cycle++) {
          for (const index of [cycle % fixtureFiles, (cycle * 7) % fixtureFiles, (cycle * 13) % fixtureFiles]) {
            writeFileSync(join(root, "src", `mod${index}.ts`), moduleSource(index, cycle));
          }
          await runChild(runtime, ["sync", root, "--quiet"], root);
          await runChild(runtime, ["status", "-j", root], root);
        }
      }
    } finally {
      try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* fixture cleanup only */ }
    }
    rounds++;
  }
  console.log(`worker ${runtime}#${id} finished ${rounds} rounds`);
}

const workers = [];
for (let id = 0; id < workersPerRuntime; id++) for (const runtime of Object.keys(runtimes)) workers.push(worker(runtime, id));
await Promise.all(workers);

const events = readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const summary = {};
for (const event of events) {
  const key = `${event.runtime} ${event.subcommand}`;
  summary[key] ??= { total: 0 };
  summary[key].total++;
  summary[key][event.outcome] = (summary[key][event.outcome] ?? 0) + 1;
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ identity, summary }, null, 2));
const lines = ["| runtime subcommand | total | outcomes |", "|---|---|---|"];
for (const [key, value] of Object.entries(summary).sort()) {
  const { total, ...outcomes } = value;
  lines.push(`| ${key} | ${total} | ${Object.entries(outcomes).map(([name, count]) => `${name}=${count}`).join(" ")} |`);
}
const markdown = `### CodeGraph exit probe\n\nbundled ${identity.bundledNodeVersion}, host ${identity.hostNodeVersion}\n\n${lines.join("\n")}\n`;
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
