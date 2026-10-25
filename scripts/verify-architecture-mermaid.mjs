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

/**
 * Renders every Mermaid source under `directory` (default: the committed `docs/architecture`
 * tree) with the pinned Mermaid CLI. A generated `.mmd` file is read as is: it must be a valid
 * Mermaid source on its own, with nothing stripped first.
 */
export function verifyArchitectureMermaid(directory = architectureRoot) {
  const installed = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  if (installed.version !== EXPECTED_MERMAID_CLI_VERSION) {
    throw new Error(`expected @mermaid-js/mermaid-cli@${EXPECTED_MERMAID_CLI_VERSION}, found ${String(installed.version)}`);
  }

  const sources = collectMermaidSources(directory);
  if (sources.length === 0) throw new Error("architecture Mermaid corpus is empty");
  const invocation = resolveMmdcInvocation(installed);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "archctx-mermaid-render-"));
  try {
    const puppeteerConfigPath = githubActionsPuppeteerConfig(temporaryRoot);
    for (const [index, source] of sources.entries()) {
      const stem = `${String(index + 1).padStart(3, "0")}-${safeStem(source.path)}`;
      const inputPath = join(temporaryRoot, `${stem}.mmd`);
      const outputPath = join(temporaryRoot, `${stem}.svg`);
      writeFileSync(inputPath, `${source.body.trimEnd()}\n`, "utf8");
      const rendered = spawnSync(invocation.command, [
        ...invocation.prefixArgs,
        "--input", inputPath,
        "--output", outputPath,
        "--quiet",
        ...(puppeteerConfigPath ? ["--puppeteerConfigFile", puppeteerConfigPath] : [])
      ], {
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
    process.stdout.write(`Architecture Mermaid verified: ${sources.length} diagram(s) under ${relative(root, directory).replaceAll("\\", "/")}, @mermaid-js/mermaid-cli@${EXPECTED_MERMAID_CLI_VERSION}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function githubActionsPuppeteerConfig(temporaryRoot) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true") return undefined;
  const path = join(temporaryRoot, "puppeteer.json");
  writeFileSync(path, `${JSON.stringify({ args: ["--no-sandbox", "--disable-setuid-sandbox"] })}\n`, "utf8");
  return path;
}

export function collectMermaidSources(directory) {
  return collectMermaidBlocks(directory, root).map(({ file, block, body }) => ({ path: file, block, body }));
}

/**
 * Every Mermaid block under `directory`, with `file` relative to `base`: a whole `.mmd` file (line
 * 1, no heading), or each Mermaid fence of a `.md` file with the line of its first source line and
 * the nearest heading above it.
 */
export function collectMermaidBlocks(directory, base) {
  const result = [];
  for (const path of walk(directory)) {
    const file = relative(base, path).replaceAll("\\", "/");
    if (path.endsWith(".mmd")) {
      result.push({ file, block: 1, line: 1, heading: null, body: readFileSync(path, "utf8") });
      continue;
    }
    if (!path.endsWith(".md")) continue;
    for (const [index, block] of extractMermaidBlocks(readFileSync(path, "utf8")).entries()) {
      result.push({ file, block: index + 1, ...block });
    }
  }
  return result.sort((left, right) => left.file.localeCompare(right.file) || left.block - right.block);
}

export function extractMermaidFences(markdown) {
  return extractMermaidBlocks(markdown).map((block) => block.body);
}

/**
 * Reads Markdown fences without treating a nested mermaid-looking block inside another
 * code fence as architecture source. Both backtick and tilde fences, arbitrary fence
 * lengths, and list indentation are supported. The info token must be exactly mermaid.
 * Each block carries the 1-based line of its first source line and the text of the nearest
 * ATX heading above it outside any fence (null when there is none).
 */
export function extractMermaidBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let heading = null;
  for (let index = 0; index < lines.length; index += 1) {
    const atx = lines[index].match(/^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/);
    if (atx) {
      heading = atx[1] ?? "";
      continue;
    }
    const opening = lines[index].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!opening) continue;
    const marker = opening[1];
    const info = opening[2].trim();
    const infoToken = info.split(/\s+/, 1)[0] ?? "";
    const isMermaid = infoToken === "mermaid";
    const closing = new RegExp(`^\\s*${escapeRegExp(marker[0])}{${marker.length},}\\s*$`);
    const line = index + 2;
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
    if (isMermaid) blocks.push({ body: body.join("\n"), line, heading });
  }
  return blocks;
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
