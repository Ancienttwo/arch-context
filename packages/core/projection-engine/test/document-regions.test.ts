import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ARCHITECTURE_DOCS_RENDERER_VERSION, digestJson } from "@archcontext/contracts";
import { analyzeNativeDocument, scanDocumentRegions } from "../src/document-regions";
import { humanOwnedMarkdownLines } from "../src/prose-anchors";
import { fixtureDocument, TARGET_ID } from "../../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";
const begin = (attributes = "") => `<!-- BEGIN ARCHCONTEXT:generated target="${TARGET_ID}" rendererVersion="${ARCHITECTURE_DOCS_RENDERER_VERSION}" outputDigest="${digestJson({ targetId: TARGET_ID, body: "generated\n" })}"${attributes} -->`;
const end = `<!-- END ARCHCONTEXT:generated target="${TARGET_ID}" -->`;
describe("shared lossless document regions", () => {
  test("multiline exact-length code spans retain literal marker bytes and apparent headings", () => {
    for (const tick of ["`", "``"]) {
      const body = `Example ${tick}open\ninline ${begin()}generated${end}\ninline ## 3. Literal\nclose${tick}\n## 3. Real\nhuman\n`;
      const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
      expect(result.markerState).toBe("absent");
      expect(result.humanRegions.map(region => region.text).join("")).toBe(body);
      expect(result.section3.body).toBe("human\n");
    }
  });
  test.each(["    ", "\t"])("indented code after a block boundary preserves %j marker examples", indent => {
    const body = `Example:\n\n${indent}${begin()}\n${indent}generated\n${indent}${end}\n\n## 3. Real\nhuman\n`;
    const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
    expect(result.markerState).toBe("absent"); expect(result.humanRegions.map(region => region.text).join("")).toBe(body);
    expect(result.section3.body).toBe("human\n");
  });
  test.each(["prefix ` ", "prefix \\` ", "prefix ` open\n\n", "prefix ` open\n## New block\n"])("unpaired/escaped/block-separated backticks %j cannot hide real delimiters", prefix => {
    const body = `${prefix}${begin()}\ngenerated\n${end}\n\` after\n`;
    expect(analyzeNativeDocument(body, "docs/demo.md", TARGET_ID).markerState).toBe("present");
  });
  test("long internal heading whitespace preserves its title without regex backtracking", () => {
    const title = `x${" ".repeat(20_000)}y`;
    expect(scanDocumentRegions(`## ${title}\n`).headings[0]!.title).toBe(title);
    expect(scanDocumentRegions("## Optimization Backlog ###   \nitem\n").headings[0]!.title).toBe("Optimization Backlog");
  });
  test.each(["", "\uFEFF"])("ATX heading backticks with BOM %j cannot hide a bad checksum in the following paragraph", bom => {
    const body = `${bom}## 3. \`open\ninline ${begin()}changed${end}\nclose\`\n`;
    expect(() => analyzeNativeDocument(body, "docs/demo.md", TARGET_ID)).toThrow("native-document-marker-invalid");
  });
  test("escaping the first backtick still allows the remainder of its run to open literal code", () => {
    const body = `Example \\` + "``" + `open ${begin()}generated${end} close\`\n`;
    const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
    expect(result.markerState).toBe("absent"); expect(result.humanRegions.map(region => region.text).join("")).toBe(body);
  });
  test("a closed ordinary HTML comment block allows the following indented code block", () => {
    const body = `<!-- ordinary -->\n    ${begin()}\n    generated\n    ${end}\n`;
    const result = analyzeNativeDocument(body, "docs/demo.md", TARGET_ID);
    expect(result.markerState).toBe("absent"); expect(result.humanRegions.map(region => region.text).join("")).toBe(body);
  });
  test("legacy citation keeps human references after an unclosed generated-body fence", () => {
    const body = `${begin()}\n\`\`\`ts\nconst incompleteExample = true;\n${end}\nHuman \`src/missing.ts\`.\n`;
    expect(humanOwnedMarkdownLines(body)).toEqual([{ line: 5, text: "Human `src/missing.ts`." }]);
    expect(() => analyzeNativeDocument(body, "docs/demo.md", TARGET_ID)).toThrow("native-document-marker-invalid");
  });
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
  test("all 40 frozen v5 documents preserve the independently captured non-generated bytes", () => {
    const corpus = JSON.parse(readFileSync(join(import.meta.dir, "../../../local-runtime/model-store-yaml/test/fixtures/native-context/downstream-corpus/documents-v5.json"), "utf8"));
    expect(corpus.documentCount).toBe(40);
    for (const document of corpus.documents) {
      const bytes = Buffer.from(document.source);
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, document.path).toBe(document.sourceDigest);
      const result = analyzeNativeDocument(document.source, document.path, document.targetId);
      const expected = Buffer.concat([bytes.subarray(0, document.generatedStartByte), bytes.subarray(document.generatedEndByte)]);
      const human = Buffer.from(result.humanRegions.map(region => region.text).join(""));
      expect(human.equals(expected), document.path).toBe(true);
      expect(`sha256:${createHash("sha256").update(human).digest("hex")}`, document.path).toBe(document.expectedHumanDigest);
      for (const region of result.humanRegions) expect(bytes.subarray(region.startByte, region.endByte).toString("utf8"), document.path).toBe(region.text);
      for (const section of [result.section3, result.backlog]) if (section.body !== null) expect(section.bodyRanges.map(range => bytes.subarray(range.startByte, range.endByte).toString("utf8")).join(""), document.path).toBe(section.body);
    }
  });
  const v5 = () => begin().replace(`rendererVersion="${ARCHITECTURE_DOCS_RENDERER_VERSION}"`, `sourceDigest="sha256:${"a".repeat(64)}" rendererVersion="archcontext.docs-renderer/v5"`);
  test("v5 sourceDigest is opaque historical metadata, never freshness authority", () => {
    const first = `${v5()}\ngenerated\n${end}\n## 3. P3\nhuman\n`;
    expect(analyzeNativeDocument(first, "docs/demo.md", TARGET_ID)).toEqual(analyzeNativeDocument(first.replace("a".repeat(64), "b".repeat(64)), "docs/demo.md", TARGET_ID));
  });
  test.each([
    ["missing sourceDigest", () => v5().replace(/ sourceDigest="[^"]+"/, "")],
    ["malformed sourceDigest", () => v5().replace("a".repeat(64), "bad")],
    ["duplicate sourceDigest", () => v5().replace(" -->", ` sourceDigest="sha256:${"b".repeat(64)}" -->`)],
    ["unknown attribute", () => v5().replace(" -->", ' permissive="yes" -->')],
    ["unknown renderer", () => v5().replace("renderer/v5", "renderer/v4")]
  ])("v5 %s is rejected", (_name, marker) => { expect(() => analyzeNativeDocument(`${marker()}\ngenerated\n${end}`, "docs/demo.md", TARGET_ID)).toThrow("native-document-marker-invalid"); });
  test("v5 pairing/target/body checksum guards stay enforced and v6 output does not gain sourceDigest", () => {
    for (const body of [`${v5()}\nchanged\n${end}`, `${v5()}\ngenerated\n`, `${v5()}\n${v5()}\ngenerated\n${end}`, `${v5()}\ngenerated\n${end}\n${v5()}\ngenerated\n${end}`]) expect(() => analyzeNativeDocument(body, "docs/demo.md", TARGET_ID)).toThrow("native-document-marker-invalid");
    expect(() => analyzeNativeDocument(`${v5()}\ngenerated\n${end}`, "docs/demo.md", "other")).toThrow("native-document-marker-invalid");
    expect(() => analyzeNativeDocument(`${begin(` sourceDigest="sha256:${"a".repeat(64)}"`)}\ngenerated\n${end}`, "docs/demo.md", TARGET_ID)).toThrow("native-document-marker-invalid");
  });
});
