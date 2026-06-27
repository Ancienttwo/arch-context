import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DOC = readFileSync("docs/runbooks/local-core-quickstart.md", "utf8");

describe("local core quickstart runbook", () => {
  test("documents a no-cloud first-run path for Local Core", () => {
    for (const section of [
      "## Prerequisites",
      "## Install The Local Product",
      "## Start In A Repository",
      "## Connect A Local Agent Host",
      "## Stop The Local Daemon",
      "## Optional Governance",
      "## Verification"
    ]) {
      expect(DOC).toContain(section);
    }

    for (const command of [
      "npm install -g archctx@latest",
      "bun install",
      "node scripts/packaged-cli-smoke.mjs",
      "archctx doctor",
      "archctx paths",
      "archctx init --name",
      "archctx sync",
      "archctx prepare --task",
      "archctx status",
      "archctx mcp install --host codex",
      "archctx mcp status --host codex",
      "archctx daemon stop",
      "bun run readback:release"
    ]) {
      expect(DOC).toContain(command);
    }

    expect(DOC).toContain("Checkout development path");
    expect(DOC).toContain("generated `archctx` package");
    expect(DOC).toContain("No GitHub App, Cloud account, subscription, or LLM provider is required for Local Core.");
    expect(DOC).toContain("Local Core remains usable without installing it.");
    expect(DOC).toContain("Local Core commands do not require provider keys");
    expect(DOC).not.toContain("install GitHub App before");
    expect(DOC).not.toContain("OPENAI_API_KEY=");
    expect(DOC).not.toContain("ANTHROPIC_API_KEY=");
  });
});
