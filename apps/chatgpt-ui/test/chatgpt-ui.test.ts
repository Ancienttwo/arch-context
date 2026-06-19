import { describe, expect, test } from "bun:test";
import { buildUiToolMetadata, CHATGPT_UI_RESOURCE_URI, renderTaskContextHtml } from "../src/index";

describe("ChatGPT UI resources", () => {
  test("exports MCP Apps metadata and visible data-sharing disclosure", () => {
    expect(buildUiToolMetadata()._meta["ui.resourceUri"]).toBe(CHATGPT_UI_RESOURCE_URI);
    const html = renderTaskContextHtml({
      repo: "arch-context",
      headSha: "abc123",
      dirty: true,
      task: "add billing",
      posture: "intervention",
      pressureScore: 80,
      confidenceScore: 75,
      findings: [{ severity: "warning", message: "test" }]
    });
    expect(html).toContain("Data sharing");
    expect(html).toContain("Pressure / Confidence");
    expect(html).toContain("Target / Migration");
    expect(html).toContain("ChangeSet Preview");
  });
});
