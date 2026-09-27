import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  inspectPracticeAssetsS6DocsOpsReadback,
  buildPracticeAssetsS6DocsOpsReadbackConfig,
  runPracticeAssetsS6DocsOpsReadback,
  verifiedPracticeAssetsS6DocsOpsFixture
} from "./practice-assets-s6-docs-ops-readback";

describe("practice-assets-s6-docs-ops-readback", () => {
  test("accepts a complete S6 docs ops packet", () => {
    expect(inspectPracticeAssetsS6DocsOpsReadback(verifiedPracticeAssetsS6DocsOpsFixture())).toEqual({
      ok: true,
      failures: []
    });
  });

  test("rejects incomplete docs and operations gates", () => {
    const packet: any = verifiedPracticeAssetsS6DocsOpsFixture();
    packet.evidence.documentation.repoPracticeHowTo = false;
    packet.evidence.independentDisable.context7FailureMatrixLeavesLocalCoreUnchanged = false;
    packet.evidence.centralHook.hookZeroNetwork = false;
    packet.evidence.operations.staleCatalogDetected = false;
    packet.evidence.assertions.documentationComplete = false;
    packet.evidence.assertions.independentDisableComplete = false;
    packet.evidence.assertions.centralHookComplete = false;
    packet.evidence.assertions.operationsComplete = false;

    const result = inspectPracticeAssetsS6DocsOpsReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("documentation.repoPracticeHowTo must be true");
    expect(result.failures).toContain("independentDisable.context7FailureMatrixLeavesLocalCoreUnchanged must be true");
    expect(result.failures).toContain("centralHook.hookZeroNetwork must be true");
    expect(result.failures).toContain("operations.staleCatalogDetected must be true");
    expect(result.failures).toContain("assertion documentationComplete must be true");
  });
});


// Exercise run -> source reads -> group assertions -> inspect, not only the all-true fixture.
async function withSourceFixture(check: (root: string) => Promise<void>) {
  const temporary = await mkdtemp(join(tmpdir(), "archctx-s6-docs-"));
  try {
    const config = buildPracticeAssetsS6DocsOpsReadbackConfig({}, [
      "--root", resolve(import.meta.dir, ".."),
      "--out", join(temporary, "source.json"), "--report", join(temporary, "source.md")
    ]);
    const source = await runPracticeAssetsS6DocsOpsReadback(config);
    const root = join(temporary, "repo");
    for (const [key, path] of Object.entries(source.sources)) {
      if (key === "reportPath") continue;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), await readFile(resolve(config.root, path)));
    }
    await check(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function runFixture(root: string) {
  return runPracticeAssetsS6DocsOpsReadback(buildPracticeAssetsS6DocsOpsReadbackConfig({}, ["--root", root]));
}

test("S6 run accepts the current harness boundary and product evidence link", async () => {
  await withSourceFixture(async (root) => {
    const packet = await runFixture(root);
    expect(packet.evidence.centralHook.hookReadmeCentralFirst).toBe(true);
    expect(packet.evidence.assertions.centralHookComplete).toBe(true);
    expect(packet.failures).toEqual([]);
    expect(inspectPracticeAssetsS6DocsOpsReadback(packet)).toEqual({ ok: true, failures: [] });
  });
});

for (const [path, witness] of [
  [".ai/hooks/README.md", "user-level"],
  [".ai/hooks/README.md", "repo-harness-hook"],
  [".ai/hooks/README.md", "operator helper libraries only"],
  [".ai/hooks/README.md", "no repo-local host-event dispatcher or route script is supported"],
  ["docs/runbooks/practice-assets-v1.md", "docs/verification/practice-hook-egress-readback.json"]
]) test(`S6 run rejects missing central-hook documentation: ${witness}`, async () => {
  await withSourceFixture(async (root) => {
    const target = join(root, path!);
    const text = await readFile(target, "utf8");
    expect(text).toContain(witness!);
    await writeFile(target, text.replaceAll(witness!, "REMOVED_DOCUMENTATION_WITNESS"));
    const packet = await runFixture(root);
    expect(packet.evidence.centralHook.hookReadmeCentralFirst).toBe(false);
    expect(packet.evidence.assertions.centralHookComplete).toBe(false);
    expect(packet.failures).toContain("centralHook.hookReadmeCentralFirst must be true");
    expect(packet.failures).toContain("assertion centralHookComplete must be true");
    expect(inspectPracticeAssetsS6DocsOpsReadback(packet).ok).toBe(false);
  });
});

test("S6 current adapter cannot be replaced by historical checkpoint evidence or all-true assertions", () => {
  const mutations = [
    (p: any) => { delete p.currentHookAdapter; },
    (p: any) => { delete p.evidence.centralHook; },
    (p: any) => { delete p.evidence.assertions.centralHookComplete; },
    (p: any) => { p.schemaVersion = "archcontext.practice-assets-s6-docs-ops-readback/v1"; },
    (p: any) => { p.currentHookAdapter.ok = false; },
    (p: any) => { p.currentHookAdapter.data.ownership = "repo"; },
    (p: any) => { p.currentHookAdapter.data.entrypoint.args = ["hook", "checkpoint"]; },
    (p: any) => { p.currentHookAdapter.data.entrypoint.args.push("--extra"); },
    (p: any) => { p.currentHookAdapter.data.entrypoint.network = "allowed"; },
    (p: any) => { p.currentHookAdapter.data.fallbackEntrypoint.network = "allowed"; }
  ];
  for (const mutate of mutations) {
    const packet: any = verifiedPracticeAssetsS6DocsOpsFixture();
    mutate(packet);
    expect(inspectPracticeAssetsS6DocsOpsReadback(packet).ok).toBe(false);
  }
});
