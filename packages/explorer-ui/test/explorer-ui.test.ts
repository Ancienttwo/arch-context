import { describe, expect, test } from "bun:test";
import type { ExplorerProjection } from "../../contracts/src/index";
import { filterExplorerProjection, renderExplorerHtml } from "../src/index";

const projection: ExplorerProjection = {
  schemaVersion: "archcontext.explorer-projection/v1",
  generatedAt: "2026-06-20T00:00:00.000Z",
  repository: {
    repositoryId: "repo.local",
    headSha: "abc123",
    worktreeDigest: "sha256:test"
  },
  nodes: [
    {
      id: "module.runtime",
      name: "Runtime",
      kind: "module",
      verificationStatus: "MATCHED",
      pressure: { level: "low", score: 8, signals: [] },
      sourceSelectors: [{ path: "packages/runtime-daemon/src/index.ts", symbolId: "ArchctxDaemon" }]
    },
    {
      id: "module.billing",
      name: "Billing",
      kind: "module",
      verificationStatus: "DRIFT",
      pressure: { level: "high", score: 91, signals: ["lifecycle-owner"] },
      sourceSelectors: [{ path: "packages/control-plane/src/index.ts" }]
    }
  ],
  relations: [
    { id: "relation.runtime-billing", source: "module.runtime", target: "module.billing", kind: "uses", verificationStatus: "MATCHED" }
  ],
  verification: [],
  pressure: [],
  interventions: [],
  capabilities: {
    readOnly: true,
    mutationMode: "forbidden",
    egress: "none",
    tokenRequired: true
  }
};

describe("@archcontext/explorer-ui", () => {
  test("renders a local read-only graph without external assets", () => {
    const html = renderExplorerHtml(projection);
    expect(html).toContain("ArchContext Explorer");
    expect(html).toContain("role=\"application\"");
    expect(html).toContain("Architecture graph");
    expect(html).toContain("Verification");
    expect(html).toContain("module.runtime");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("changesets/apply");
  });

  test("filters projections by node metadata while keeping matching relations", () => {
    const filtered = filterExplorerProjection(projection, "billing");
    expect(filtered.nodes.map((node) => node.id)).toEqual(["module.billing"]);
    expect(filtered.relations).toHaveLength(1);
    expect(filterExplorerProjection(projection, "missing").nodes).toEqual([]);
  });
});
