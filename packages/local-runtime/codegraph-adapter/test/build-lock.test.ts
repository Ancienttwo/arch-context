import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryCodeFacts } from "../src/index";
import { fakeReadProvider } from "./read-provider-fixture";

/**
 * A CodeGraph build holds `.codegraph/codegraph.lock` for its whole run, and the index is then
 * mid-build (#426). These tests pin that the readiness probe does not open the index while the
 * lock names a live process, and that it does once the lock is stale or malformed.
 */
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-codegraph-build-lock-")));
  const provider = fakeReadProvider(root);
  const lock = (value: string) => writeFileSync(join(root, ".codegraph", "codegraph.lock"), value);
  return { root, provider, lock, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function deadPid(): number {
  return spawnSync(process.execPath, ["-e", "0"]).pid ?? 0;
}

test("a live provider build lock keeps the index closed", () => {
  const input = fixture();
  try {
    input.lock(String(process.pid));
    const facts = inspectRepositoryCodeFacts(input.root, { provider: input.provider });
    expect(facts).toMatchObject({
      state: "not-ready",
      indexPresent: true,
      indexBuiltWithVersion: null,
      indexState: null,
      reindexRecommended: null,
      pendingRefs: null,
      pendingChanges: null
    });
    expect("issues" in facts ? facts.issues.map(issue => issue.code) : []).toEqual(["index-incomplete"]);
    expect(input.provider.calls.open).toBe(0);
  } finally { input.cleanup(); }
});

test("a stale provider build lock does not keep the index closed", () => {
  const input = fixture();
  try {
    input.lock(String(deadPid()));
    expect(inspectRepositoryCodeFacts(input.root, { provider: input.provider })).toMatchObject({ state: "ready", indexState: "complete", pendingRefs: 0 });
    expect(input.provider.calls).toMatchObject({ open: 1, close: 1 });
  } finally { input.cleanup(); }
});

test("a malformed provider build lock does not keep the index closed", () => {
  const input = fixture();
  try {
    input.lock("not-a-pid");
    expect(inspectRepositoryCodeFacts(input.root, { provider: input.provider })).toMatchObject({ state: "ready" });
    expect(input.provider.calls).toMatchObject({ open: 1, close: 1 });
  } finally { input.cleanup(); }
});
