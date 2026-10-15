import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestJson } from "@archcontext/contracts";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { SqliteLocalStore } from "../src/index";
test("startup retains manifest conflict and pending journal without overwriting external floor", async()=>{
 const root=mkdtempSync(join(tmpdir(),"archctx-recovery-floor-"));
 const manifest="docs/architecture/.projection-manifest.json", path=join(root,manifest), backupPath=path+".archctx-backup";
 const store=new SqliteLocalStore(join(root,"state.sqlite"));
 try {
  store.acquireWriterOwnership();await store.migrate();
  mkdirSync(dirname(path),{recursive:true});
  const body=JSON.stringify({schemaVersion:"archcontext.architecture-docs-projection-manifest/v3",minimumRendererVersion:"archcontext.docs-renderer/v6"});
  const external=JSON.stringify({schemaVersion:"archcontext.architecture-docs-projection-manifest/v3",minimumRendererVersion:"archcontext.docs-renderer/v7"});
  writeFileSync(path,external);writeFileSync(backupPath,"original bytes");
  const draft=new ChangeSetEngine().plan({id:"changeset.floor",base:{headSha:"a".repeat(40),worktreeDigest:`sha256:${"a".repeat(64)}`,modelDigest:`sha256:${"b".repeat(64)}`},reason:{taskSessionId:"task.floor"},operations:[]});
  const id=await store.beginChangeSet(root,draft);
  await store.recordChangeSetFile(id,{path:manifest,backupPath,existed:true,operation:"render_projection",bodyHash:digestJson({body})});
  expect(store.recoverPendingChangeSets()).toBe(0);
  expect(readFileSync(path,"utf8")).toBe(external);
  expect(readFileSync(backupPath,"utf8")).toBe("original bytes");
  expect(store.listUnresolvedChangeSetJournals()).toMatchObject([{journalId:id,changeSetId:draft.id,root,reason:expect.stringContaining("changeset-recovery-manifest-conflict")}]);
  // An operator may restore exactly the journal postimage, then existing recovery can safely retry.
  writeFileSync(path,body);
  expect(store.recoverPendingChangeSets()).toBe(1);
  expect(readFileSync(path,"utf8")).toBe("original bytes");
  expect(existsSync(backupPath)).toBe(false);
 } finally {store.close();rmSync(root,{recursive:true,force:true});}
});


test("startup preserves a concurrently changed newly-created manifest and restores pre-publication absence",async()=>{
 for(const existed of [false,true]) {
  const root=mkdtempSync(join(tmpdir(),"archctx-recovery-phase-"));const store=new SqliteLocalStore(join(root,"state.sqlite"));
  const relative="docs/architecture/.projection-manifest.json",path=join(root,relative),backupPath=path+".archctx-backup";
  try {
   store.acquireWriterOwnership();await store.migrate();mkdirSync(dirname(path),{recursive:true});
   const draft=new ChangeSetEngine().plan({id:"changeset.phase",base:{headSha:"a".repeat(40),worktreeDigest:`sha256:${"a".repeat(64)}`,modelDigest:`sha256:${"b".repeat(64)}`},reason:{taskSessionId:"task.phase"},operations:[]});
   const id=await store.beginChangeSet(root,draft);
   await store.recordChangeSetFile(id,{path:relative,backupPath,existed,operation:"render_projection",bodyHash:digestJson({body:"our published bytes"})});
   if(existed)writeFileSync(backupPath,"original before rename");else writeFileSync(path,"external v7 declaration");
   expect(store.recoverPendingChangeSets()).toBe(existed?1:0);
   expect(readFileSync(path,"utf8")).toBe(existed?"original before rename":"external v7 declaration");
   expect(store.listUnresolvedChangeSetJournals().length).toBe(existed?0:1);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
 }
});

type LegacyManifestFixture = {
  store: SqliteLocalStore;
  root: string;
  journalId: string;
  path: string;
  backups: string[];
  temps: string[];
  original: string;
  firstBody: string;
  finalBody: string;
  externalBody: string;
};

async function withLegacyDuplicateManifest(
  existedBefore: boolean,
  missingLaterBackup: boolean,
  run: (fixture: LegacyManifestFixture) => void
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "archctx-recovery-legacy-duplicate-"));
  const databasePath = join(root, "state.sqlite");
  const relative = "docs/architecture/.projection-manifest.json";
  const path = join(root, relative);
  const backups = [`${path}.archctx-backup-1`, `${path}.archctx-backup-2`];
  const temps = [`${path}.archctx-tmp-1`, `${path}.archctx-tmp-2`];
  const original = "original manifest before the ChangeSet\n";
  const firstBody = JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v3", minimumRendererVersion: "archcontext.docs-renderer/v5" });
  const finalBody = JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v3", minimumRendererVersion: "archcontext.docs-renderer/v6" });
  const externalBody = JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v3", minimumRendererVersion: "archcontext.docs-renderer/v7" });
  let first: SqliteLocalStore | undefined = new SqliteLocalStore(databasePath);
  let reopened: SqliteLocalStore | undefined;
  try {
    first.acquireWriterOwnership();
    await first.migrate();
    mkdirSync(dirname(path), { recursive: true });
    const draft = new ChangeSetEngine().plan({
      id: "changeset.legacy-duplicate-manifest",
      base: { headSha: "a".repeat(40), worktreeDigest: `sha256:${"a".repeat(64)}`, modelDigest: `sha256:${"b".repeat(64)}` },
      reason: { taskSessionId: "task.legacy-duplicate-manifest" }, operations: []
    });
    const journalId = await first.beginChangeSet(root, draft);
    // Persist the legacy order: write A, then replace A with B under an aliased spelling of
    // the same destination. Recovery must recognize B before reversing B -> A -> original.
    await first.recordChangeSetFile(journalId, {
      path: relative, backupPath: backups[0], tempPath: temps[0], existed: existedBefore,
      operation: "render_projection", bodyHash: digestJson({ body: firstBody })
    });
    await first.recordChangeSetFile(journalId, {
      path: "docs/architecture/./.projection-manifest.json", backupPath: backups[1], tempPath: temps[1], existed: true,
      operation: "render_projection", bodyHash: digestJson({ body: finalBody })
    });
    if (existedBefore) writeFileSync(backups[0]!, original);
    if (!missingLaterBackup) writeFileSync(backups[1]!, firstBody);
    for (const temp of temps) writeFileSync(temp, "unpublished temporary bytes");
    writeFileSync(path, finalBody);
    writeFileSync(join(root, "unrelated.txt"), "unrelated accepted content\n");
    first.close();
    first = undefined;

    reopened = new SqliteLocalStore(databasePath);
    reopened.acquireWriterOwnership();
    await reopened.migrate();
    expect(reopened.listUnresolvedChangeSetJournals()).toMatchObject([{ journalId, changeSetId: draft.id, root }]);
    run({ store: reopened, root, journalId, path, backups, temps, original, firstBody, finalBody, externalBody });
    expect(readFileSync(join(root, "unrelated.txt"), "utf8")).toBe("unrelated accepted content\n");
  } finally {
    reopened?.close();
    first?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test.each(["missing", "existing"] as const)("startup recovers persisted duplicate manifest final postimage (original: %s)", async (originalState) => {
  const existedBefore = originalState === "existing";
  await withLegacyDuplicateManifest(existedBefore, false, ({ store, path, backups, temps, original }) => {
    expect(store.recoverPendingChangeSets()).toBe(1);
    expect(store.listUnresolvedChangeSetJournals()).toEqual([]);
    expect(existsSync(path)).toBe(existedBefore);
    if (existedBefore) expect(readFileSync(path, "utf8")).toBe(original);
    for (const artifact of [...backups, ...temps]) expect(existsSync(artifact)).toBe(false);
    expect(store.recoverPendingChangeSets()).toBe(0);
  });
});

test.each(["missing", "existing"] as const)("startup preserves external bytes and every duplicate manifest rollback artifact (original: %s)", async (originalState) => {
  const existedBefore = originalState === "existing";
  await withLegacyDuplicateManifest(existedBefore, false, ({ store, journalId, path, backups, temps, original, firstBody, finalBody, externalBody }) => {
    writeFileSync(path, externalBody);
    expect(store.recoverPendingChangeSets()).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(externalBody);
    if (existedBefore) expect(readFileSync(backups[0]!, "utf8")).toBe(original);
    expect(readFileSync(backups[1]!, "utf8")).toBe(firstBody);
    for (const temp of temps) expect(readFileSync(temp, "utf8")).toBe("unpublished temporary bytes");
    expect(store.listUnresolvedChangeSetJournals()).toMatchObject([{ journalId, reason: expect.stringContaining("changeset-recovery-manifest-conflict") }]);
    writeFileSync(path, finalBody);
    expect(store.recoverPendingChangeSets()).toBe(1);
    expect(store.listUnresolvedChangeSetJournals()).toEqual([]);
    expect(existsSync(path)).toBe(existedBefore);
    if (existedBefore) expect(readFileSync(path, "utf8")).toBe(original);
  });
});

test("startup guards a duplicate manifest final postimage when its later backup is missing", async () => {
  await withLegacyDuplicateManifest(false, true, ({ store, path, temps, finalBody, externalBody }) => {
    writeFileSync(path, externalBody);
    expect(store.recoverPendingChangeSets()).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(externalBody);
    for (const temp of temps) expect(existsSync(temp)).toBe(true);
    writeFileSync(path, finalBody);
    expect(store.recoverPendingChangeSets()).toBe(1);
    expect(store.listUnresolvedChangeSetJournals()).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });
});

test.each(["missing", "existing"] as const)("startup unwinds a persisted duplicate manifest whose final entry is intent-only (original: %s)", async (originalState) => {
  const existedBefore = originalState === "existing";
  await withLegacyDuplicateManifest(existedBefore, true, ({ store, path, firstBody, original, externalBody, backups, temps }) => {
    writeFileSync(path, externalBody);
    expect(store.recoverPendingChangeSets()).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(externalBody);
    if (existedBefore) expect(readFileSync(backups[0]!, "utf8")).toBe(original);
    for (const temp of temps) expect(existsSync(temp)).toBe(true);
    // The second intent is durable, but its A -> backup / B -> destination mutation never began.
    writeFileSync(path, firstBody);
    expect(store.recoverPendingChangeSets()).toBe(1);
    expect(store.listUnresolvedChangeSetJournals()).toEqual([]);
    expect(existsSync(path)).toBe(existedBefore);
    if (existedBefore) expect(readFileSync(path, "utf8")).toBe(original);
  });
});
