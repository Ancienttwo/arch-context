import { expect, test } from "bun:test";
import { NativeContextError } from "@archcontext/contracts";
import { exportNativeContext } from "../src/native-context";
import { CAPABILITY_ID, createNativeFixture, commitFixture, writeFixtureFile } from "./fixtures/native-context/fixture";

const path = "docs/adr/ADR-0001-first.md";
const adr = (id: string, appliesTo: string[], supersedes: string[] = []) => `---\nid: ${id}\ntitle: First decision\nstatus: accepted\ndecidedAt: 2026-10-26\nappliesTo: ${JSON.stringify(appliesTo)}\nsupersedes: ${JSON.stringify(supersedes)}\n---\n# Decision\n`;
test("native decisions share ref/worktree records and bind ADR bytes", () => {
  const fixture = createNativeFixture();
  try {
    const empty = exportNativeContext(fixture.root, { source: "worktree" });
    expect(empty.decisions).toEqual([]);
    writeFixtureFile(fixture.root, path, adr("adr.0001.first", [CAPABILITY_ID, "component.demo.worker"]));
    writeFixtureFile(fixture.root, "docs/adr/ADR-0002-second.md", adr("adr.0002.second", [], ["adr.0001.first"]));
    const ref = commitFixture(fixture.root);
    const fixed = exportNativeContext(fixture.root, { source: "ref", ref });
    const current = exportNativeContext(fixture.root, { source: "worktree" });
    expect(current.decisions).toEqual(fixed.decisions);
    expect(current.inputDigest).toBe(fixed.inputDigest);
    expect(current.decisions).toEqual([
      { id: "adr.0001.first", title: "First decision", status: "accepted", decidedAt: "2026-10-26", appliesTo: [CAPABILITY_ID, "component.demo.worker"], supersedes: [], path },
      { id: "adr.0002.second", title: "First decision", status: "accepted", decidedAt: "2026-10-26", appliesTo: [], supersedes: ["adr.0001.first"], path: "docs/adr/ADR-0002-second.md" }
    ]);
    writeFixtureFile(fixture.root, path, adr("adr.0001.first", [CAPABILITY_ID]) + "Changed body\n");
    expect(exportNativeContext(fixture.root, { source: "worktree" }).inputDigest).not.toBe(current.inputDigest);
    expect(exportNativeContext(fixture.root, { source: "ref", ref }).decisions).toEqual(fixed.decisions);
  } finally { fixture.cleanup(); }
});
test.each(["ref", "worktree"] as const)("native decisions reject unknown appliesTo from %s with path", source => {
  const fixture = createNativeFixture();
  try {
    writeFixtureFile(fixture.root, path, adr("adr.0001.first", ["module.unknown"]));
    const ref = commitFixture(fixture.root);
    try { exportNativeContext(fixture.root, { source, ref }); throw new Error("expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(NativeContextError);
      expect(error).toMatchObject({ reasonCode: "native-context-model-invalid", details: { path } });
    }
  } finally { fixture.cleanup(); }
});
test("ADR membership changes during capture fail closed", () => {
  const fixture = createNativeFixture();
  try {
    expect(() => exportNativeContext(fixture.root, { source: "worktree" }, { onBoundary(boundary) {
      if (boundary === "after-document-batch") writeFixtureFile(fixture.root, path, adr("adr.0001.first", []));
    } })).toThrow();
  } finally { fixture.cleanup(); }
});

test.each(["appliesTo: [module.unknown]", "appliesTo: module.unknown", "appliesTo: []\nappliesTo: []"])("shared ADR validation rejects %s", field => {
  const fixture = createNativeFixture();
  try {
    writeFixtureFile(fixture.root, path, `---\ntitle: Example\n${field}\n---\n`);
    expect(() => exportNativeContext(fixture.root, { source: "worktree" })).toThrow(NativeContextError);
  } finally { fixture.cleanup(); }
});
