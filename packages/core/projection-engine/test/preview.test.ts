import { describe, expect, test } from "bun:test";
import { PROJECTION_FILE_PREVIEW_MAX_BYTES, PROJECTION_PREVIEW_TOTAL_MAX_BYTES } from "@archcontext/contracts";
import { architectureProjectionFilePreviews, unifiedDiff } from "../src/index";

const bytes = (value: string) => new TextEncoder().encode(value).length;

describe("projection plan previews (#264)", () => {
  test("a create carries the rendered body; update and delete carry a unified diff", () => {
    const [created, updated, deleted] = architectureProjectionFilePreviews([
      { path: "docs/architecture/index.md", action: "create", after: "# Index\n" },
      { path: "docs/architecture/modules/a.md", action: "update", before: "a\nb\nc\n", after: "a\nB\nc\n" },
      { path: "docs/architecture/modules/old.md", action: "delete", before: "gone\n" }
    ]);
    expect(created).toEqual({ format: "body", content: "# Index\n", byteLength: 8, truncated: false });
    expect(updated!.format).toBe("unified-diff");
    expect(updated!.content).toBe([
      "--- a/docs/architecture/modules/a.md",
      "+++ b/docs/architecture/modules/a.md",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      ""
    ].join("\n"));
    expect(deleted!.content).toBe("--- a/docs/architecture/modules/old.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n");
  });

  test("hunks keep three context lines and mark a missing final newline", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    const after = before.replace("line 2", "line two").replace("line 19", "line nineteen");
    expect(unifiedDiff("f.md", before, after)).toBe([
      "--- a/f.md",
      "+++ b/f.md",
      "@@ -1,6 +1,6 @@",
      " line 0",
      " line 1",
      "-line 2",
      "+line two",
      " line 3",
      " line 4",
      " line 5",
      "@@ -17,4 +17,4 @@",
      " line 16",
      " line 17",
      " line 18",
      "-line 19",
      "\\ No newline at end of file",
      "+line nineteen",
      "\\ No newline at end of file",
      ""
    ].join("\n"));
  });

  test("content is cut at a line boundary per file and the result budget is shared in order", () => {
    const line = "內容行\n";
    const large = line.repeat(Math.ceil((PROJECTION_FILE_PREVIEW_MAX_BYTES * 2) / bytes(line)));
    const [one] = architectureProjectionFilePreviews([{ path: "a.md", action: "create", after: large }]);
    expect(one!.truncated).toBe(true);
    expect(one!.byteLength).toBe(bytes(large));
    expect(bytes(one!.content)).toBeLessThanOrEqual(PROJECTION_FILE_PREVIEW_MAX_BYTES);
    expect(one!.content.endsWith("\n")).toBe(true);
    expect(large.startsWith(one!.content)).toBe(true);

    // A single line longer than the bound is cut on a UTF-8 character boundary.
    const [longLine] = architectureProjectionFilePreviews([{ path: "b.md", action: "create", after: "字".repeat(PROJECTION_FILE_PREVIEW_MAX_BYTES) }]);
    expect(longLine!.truncated).toBe(true);
    expect(longLine!.content).toBe("字".repeat(Math.floor(PROJECTION_FILE_PREVIEW_MAX_BYTES / 3)));

    const count = Math.ceil(PROJECTION_PREVIEW_TOTAL_MAX_BYTES / PROJECTION_FILE_PREVIEW_MAX_BYTES) + 3;
    const all = architectureProjectionFilePreviews(Array.from({ length: count }, (_, index) => ({ path: `m${index}.md`, action: "create" as const, after: large })));
    const total = all.reduce((sum, preview) => sum + bytes(preview.content), 0);
    expect(total).toBeLessThanOrEqual(PROJECTION_PREVIEW_TOTAL_MAX_BYTES);
    expect(all.every((preview) => preview.truncated)).toBe(true);
    expect(all.at(-1)).toMatchObject({ content: "", truncated: true, byteLength: bytes(large) });
  });

  test("a missing body fails closed", () => {
    expect(() => architectureProjectionFilePreviews([{ path: "x.md", action: "update", before: "a\n" }])).toThrow("projection-preview-rendered-body-missing: x.md");
    expect(() => architectureProjectionFilePreviews([{ path: "x.md", action: "delete" }])).toThrow("projection-preview-current-body-missing: x.md");
  });
});
