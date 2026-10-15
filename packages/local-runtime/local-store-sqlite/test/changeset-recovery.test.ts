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
