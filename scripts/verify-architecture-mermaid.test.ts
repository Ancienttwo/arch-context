import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  renderArchitectureDocumentationProjection
} from "../packages/core/projection-engine/src/index";
import { extractMermaidFences, verifyArchitectureMermaid } from "./verify-architecture-mermaid.mjs";

/** Renders a small projection and writes its files under a fresh directory. */
function withRenderedProjection(check: (root: string, files: Map<string, string>) => void): void {
  const digest = `sha256:${"7".repeat(64)}`;
  const plan = renderArchitectureDocumentationProjection({
    model: {
      nodes: [
        { id: "module.payment", kind: "module", name: "Payment \"core\"" },
        { id: "module.ledger", kind: "module", name: "Ledger" }
      ],
      relations: [{ id: "relation.payment-ledger", kind: "depends_on", source: "module.payment", target: "module.ledger", intent: "Records payments." }]
    },
    sourceDigest: digest,
    provenance: architectureDocumentationProjectionProvenance({
      sourceTreeDigest: digest,
      modelDigest: digest,
      rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
      layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
      generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1" }
    }),
    sourceFootprints: [],
    sourceScaleSignals: [],
    importGraphs: [],
    selectorEvidence: []
  });
  const root = mkdtempSync(join(tmpdir(), "archctx-generated-mermaid-"));
  try {
    const files = new Map(plan.files.map((file) => [file.path, file.body]));
    for (const [path, body] of files) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    check(root, files);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a generated architecture.mmd is valid Mermaid as written, and the generated JSON parses (#327)", () => {
  withRenderedProjection((root, files) => {
    const structurizr = files.get("docs/architecture/diagrams/architecture.structurizr.json")!;
    expect(JSON.parse(structurizr).model.relationships).toHaveLength(1);
    // Only the whole-file Mermaid output: the pinned Mermaid CLI renders it with nothing stripped.
    const diagrams = join(root, "docs/architecture/diagrams");
    rmSync(join(diagrams, "architecture.likec4"));
    rmSync(join(diagrams, "architecture.structurizr.json"));
    expect(() => verifyArchitectureMermaid(diagrams)).not.toThrow();
  });
}, 120_000);

test("a .mmd file that still carries an HTML ownership marker fails the Mermaid parser", () => {
  withRenderedProjection((root, files) => {
    const diagrams = join(root, "docs/architecture/diagrams");
    rmSync(join(diagrams, "architecture.likec4"));
    rmSync(join(diagrams, "architecture.structurizr.json"));
    const body = files.get("docs/architecture/diagrams/architecture.mmd")!;
    writeFileSync(join(diagrams, "architecture.mmd"), `<!-- BEGIN ARCHCONTEXT:generated target="projection_target.diagram.mermaid" -->\n${body}<!-- END ARCHCONTEXT:generated target="projection_target.diagram.mermaid" -->\n`);
    expect(() => verifyArchitectureMermaid(diagrams)).toThrow("Mermaid render failed");
  });
}, 120_000);

test("extracts indented, long-backtick, and tilde Mermaid fences", () => {
  const markdown = [
    "- architecture",
    "    ````mermaid title=runtime",
    "    flowchart LR",
    "      A --> B",
    "    ````",
    "~~~ mermaid",
    "sequenceDiagram",
    "  A->>B: request",
    "~~~~"
  ].join("\n");
  expect(extractMermaidFences(markdown)).toEqual([
    "    flowchart LR\n      A --> B",
    "sequenceDiagram\n  A->>B: request"
  ]);
});

test("does not treat lookalike info strings or nested fences as Mermaid", () => {
  const markdown = [
    "```text",
    "```mermaid",
    "flowchart LR",
    "```",
    "```",
    "```mermaid-example",
    "flowchart LR",
    "```"
  ].join("\n");
  expect(extractMermaidFences(markdown)).toEqual([]);
});

test("fails closed for an unclosed Mermaid fence", () => {
  expect(() => extractMermaidFences("```mermaid\nflowchart LR")).toThrow("unclosed Mermaid fence");
});
