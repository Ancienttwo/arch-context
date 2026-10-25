import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  renderArchitectureDocumentationProjection,
  type NativeModel
} from "../packages/core/projection-engine/src/index";
import { extractMermaidBlocks } from "./verify-architecture-mermaid.mjs";

const repositoryRoot = resolve(import.meta.dir, "..");
const script = join(repositoryRoot, "scripts/check-architecture-mermaid.mjs");

/** Runs the check as CI does: in Node, in its own process, so the DOM shim never leaks into bun test. */
function check(...args: string[]): { status: number | null; report: any } {
  const run = spawnSync("node", [script, ...args], { cwd: repositoryRoot, encoding: "utf8", timeout: 60_000 });
  return { status: run.status, report: JSON.parse(run.stdout) };
}

function withRoot(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "archctx-mermaid-check-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), body, "utf8");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const HUMAN = [
  "# Payments",
  "",
  "## Flow",
  "",
  "```mermaid",
  "flowchart LR",
  "  a --> b",
  "```",
  "",
  "## Broken view ##",
  "",
  "```text",
  "# not a heading",
  "```",
  "",
  "~~~mermaid",
  "flowchart LR",
  "  a -->",
  "~~~",
  ""
].join("\n");

test("Mermaid blocks carry their first source line and the nearest heading outside a fence", () => {
  expect(extractMermaidBlocks(HUMAN)).toEqual([
    { body: "flowchart LR\n  a --> b", line: 6, heading: "Flow" },
    { body: "flowchart LR\n  a -->", line: 17, heading: "Broken view" }
  ]);
  expect(extractMermaidBlocks("```mermaid\nflowchart LR\n```")).toEqual([{ body: "flowchart LR", line: 2, heading: null }]);
});

test("a broken block fails the syntax check with its file, line and heading; the others still report ok", () => {
  withRoot({
    "docs/architecture/modules/payments.md": HUMAN,
    "docs/architecture/diagrams/architecture.mmd": "%% Generated\nflowchart LR\n  a --> b\n"
  }, (root) => {
    const { status, report } = check("--root", root);
    expect(status).toBe(1);
    expect(report).toMatchObject({ schemaVersion: "archcontext.architecture-mermaid-check/v1", ok: false, mermaidVersion: "11.16.1", blockCount: 3, errorCount: 1 });
    expect(report.blocks.map(({ error, ...rest }: { error: string | null }) => ({ ...rest, error: error === null ? null : error.split("\n")[0] }))).toEqual([
      { file: "docs/architecture/diagrams/architecture.mmd", line: 1, heading: null, ok: true, error: null },
      { file: "docs/architecture/modules/payments.md", line: 6, heading: "Flow", ok: true, error: null },
      { file: "docs/architecture/modules/payments.md", line: 17, heading: "Broken view", ok: false, error: "Parse error on line 3:" }
    ]);
    expect(report.renderPage).toBeUndefined();
  });
}, 60_000);

test("an empty corpus and an unknown flag fail closed", () => {
  withRoot({ "docs/architecture/index.md": "# Architecture\n" }, (root) => {
    expect(check("--root", root)).toEqual({ status: 1, report: { schemaVersion: "archcontext.architecture-mermaid-check/v1", ok: false, error: "architecture Mermaid corpus is empty" } });
    const unknown = check("--root", root, "--strict");
    expect(unknown.status).toBe(1);
    expect(unknown.report.error).toStartWith("unrecognized argument --strict");
  });
}, 60_000);

test("generated topology, layered and capability diagrams pass the syntax check", () => {
  const digest = `sha256:${"7".repeat(64)}`;
  const topology = JSON.parse(readFileSync(join(repositoryRoot, "packages/contracts/fixtures/model/valid/runtime-topology.json"), "utf8")) as NativeModel;
  const layered: NativeModel = {
    ...topology,
    nodes: topology.nodes.map((node) => node.kind === "capability" || node.kind === "component" ? { ...node, layer: "domain" } : node)
  };
  const plan = renderArchitectureDocumentationProjection({
    model: layered,
    sourceDigest: digest,
    provenance: architectureDocumentationProjectionProvenance({
      sourceTreeDigest: digest,
      modelDigest: digest,
      rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
      layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
      generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.2" }
    }),
    sourceFootprints: [],
    sourceScaleSignals: [],
    importGraphs: [],
    selectorEvidence: []
  });
  withRoot(Object.fromEntries(plan.files.map((file) => [file.path, file.body])), (root) => {
    const { status, report } = check("--root", root);
    expect(report.errorCount).toBe(0);
    expect(status).toBe(0);
    expect(report.blocks.map((block: { file: string }) => block.file)).toContain("docs/architecture/diagrams/runtime-topology.mmd");
  });
}, 60_000);

test("the render page embeds every block and loads the pinned mermaid.min.js from beside it", () => {
  withRoot({
    "docs/architecture/modules/payments.md": `${HUMAN}\n## Script\n\n\`\`\`mermaid\nflowchart LR\n  a["</script><b>x</b>"] --> b\n\`\`\`\n`
  }, (root) => {
    const page = join(root, "render");
    const { status, report } = check("--root", root, "--render-page", page);
    expect(status).toBe(1);
    expect(report.renderPage).toEqual({ path: join(page, "index.html"), mermaidScript: join(page, "mermaid.min.js") });
    const html = readFileSync(join(page, "index.html"), "utf8");
    expect(readFileSync(join(page, "mermaid.min.js"))).toEqual(readFileSync(join(repositoryRoot, "node_modules/mermaid/dist/mermaid.min.js")));
    // Offline: the only script source is the local copy, and no URL reaches the network.
    expect([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1])).toEqual(["mermaid.min.js"]);
    expect(html).not.toMatch(/https?:\/\//);
    // The embedded blocks cannot close their own script element.
    const embedded = html.match(/<script type="application\/json" id="archctx-mermaid-blocks">([^]*?)<\/script>/)![1]!;
    expect(embedded).not.toContain("<");
    expect(JSON.parse(embedded)).toEqual(report.blocks.map((block: { file: string; line: number; heading: string | null }, index: number) => ({
      file: block.file,
      line: block.line,
      heading: block.heading,
      body: extractMermaidBlocks(readFileSync(join(root, block.file), "utf8"))[index]!.body
    })));
    expect(html).toContain("window.__results = results;");
  });
  // Without a directory the page goes to a fresh temporary directory.
  withRoot({ "docs/architecture/diagrams/architecture.mmd": "flowchart LR\n  a --> b\n" }, (root) => {
    const { status, report } = check("--root", root, "--render-page");
    expect(status).toBe(0);
    try {
      expect(report.renderPage.path.startsWith(resolve(tmpdir()))).toBe(true);
      expect(existsSync(report.renderPage.path)).toBe(true);
    } finally {
      rmSync(dirname(report.renderPage.path), { recursive: true, force: true });
    }
  });
}, 60_000);
