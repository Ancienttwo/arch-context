import { describe, expect, test } from "bun:test";
import { ARCHITECTURE_DOCS_RENDERER_VERSION, digestJson } from "@archcontext/contracts";
import { analyzeNativeDocument, scanDocumentRegions } from "../src/document-regions";
import { humanOwnedMarkdownLines } from "../src/prose-anchors";
import { fixtureDocument, TARGET_ID } from "../../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";
const begin = (attributes = "") => `<!-- BEGIN ARCHCONTEXT:generated target="${TARGET_ID}" rendererVersion="${ARCHITECTURE_DOCS_RENDERER_VERSION}" outputDigest="${digestJson({ targetId: TARGET_ID, body: "generated\n" })}"${attributes} -->`;
const end = `<!-- END ARCHCONTEXT:generated target="${TARGET_ID}" -->`;
describe("shared lossless document regions", () => {
  test.each(["\n", "\r\n"])("round trips UTF-8/BOM/comments/fences and original %j terminators", newline => {
    const body = fixtureDocument(newline); const bytes = Buffer.from(body);
    const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
    for (const region of result.humanRegions) expect(bytes.subarray(region.startByte, region.endByte).toString("utf8")).toBe(region.text);
    for (const section of [result.section3, result.backlog]) expect(section.bodyRanges.map(range => bytes.subarray(range.startByte, range.endByte).toString("utf8")).join("")).toBe(section.body!);
    expect(result.humanRegions[0]!.text.startsWith("\uFEFF")).toBe(true);
    expect(result.section3.body).toContain(`<!-- keep this comment -->${newline}`);
    expect(result.section3.body).toContain(`## Example heading${newline}`);
    expect(result.section3.body).toContain(`### Nested detail${newline}`);
    expect(result.backlog).toMatchObject({ state: "empty", body: ` \t${newline}` });
  });
  test("section ends at the next actual human H2, retaining ordered disjoint ranges", () => {
    const body = `## 3. P3\nalpha\n${begin()}\ngenerated\n${end}\nbeta\n## Optimization Backlog\nitem\n`;
    const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
    expect(result.section3.body).toBe("alpha\nbeta\n");
    expect(result.section3.bodyRanges).toHaveLength(2);
    expect(result.backlog.body).toBe("item\n");
  });
  test.each(["P3:設計決策與不變量", "P3：設計決策與不變量", "P3：设计决策与不变量", "P3: Design Decisions and Invariants"])("recognizes renderer section 3 heading %s", title => { expect(analyzeNativeDocument(`## 3. ${title}\ntext\n`, "docs/demo.md", TARGET_ID).section3.state).toBe("present"); });
  test("absent and empty remain distinct, and comments/fences count as body content", () => {
    expect(analyzeNativeDocument("# Only title\n", "docs/demo.md", TARGET_ID).section3).toMatchObject({ state: "absent", heading: null, body: null });
    expect(analyzeNativeDocument("## 3. P3\n", "docs/demo.md", TARGET_ID).section3).toMatchObject({ state: "empty", body: "" });
    for (const body of ["<!-- retained -->\n", "```\n```\n"]) expect(analyzeNativeDocument(`## 3. P3\n${body}`, "docs/demo.md", TARGET_ID).section3.state).toBe("present");
  });
  test("literal markers and apparent headings inside comments/fences/code do not become structure", () => {
    const body = `~~~md\n${begin()}\n## 3. Example\n~~~\n<!-- ordinary\n<!-- BEGIN ARCHCONTEXT:generated literal\n## Optimization Backlog\n-->\ninline \`${begin()}\`\n## 3. Real\ncontent\n`;
    const scan = scanDocumentRegions(body);
    expect(scan.generatedRegions).toEqual([]); expect(scan.diagnostics).toEqual([]);
    const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
    expect(result.humanRegions.map(region => region.text).join("")).toBe(body);
    expect(result.section3.body).toBe("content\n"); expect(result.backlog.state).toBe("absent");
  });
  test.each([`## 3. A\nx\n## 3. B\ny\n`, `## Optimization Backlog\nx\n## Optimization Backlog\ny\n`])("duplicate human section is an explicit ambiguity", body => { expect(() => analyzeNativeDocument(body, "docs/demo.md", TARGET_ID)).toThrow("native-document-section-ambiguous"); });
  test.each([
    ["unmatched begin", `${begin()}\ngenerated\n`],
    ["unmatched end", end],
    ["mismatched end", `${begin()}\ngenerated\n<!-- END ARCHCONTEXT:generated target="other" -->`],
    ["nested region", `${begin()}\n${begin()}\ngenerated\n${end}`],
    ["duplicate region", `${begin()}\ngenerated\n${end}\n${begin()}\ngenerated\n${end}`],
    ["duplicate attribute", `${begin(' target="other"')}\ngenerated\n${end}`],
    ["bad digest", `${begin()}\nchanged\n${end}`],
    ["reserved malformed token", "<!-- BEGIN ARCHCONTEXT:generated malformed -->"],
    ["unknown renderer", `${begin().replace(ARCHITECTURE_DOCS_RENDERER_VERSION, "unsupported/v1")}\ngenerated\n${end}`]
  ])("rejects %s", (_name, body) => { expect(() => analyzeNativeDocument(body, "docs/demo.md", TARGET_ID)).toThrow("native-document-marker-invalid"); });
  test("a wrong expected target fails even with a self-consistent body digest", () => { expect(() => analyzeNativeDocument(`${begin()}\ngenerated\n${end}`, "docs/demo.md", "other")).toThrow("native-document-marker-invalid"); });
  test("citation filtering is layered above human spans and retains unmatched-marker policy", () => {
    const body = `Human \`src/a.ts\`.\n<!-- BEGIN ARCHCONTEXT:generated target="t" -->\n\`src/b.ts\`\n`;
    expect(humanOwnedMarkdownLines(body)).toEqual([{ line: 1, text: "Human `src/a.ts`." }]);
  });
});
