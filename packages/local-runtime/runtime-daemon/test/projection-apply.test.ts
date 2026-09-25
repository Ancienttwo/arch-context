import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createStartedDaemon } from "../src/index";
import { createInitializedGitRepo as createFixture } from "./runtime-test-fixtures";

function stateRoot(root: string): string {
  return join(dirname(root), `.archctx-state-${basename(root)}`);
}

function snapshotCount(root: string): number {
  const db = new Database(join(stateRoot(root), "local-store.sqlite"), { readonly: true });
  try {
    return (db.query("SELECT COUNT(*) AS count FROM snapshots").get() as { count: number }).count;
  } finally {
    db.close();
  }
}

test("prior projection journal reads do not create workspace snapshots or sessions", async () => {
  const root = createFixture();
  const daemon = await createStartedDaemon({ localStorePath: join(stateRoot(root), "local-store.sqlite") });
  try {
    mkdirSync(join(root, ".ai/harness/evidence"), { recursive: true });
    writeFileSync(join(root, ".ai/harness/evidence/runtime.jsonl"), "runtime evidence is not an input to a journal read\n");
    const before = snapshotCount(root);
    expect(daemon.status().sessions).toBe(0);
    expect(await daemon.listProjectionPriorCommittedApplies(root, "uncommitted-request"))
      .toMatchObject({ ok: true, data: { applies: [] } });
    expect(snapshotCount(root)).toBe(before);
    expect(daemon.status().sessions).toBe(0);
  } finally {
    await daemon.stop();
    rmSync(stateRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
