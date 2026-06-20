import { describe, expect, test } from "bun:test";
import { buildGaUiState, buildUiToolMetadata, CHATGPT_UI_RESOURCE_URI, renderTaskContextHtml } from "../src/index";

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
      intervention: { decision: "approve-target-state" },
      migrationProgress: { required: 3, completed: 2, blocked: 1 },
      diffPreview: { files: [{ path: ".archcontext/model/nodes/module.billing.yaml", status: "created" }] },
      findings: [{ severity: "warning", message: "test" }]
    });
    expect(html).toContain("Data sharing");
    expect(html).toContain("Pressure / Confidence");
    expect(html).toContain("Target / Migration");
    expect(html).toContain("Intervention Decision");
    expect(html).toContain("Migration Progress");
    expect(html).toContain("ChangeSet Preview");
    expect(html).toContain("ChangeSet Diff");
    const state = buildGaUiState({ writeEnabled: false });
    expect(state.writeMode).toBe("disabled");
    expect(state.disclosure).toContain("local runtime");
  });
});
