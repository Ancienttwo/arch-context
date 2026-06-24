#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "archctx-ledger-adapters-"));

try {
  const bundlePath = join(workspace, "local-store-sqlite.node.mjs");
  execFileSync("bun", [
    "build",
    "packages/local-runtime/local-store-sqlite/src/index.ts",
    "--target=node",
    "--format=esm",
    "--outfile",
    bundlePath
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

  const fixturePath = join(workspace, "adapter-fixture.mjs");
  writeFileSync(fixturePath, adapterFixtureSource(), "utf8");

  const bunStoreSource = pathToFileURL(join(root, "packages/local-runtime/local-store-sqlite/src/index.ts")).href;
  const bunReadback = runAdapter("bun", ["bun", fixturePath, bunStoreSource, join(workspace, "bun.sqlite"), "bun"]);
  const nodeReadback = runAdapter("node", [process.execPath, fixturePath, pathToFileURL(bundlePath).href, join(workspace, "node.sqlite"), "node"]);
  if (bunReadback.graphDigest !== nodeReadback.graphDigest) {
    throw new Error(`Adapter graph digest mismatch: bun=${bunReadback.graphDigest} node=${nodeReadback.graphDigest}`);
  }
  if (bunReadback.eventCount !== nodeReadback.eventCount || !bunReadback.verifyOk || !nodeReadback.verifyOk) {
    throw new Error(`Adapter replay verification failed: ${JSON.stringify({ bunReadback, nodeReadback })}`);
  }

  console.log(JSON.stringify({
    schemaVersion: "archcontext.architecture-ledger-sqlite-adapter-readback/v1",
    adapterDigestsMatch: true,
    adapters: [bunReadback, nodeReadback]
  }, null, 2));
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function runAdapter(adapter, commandLine) {
  const [command, ...args] = commandLine;
  const output = execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const parsed = JSON.parse(output);
  if (parsed.adapter !== adapter) throw new Error(`Unexpected adapter readback: expected=${adapter} actual=${parsed.adapter}`);
  return parsed;
}

function adapterFixtureSource() {
  return String.raw`
const moduleSpecifier = process.argv[2];
const databasePath = process.argv[3];
const adapter = process.argv[4];
const { SqliteLocalStore } = await import(moduleSpecifier);

const repository = {
  repositoryId: "repo.adapter-readback",
  storageRepositoryId: "repo.storage.adapter-readback"
};
const worktree = {
  workspaceId: "workspace.adapter-readback",
  storageWorkspaceId: "workspace.storage.adapter-readback",
  branch: "main",
  headSha: "abc123adapter",
  worktreeDigest: "sha256:adapter-worktree"
};
const scope = { repository, worktree };

const store = new SqliteLocalStore(databasePath);
try {
  await store.migrate();
  const events = [0, 1, 2].map((index) => ({
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: "adapter_event." + index,
    eventType: "architecture.graph.update",
    payloadVersion: "archcontext.architecture-ledger-payload/v1",
    repository,
    worktree,
    baseDigest: "sha256:base-" + index,
    resultingDigest: "sha256:result-" + index,
    headSha: worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "checkpoint",
    timestamp: "2026-06-25T01:00:0" + index + ".000Z",
    idempotencyKey: "adapter-readback-" + index,
    provenance: {
      producer: "architecture-ledger-sqlite-adapter-readback",
      command: "node scripts/architecture-ledger-sqlite-adapter-readback.mjs",
      inputDigest: "sha256:input-" + index
    },
    payload: {
      summary: "adapter event " + index,
      title: "Adapter Event " + index,
      rationale: "Exercise the same ledger replay fixture through SQLite adapters.",
      operations: [{
        op: "upsert_entity",
        entity: {
          entityId: "adapter.entity." + index,
          kind: "module",
          canonicalName: "adapter module " + index,
          status: "active",
          summary: "adapter module summary " + index
        }
      }]
    }
  }));
  const appended = await store.appendArchitectureEvents({ writer: "runtime-daemon", events });
  const duplicate = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [events[0]] });
  const replay = await store.replayArchitectureLedger(scope);
  const verify = await store.verifyArchitectureLedgerReplay(scope);
  const snapshot = await store.createArchitectureLedgerSnapshot({
    ...scope,
    sourceMode: "ledger-shadow",
    projectionDigest: "sha256:projection-adapter",
    inputDigests: { modelDigest: "sha256:model-adapter" },
    createdAt: "2026-06-25T01:01:00.000Z"
  });
  const integrity = await store.checkArchitectureLedgerIntegrity(scope);
  console.log(JSON.stringify({
    adapter,
    appended: appended.appendedEvents.length,
    duplicateRetries: duplicate.duplicateEvents.length,
    eventCount: replay.events.length,
    graphDigest: replay.graphDigest,
    snapshotDigest: snapshot.graphDigest,
    verifyOk: verify.ok,
    integrityOk: integrity.ok
  }));
} finally {
  store.close();
}
`;
}
