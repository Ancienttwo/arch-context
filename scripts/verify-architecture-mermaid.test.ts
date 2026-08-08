import { expect, test } from "bun:test";
import { extractMermaidFences } from "./verify-architecture-mermaid.mjs";

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
