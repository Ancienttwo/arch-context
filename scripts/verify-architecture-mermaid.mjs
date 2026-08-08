#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_MERMAID_CLI_VERSION = "11.16.0";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const architectureRoot = join(root, "docs", "architecture");
const packageManifestPath = join(root, "node_modules", "@mermaid-js", "mermaid-cli", "package.json");
const executable = join(root, "node_modules", ".bin", process.platform === "win32" ? "mmdc.cmd" : "mmdc");

const installed = JSON.parse(readFileSync(packageManifestPath, "utf8"));
if (installed.version !== EXPECTED_MERMAID_CLI_VERSION) {
  throw new Error(`expected @mermaid-js/mermaid-cli@${EXPECTED_MERMAID_CLI_VERSION}, found ${String(installed.version)}`);
}

const sources = collectMermaidSources(architectureRoot);
if (sources.length === 0) throw new Error("architecture Mermaid corpus is empty");

const temporaryRoot = mkdtempSync(join(tmpdir(), "archctx-mermaid-render-"));
try {
  for (const [index, source] of sources.entries()) {
    const stem = `${String(index + 1).padStart(3, "0")}-${safeStem(source.path)}`;
    const inputPath = join(temporaryRoot, `${stem}.mmd`);
    const outputPath = join(temporaryRoot, `${stem}.svg`);
    writeFileSync(inputPath, `${source.body.trimEnd()}\n`, "utf8");
    const rendered = spawnSync(executable, ["--input", inputPath, "--output", outputPath, "--quiet"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (rendered.error || rendered.status !== 0) {
      const detail = rendered.error?.message ?? rendered.stderr.trim() ?? rendered.stdout.trim() ?? `exit ${String(rendered.status)}`;
      throw new Error(`Mermaid render failed for ${source.path} block ${source.block}: ${detail}`);
    }
  }
  process.stdout.write(`Architecture Mermaid verified: ${sources.length} diagram(s), @mermaid-js/mermaid-cli@${EXPECTED_MERMAID_CLI_VERSION}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function collectMermaidSources(directory) {
  const result = [];
  for (const path of walk(directory)) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (path.endsWith(".mmd")) {
      result.push({ path: relativePath, block: 1, body: stripProjectionMarkers(readFileSync(path, "utf8")) });
      continue;
    }
    if (!path.endsWith(".md")) continue;
    const markdown = readFileSync(path, "utf8");
    const fences = /^```mermaid[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
    let match;
    let block = 0;
    while ((match = fences.exec(markdown)) !== null) {
      block += 1;
      result.push({ path: relativePath, block, body: match[1] });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path) || left.block - right.block);
}

function stripProjectionMarkers(body) {
  return body
    .split("\n")
    .filter((line) => !/^<!-- (?:BEGIN|END) ARCHCONTEXT:generated\b.*-->$/.test(line.trim()))
    .join("\n");
}

function walk(directory) {
  return readdirSync(directory)
    .map((name) => join(directory, name))
    .flatMap((path) => statSync(path).isDirectory() ? walk(path) : [path])
    .sort();
}

function safeStem(path) {
  return basename(path).replace(/[^a-zA-Z0-9_.-]+/g, "-");
}
