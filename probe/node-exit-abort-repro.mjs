// Diagnostic only (#358). Runs Node's own regression reproducer for nodejs/node#56645
// (test/parallel/test-process-exit-after-fetch-throw.js from nodejs/node#61999) under the
// node.exe bundled in @colbymchenry/codegraph-win32-x64 and under the setup-node runtime.
// The child serves a redirect loop, lets fetch throw, then calls process.exit(0). An affected
// Windows runtime can abort at exit with 0xC0000409. Every exit is recorded.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cgDir = required("CG_DIR");
const outDir = required("PROBE_OUT");
const runsPerVariant = Number(process.env.PROBE_RUNS ?? "300");
const concurrency = Number(process.env.PROBE_CONCURRENCY ?? "4");
const childTimeoutMs = 30_000;

mkdirSync(outDir, { recursive: true });
const platformRoot = join(cgDir, "node_modules", "@colbymchenry", `codegraph-${process.platform}-${process.arch}`);
const platformVersion = JSON.parse(readFileSync(join(platformRoot, "package.json"), "utf8")).version;
const bundledNode = join(platformRoot, process.platform === "win32" ? "node.exe" : "node");
const childPath = join(outDir, "exit-after-fetch-throw-child.cjs");
writeFileSync(childPath, `'use strict';
const http = require('http');
http.createServer((_, res) => { res.writeHead(302, { Location: '/' }); res.end(); })
  .listen(0, '127.0.0.1', async function () {
    try { await fetch(\`http://127.0.0.1:\${this.address().port}/\`); } catch { /* redirect limit */ }
    process.exit(0);
  });
`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function versionOf(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} --version exited ${result.status}`);
  return result.stdout.trim();
}

const variants = [
  { name: "bundled", command: bundledNode, flags: [] },
  { name: "bundled+codegraph-flags", command: bundledNode, flags: ["--liftoff-only", "--disable-warning=ExperimentalWarning"] },
  { name: "host", command: process.execPath, flags: [] }
];
const identity = {
  codegraphPlatformVersion: platformVersion,
  bundledNodeVersion: versionOf(bundledNode),
  hostNodeVersion: process.version,
  runsPerVariant, concurrency
};
writeFileSync(join(outDir, "identity.json"), JSON.stringify(identity, null, 2));
console.log(JSON.stringify(identity));

function classify(code, signal) {
  if (code === 0) return "ok";
  if (code === null) return `signal:${signal}`;
  const unsigned = code >>> 0;
  if (unsigned === 0xC0000409) return "fail-fast-0xC0000409";
  if (unsigned === 0xC0000005) return "access-violation-0xC0000005";
  return `exit:${code}`;
}

function runChild(variant) {
  return new Promise((resolve) => {
    const child = spawn(variant.command, [...variant.flags, childPath], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-600); });
    const timer = setTimeout(() => child.kill(), childTimeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ outcome: `spawn:${error.code}`, stderr: "" }); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ outcome: classify(code, signal), code, stderr }); });
  });
}

const summary = {};
for (const variant of variants) {
  const counts = { total: 0 };
  let next = 0;
  const lane = async () => {
    while (next < runsPerVariant) {
      next++;
      const result = await runChild(variant);
      counts.total++;
      counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
      if (result.outcome !== "ok") {
        const event = { variant: variant.name, ...result };
        appendFileSync(join(outDir, "nonzero.jsonl"), `${JSON.stringify(event)}\n`);
        if ((counts[result.outcome] ?? 0) <= 3) console.log(`NONZERO ${JSON.stringify(event)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  summary[variant.name] = counts;
  console.log(`${variant.name}: ${JSON.stringify(counts)}`);
}

writeFileSync(join(outDir, "summary.json"), JSON.stringify({ identity, summary }, null, 2));
const rows = Object.entries(summary).map(([name, { total, ...outcomes }]) => `| ${name} | ${total} | ${Object.entries(outcomes).map(([key, count]) => `${key}=${count}`).join(" ")} |`);
const markdown = `### Node exit-abort reproducer (nodejs/node#56645)\n\nbundled ${identity.bundledNodeVersion}, host ${identity.hostNodeVersion}\n\n| variant | runs | outcomes |\n|---|---|---|\n${rows.join("\n")}\n`;
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
