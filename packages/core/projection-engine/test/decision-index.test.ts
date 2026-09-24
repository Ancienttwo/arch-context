import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadArchitectureDecisionRecords } from "../src/index";

function withAdr(body: string, check: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "archctx-adr-index-"));
  try {
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(join(root, "docs/adr/ADR-0001-test.md"), body);
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("ADR index source metadata", () => {
  test("uses YAML title and status despite conflicting Markdown headings", () => {
    withAdr("\uFEFF---\r\ntitle: 'Use runtime: local' # display title\r\nstatus: accepted\r\nnotes: |\r\n  Other metadata may contain arbitrary text.\r\n---\r\n# Context\r\nStatus: rejected\r\n", (root) => {
      expect(loadArchitectureDecisionRecords(root)).toEqual([{
        id: "ADR-0001-test", path: "docs/adr/ADR-0001-test.md",
        title: "Use runtime: local", status: "accepted"
      }]);
    });
  });

  test("does not invent metadata from the body when frontmatter is missing or invalid", () => {
    for (const body of [
      "# Context\nStatus: accepted\n",
      "---\ntitle: Missing delimiter\n# Context\n",
      "---\nstatus: accepted\n---\n# Context\n",
      "---\ntitle: 42\n---\n# Context\n",
      "---\ntitle: A\nstatus: []\n---\n# Context\n",
      "---\ntitle: |\n  First line\n  Second line\n---\n# Context\n",
      "---\ntitle: A\nstatus: |\n  accepted\n  extra\n---\n# Context\n",
      "---\ntitle: A\ntitle: B\n---\n# Context\n"
    ]) {
      withAdr(body, (root) => expect(() => loadArchitectureDecisionRecords(root)).toThrow());
    }
  });

  test("reads the repository ADR catalog using declared titles", () => {
    const records = loadArchitectureDecisionRecords(resolve(import.meta.dir, "../../../.."));
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.title !== "Context")).toBe(true);
    expect(records.find((record) => record.id.startsWith("ADR-0001-"))?.title).toBe("Agentic Architecture Control Loop");
  });
});
