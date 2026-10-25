#!/usr/bin/env node

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectMermaidBlocks } from "./verify-architecture-mermaid.mjs";

export const ARCHITECTURE_MERMAID_CHECK_SCHEMA_VERSION = "archcontext.architecture-mermaid-check/v1";
const EXPECTED_MERMAID_VERSION = "11.16.1";
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mermaidPackageRoot = join(repositoryRoot, "node_modules", "mermaid");
const USAGE = "usage: node scripts/check-architecture-mermaid.mjs [--root <repository>] [--render-page [<directory>]]";

function parseArguments(args) {
  const options = { root: repositoryRoot };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    const hasValue = value !== undefined && !value.startsWith("--");
    if (flag === "--root" && hasValue) {
      options.root = resolve(value);
      index += 1;
    } else if (flag === "--render-page") {
      options.renderPage = hasValue ? resolve(value) : mkdtempSync(join(tmpdir(), "archctx-mermaid-render-"));
      if (hasValue) index += 1;
    } else {
      throw new Error(`unrecognized argument ${flag}; ${USAGE}`);
    }
  }
  return options;
}

/**
 * Syntax-checks every Mermaid block under `<root>/docs/architecture` (generated `.mmd` files, and
 * the Mermaid fences of every Markdown file there, generated regions and human-authored text
 * alike) with the pinned `mermaid.parse`, in Node and without a browser. The report is ok only when
 * every block parses. With `renderPage`, it also writes a render-check page there for an agent to
 * open in its own browser (`writeMermaidRenderPage`).
 */
export async function checkArchitectureMermaid({ root = repositoryRoot, renderPage } = {}) {
  const installed = JSON.parse(readFileSync(join(mermaidPackageRoot, "package.json"), "utf8"));
  if (installed.version !== EXPECTED_MERMAID_VERSION) {
    throw new Error(`expected mermaid@${EXPECTED_MERMAID_VERSION}, found ${String(installed.version)}`);
  }
  const blocks = collectMermaidBlocks(join(root, "docs", "architecture"), root);
  if (blocks.length === 0) throw new Error("architecture Mermaid corpus is empty");
  const mermaid = await loadMermaidForNode();
  const results = [];
  for (const block of blocks) {
    try {
      await mermaid.parse(block.body);
      results.push({ file: block.file, line: block.line, heading: block.heading, ok: true, error: null });
    } catch (error) {
      results.push({ file: block.file, line: block.line, heading: block.heading, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const errorCount = results.filter((result) => !result.ok).length;
  return {
    schemaVersion: ARCHITECTURE_MERMAID_CHECK_SCHEMA_VERSION,
    ok: errorCount === 0,
    mermaidVersion: EXPECTED_MERMAID_VERSION,
    blockCount: results.length,
    errorCount,
    blocks: results,
    ...(renderPage === undefined ? {} : { renderPage: writeMermaidRenderPage(renderPage, blocks) })
  };
}

/**
 * `mermaid.parse` never lays anything out, but Mermaid installs DOMPurify hooks to sanitize labels,
 * and DOMPurify needs a `window`. A linkedom window is enough for that; no browser is started.
 */
async function loadMermaidForNode() {
  const { parseHTML } = await import("linkedom");
  const { window } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  globalThis.window = window;
  globalThis.document = window.document;
  const entry = pathToFileURL(join(mermaidPackageRoot, "dist", "mermaid.core.mjs")).href;
  return (await import(entry)).default;
}

/**
 * Writes `index.html` with every block embedded and a copy of the pinned `mermaid.min.js` beside
 * it, so the page works offline. Opened in a browser, it runs `mermaid.parse` and `mermaid.render`
 * per block and publishes one result per block in `window.__results` ({ file, line, heading, ok,
 * error, width, height }, the SVG size from its viewBox), then sets `window.__done`.
 * The page is temporary output: nothing commits it.
 */
export function writeMermaidRenderPage(directory, blocks) {
  mkdirSync(directory, { recursive: true });
  const mermaidScript = join(directory, "mermaid.min.js");
  copyFileSync(join(mermaidPackageRoot, "dist", "mermaid.min.js"), mermaidScript);
  const embedded = JSON.stringify(blocks.map(({ file, line, heading, body }) => ({ file, line, heading, body })))
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
  const path = join(directory, "index.html");
  writeFileSync(path, RENDER_PAGE_TEMPLATE.replace("__BLOCKS__", () => embedded), "utf8");
  return { path, mermaidScript };
}

const RENDER_PAGE_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mermaid render check</title>
<style>
  :root { color-scheme: light dark; --ok: #1a7f37; --error: #cf222e; --rule: #8c959f55; }
  body { margin: 0 auto; max-width: 72rem; padding: 1rem; font: 14px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  section { border-top: 1px solid var(--rule); padding: 1rem 0; }
  h2 { font-size: 1rem; margin: 0 0 .5rem; overflow-wrap: anywhere; }
  .ok { color: var(--ok); } .error { color: var(--error); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  figure { margin: 0; overflow-x: auto; }
</style>
</head>
<body>
<h1>Mermaid render check</h1>
<p id="summary">Rendering…</p>
<main id="blocks"></main>
<script type="application/json" id="archctx-mermaid-blocks">__BLOCKS__</script>
<script src="mermaid.min.js"></script>
<script>
(async () => {
  const blocks = JSON.parse(document.getElementById("archctx-mermaid-blocks").textContent);
  const container = document.getElementById("blocks");
  const results = [];
  const loaded = typeof window.mermaid !== "undefined";
  if (loaded) window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  for (const [index, block] of blocks.entries()) {
    const result = { file: block.file, line: block.line, heading: block.heading, ok: false, error: null, width: null, height: null };
    const section = document.createElement("section");
    const title = document.createElement("h2");
    const status = document.createElement("span");
    const figure = document.createElement("figure");
    title.textContent = block.file + ":" + block.line + (block.heading === null ? "" : " — " + block.heading) + " ";
    title.append(status);
    section.append(title, figure);
    container.append(section);
    try {
      if (!loaded) throw new Error("mermaid.min.js did not load");
      await window.mermaid.parse(block.body);
      const { svg } = await window.mermaid.render("archctx-mermaid-" + index, block.body);
      figure.innerHTML = svg;
      const element = figure.querySelector("svg");
      const viewBox = element && element.viewBox ? element.viewBox.baseVal : null;
      const box = viewBox && viewBox.width > 0 ? viewBox : element ? element.getBBox() : { width: 0, height: 0 };
      result.width = Math.round(box.width);
      result.height = Math.round(box.height);
      result.ok = result.width > 0 && result.height > 0;
      if (!result.ok) result.error = "rendered SVG has no size";
    } catch (error) {
      result.error = String(error && error.message ? error.message : error);
      const message = document.createElement("pre");
      message.textContent = result.error;
      figure.replaceChildren(message);
    }
    status.className = result.ok ? "ok" : "error";
    status.textContent = result.ok ? "ok (" + result.width + "×" + result.height + ")" : "error";
    results.push(result);
  }
  const failed = results.filter((result) => !result.ok).length;
  document.getElementById("summary").textContent = results.length + " block(s), " + failed + " failed.";
  window.__results = results;
  window.__done = true;
})();
</script>
</body>
</html>
`;

// Last, so the entry's top-level await runs after every module constant is initialized.
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  let report;
  try {
    report = await checkArchitectureMermaid(parseArguments(process.argv.slice(2)));
  } catch (error) {
    report = { schemaVersion: ARCHITECTURE_MERMAID_CHECK_SCHEMA_VERSION, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
