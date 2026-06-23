import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DOC = readFileSync("docs/runbooks/local-product-lifecycle.md", "utf8");

describe("local product lifecycle runbook", () => {
  test("documents install, upgrade, uninstall, and retained local state", () => {
    for (const section of ["## Install", "## Upgrade", "## Uninstall", "## Data Retention", "## Verification"]) {
      expect(DOC).toContain(section);
    }

    for (const command of [
      "node scripts/packaged-cli-smoke.mjs",
      "archctx mcp install --host codex",
      "archctx paths",
      "archctx daemon status",
      "archctx daemon upgrade",
      "archctx mcp remove --host codex",
      "archctx daemon stop"
    ]) {
      expect(DOC).toContain(command);
    }

    expect(DOC).toContain("No GitHub App, Cloud account, subscription, or LLM provider is required for Local Core.");
    expect(DOC).toContain("Destructive data deletion must be an explicit user action");
    expect(DOC).toContain(".archcontext/model");
    expect(DOC).toContain("OS user-data");
    expect(DOC).toContain("legacy migration");
  });
});
