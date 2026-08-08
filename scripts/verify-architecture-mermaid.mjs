#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_MERMAID_CLI_VERSION = "11.16.0";
const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const architectureRoot = join(root, "docs", "architecture");
const packageManifestPath = join(root, "node_modules", "@mermaid-js", "mermaid-cli", "package.json");

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) verifyArchitectureMermaid();

export function verifyArchitectureMermaid() {
  const installed = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  if (installed.version !== EXPECTED_MERMAID_CLI_VERSION) {
    throw new Error(`expected @mermaid-js/mermaid-cli@${EXPECTED_MERMAID_CLI_VERSION}, found ${String(installed.version)}`);
  }

  const sources = collectMermaidSources(architectureRoot);
  if (sources.length === 0) throw new Error("architecture Mermaid corpus is empty");
  const invocation = resolveMmdcInvocation(installed);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "archctx-mermaid-render-"));
  try {
    for (const [index, source] of sources.entries()) {
      const stem = `${String(index + 1).padStart(3, "0")}-${safeStem(source.path)}`;
      const inputPath = join(temporaryRoot, `${stem}.mmd`);
      const outputPath = join(temporaryRoot, `${stem}.svg`);
      writeFileSync(inputPath, `${source.body.trimEnd()}\n`, "utf8");
      const rendered = spawnSync(invocation.command, [...invocation.prefixArgs, "--input", inputPath, "--output", outputPath, "--quiet"], {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024
      });
      if (rendered.error || rendered.status !== 0) {
        const detail = rendered.error?.message
          || rendered.stderr.trim()
          || rendered.stdout.trim()
          || `exit ${String(rendered.status)}`;
        throw new Error(`Mermaid render failed for ${source.path} block ${source.block}: ${detail}`);
      }
    }
    process.stdout.write(`Architecture Mermaid verified: ${sources.length} diagram(s) under docs/architecture, @mermaid-js/mermaid-cli@${EXPECTED_MERMAID_CLI_VERSION}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function collectMermaidSources(directory) {
  const result = [];
  for (const path of walk(directory)) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (path.endsWith(".mmd")) {
      result.push({ path: relativePath, block: 1, body: stripProjectionMarkers(readFileSync(path, "utf8")) });
      continue;
    }
    if (!path.endsWith(".md")) continue;
    for (const [index, body] of extractMermaidFences(readFileSync(path, "utf8")).entries()) {
      result.push({ path: relativePath, block: index + 1, body });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path) || left.block - right.block);
}

/**
 * Reads Markdown fences without treating a nested mermaid-looking block inside another
 * code fence as architecture source. Both backtick and tilde fences, arbitrary fence
 * lengths, and list indentation are supported. The info token must be exactly mermaid.
 */
export function extractMermaidFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  const bodies = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!opening) continue;
    const marker = opening[1];
    const info = opening[2].trim();
    const infoToken = info.split(/\s+/, 1)[0] ?? "";
    const isMermaid = infoToken === "mermaid";
    const closing = new RegExp(`^\\s*${escapeRegExp(marker[0])}{${marker.length},}\\s*$`);
    const body = [];
    let closed = false;
    for (index += 1; index < lines.length; index += 1) {
      if (closing.test(lines[index])) {
        closed = true;
        break;
      }
      if (isMermaid) body.push(lines[index]);
    }
    if (isMermaid && !closed) throw new Error("unclosed Mermaid fence in architecture Markdown");
    if (isMermaid) bodies.push(body.join("\n"));
  }
  return bodies;
}

function resolveMmdcInvocation(installed) {
  if (process.platform !== "win32") {
    return { command: join(root, "node_modules", ".bin", "mmdc"), prefixArgs: [] };
  }
  const declaredBin = typeof installed.bin === "string" ? installed.bin : installed.bin?.mmdc;
  if (typeof declaredBin !== "string" || declaredBin.length === 0) {
    throw new Error("@mermaid-js/mermaid-cli does not declare the mmdc executable");
  }
  return { command: process.execPath, prefixArgs: [resolve(dirname(packageManifestPath), declaredBin)] };
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
