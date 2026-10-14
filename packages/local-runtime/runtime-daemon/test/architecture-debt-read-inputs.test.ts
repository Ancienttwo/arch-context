import { expect, spyOn, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import * as projection from "@archcontext/core/projection-engine";
import * as gitAdapter from "@archcontext/local-runtime/git-adapter";
import { architectureDebtReportIssues } from "@archcontext/contracts";
import { readArchitectureDebt } from "../src/architecture-debt";
import { bytes, seed, states } from "./fixtures/architecture-debt-read-inputs/fixture";

test("one debt invocation discovers model and Git files once for ownership and anchors", () => {
  const { root } = seed(); const before = bytes(root);
  const model = spyOn(projection, "loadNativeModelFromArchContext");
  const files = spyOn(gitAdapter, "listGitVisibleFiles");
  try {
    const report = readArchitectureDebt(root, { changedPaths: ["src/a/main.ts"] });
    expect(architectureDebtReportIssues(report)).toEqual([]);
    expect(bytes(root)).toBe(before);
    expect({ modelLoads: model.mock.calls.length, gitDiscoveries: files.mock.calls.length })
      .toEqual({ modelLoads: 1, gitDiscoveries: 1 });
  } finally { model.mockRestore(); files.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});

test("per-call reuse preserves whole report, digest and coverage and sees subsequent input repairs", () => {
  const { root, document } = seed();
  try {
    const expected = JSON.parse(readFileSync(new URL("./fixtures/architecture-debt-read-inputs/baseline.json", import.meta.url), "utf8"));
    const observed = states(root, document);
    expect(observed).toEqual(expected.reports);
    for (const row of observed) expect(architectureDebtReportIssues(row.report)).toEqual([]);
    expect(observed.find(row => row.label === "added-unowned-file")!.report.items.some(item => item.kind === "unowned-path")).toBe(true);
    expect(observed.find(row => row.label === "deleted-cited-file")!.report.items.some(item => item.reasonCode === "missing-path")).toBe(true);
    expect(observed.find(row => row.label === "repaired-citation")!.report.items).toEqual([]);
    expect(observed.find(row => row.label === "model-prose-change")!.report.items.some(item => item.kind === "stale-anchor")).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

