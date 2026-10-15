import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH as MANIFEST, digestJson } from "@archcontext/contracts";
import { initializeArchContextModel, planGeneratedProjection, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { ChangeSetEngine, type ChangeSetJournalPort } from "../src/index";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-floor-writer-"));
  initializeArchContextModel(root, "Floor writer");
  mkdirSync(dirname(join(root, MANIFEST)), { recursive: true });
  const writeManifest = (extra = {}) => writeFileSync(join(root, MANIFEST), JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v3", ...extra }));
  return { root, writeManifest, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const digest = `sha256:${"a".repeat(64)}`;
function draft(engine: ChangeSetEngine, operations: Parameters<ChangeSetEngine["plan"]>[0]["operations"]) {
  return engine.plan({ id: "changeset.floor", base: { headSha: "a".repeat(40), worktreeDigest: digest, modelDigest: digest }, reason: { taskSessionId: "task.floor" }, operations });
}

test("pre-rendered projection files and implicit rebuild refuse floors before journal or business writes", async () => {
  for (const implicit of [false, true]) {
    const f = fixture();
    let begins = 0, rebuilds = 0;
    const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection(root) { rebuilds++; return planGeneratedProjection(root); } }, journal: { async beginChangeSet() { begins++; return "journal.floor"; }, async recordChangeSetFile() {}, async commitChangeSet() {}, async completeChangeSetCleanup() {}, async abortChangeSet() {}, recoverPendingChangeSets() { return 0; } } });
    try {
      f.writeManifest();
      const output = implicit ? ".archcontext/waivers/floor.json" : "docs/architecture/floor.md";
      const operations = implicit
        ? [{ op: "write_waiver" as const, path: output, expectedHash: "missing", body: "{}\n" }]
        : [{ op: "render_projection" as const, expectedHash: "missing", projectionFiles: [{ path: output, expectedHash: "missing", body: "future output\n" }] }];
      const planned = draft(engine, operations);
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v7" });
      await expect(engine.apply(f.root, planned, { approved: true })).rejects.toThrow("Projection manifest incompatible.");
      expect(existsSync(join(f.root, output))).toBe(false);
      expect(begins).toBe(0);
      expect(rebuilds).toBe(0);
    } finally { f.cleanup(); }
  }
});

test("the actual write rechecks a floor raised during asynchronous journaling", async () => {
  const f = fixture();
  const path = "docs/architecture/floor.md";
  const body = "original\n";
  let recorded = 0;
  const journal: ChangeSetJournalPort = {
    async beginChangeSet() { return "journal.floor"; },
    async recordChangeSetFile() { recorded++; f.writeManifest({ minimumProtocolVersion: "archcontext.projection-request/v2" }); },
    async commitChangeSet() {}, async completeChangeSetCleanup() {}, async abortChangeSet() {}, recoverPendingChangeSets() { return 0; }
  };
  try {
    f.writeManifest();
    writeFileSync(join(f.root, path), body);
    const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection }, journal });
    const planned = draft(engine, [{ op: "render_projection", expectedHash: "missing", projectionFiles: [{ path, expectedHash: digestJson({ body }), body: "new\n" }] }]);
    await expect(engine.apply(f.root, planned, { approved: true })).rejects.toThrow("Projection manifest incompatible.");
    expect(recorded).toBe(1);
    expect(readFileSync(join(f.root, path), "utf8")).toBe(body);
    expect(existsSync(join(f.root, path) + ".archctx-backup")).toBe(false);
  } finally { f.cleanup(); }
});

test("a supplied manifest cannot erase compatible floors or publish a future format", async () => {
  for (const future of [false, true]) for (const path of [MANIFEST, "docs/architecture/./.projection-manifest.json", "docs/architecture//.projection-manifest.json", "docs/architecture/.PROJECTION-MANIFEST.JSON"]) {
    const f = fixture();
    try {
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v6" });
      const before = readFileSync(join(f.root, MANIFEST), "utf8");
      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection } });
      const body = JSON.stringify({ schemaVersion: future ? "archcontext.architecture-docs-projection-manifest/v4" : "archcontext.architecture-docs-projection-manifest/v3" });
      const planned = draft(engine, [{ op: "render_projection", expectedHash: "missing", projectionFiles: [{ path, expectedHash: digestJson({ body: before }), body }] }]);
      await expect(engine.apply(f.root, planned, { approved: true })).rejects.toThrow("Projection manifest incompatible.");
      expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(before);
    } finally { f.cleanup(); }
  }
});


test("implicit generated manifests use the same normalized destination guard", async () => {
  for (const path of ["docs/architecture/./.projection-manifest.json", "docs/architecture//.projection-manifest.json"]) {
    const f = fixture();
    try {
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v6" });
      const before = readFileSync(join(f.root, MANIFEST), "utf8");
      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection() { return [{ path, expectedHash: digestJson({ body: before }), body: JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v4" }), operation: "render_projection" as const }]; } } });
      await expect(engine.apply(f.root, draft(engine, []), { approved: true })).rejects.toThrow("Projection manifest incompatible.");
      expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(before);
    } finally { f.cleanup(); }
  }
});

test("a floor raised after another journal append survives refusal with manifest-first input", async () => {
  for (const layout of ["one", "many", "implicit", "ordinary"]) {
    const f = fixture();
    const records: string[] = [];
    let raised = "", commits = 0;
    const journal: ChangeSetJournalPort = {
      async beginChangeSet() { return "journal.floor"; },
      async recordChangeSetFile(_id, file) {
        records.push(file.path);
        if (records.length === 2) {
          raised = JSON.stringify({ ...JSON.parse(readFileSync(join(f.root, MANIFEST), "utf8")), minimumRendererVersion: "archcontext.docs-renderer/v7" });
          writeFileSync(join(f.root, MANIFEST), raised);
        }
      },
      async commitChangeSet() { commits++; }, async completeChangeSetCleanup() {}, async abortChangeSet() {}, recoverPendingChangeSets() { return 0; }
    };
    try {
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v6" });
      const before = readFileSync(join(f.root, MANIFEST), "utf8");
      const manifest = { path: MANIFEST, expectedHash: digestJson({ body: before }), body: JSON.stringify({ ...JSON.parse(before), rendererVersion: "archcontext.docs-renderer/v6" }) };
      const docs = ["one", "two"].map(name => ({ path: `docs/architecture/${name}.md`, expectedHash: "missing", body: name + "\n" }));
      const files = [manifest, ...docs];
      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection() { return layout === "implicit" ? files.map(file => ({ ...file, operation: "render_projection" as const })) : []; } }, journal });
      const operations = layout === "implicit" ? [] : layout === "many"
        ? [{ op: "render_projection" as const, expectedHash: "missing", projectionFiles: [manifest] }, { op: "render_projection" as const, expectedHash: "missing", projectionFiles: docs }]
        : layout === "ordinary"
          ? [{ op: "write_policy" as const, ...manifest }, { op: "render_projection" as const, expectedHash: "missing", projectionFiles: docs }]
          : [{ op: "render_projection" as const, expectedHash: "missing", projectionFiles: files }];
      await expect(engine.apply(f.root, draft(engine, operations), { approved: true })).rejects.toThrow("Projection manifest incompatible.");
      expect(raised).not.toBe("");
      expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(raised);
      expect(commits).toBe(0);
      for (const doc of docs) expect(existsSync(join(f.root, doc.path))).toBe(false);
    } finally { f.cleanup(); }
  }
});

test("manifest deferral retains actual journal sequence and fault operation counting", async () => {
  for (const faultAfterOperations of [undefined, 2]) {
    const f = fixture();
    const records: Array<{ path: string; tempPath?: string }> = [];
    const journal: ChangeSetJournalPort = {
      async beginChangeSet() { return "journal.floor"; }, async recordChangeSetFile(_id, file) { records.push(file); },
      async commitChangeSet() {}, async completeChangeSetCleanup() {}, async abortChangeSet() {}, recoverPendingChangeSets() { return 0; }
    };
    try {
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v6" });
      const before = readFileSync(join(f.root, MANIFEST), "utf8");
      const manifest = { path: MANIFEST, expectedHash: digestJson({ body: before }), body: JSON.stringify({ ...JSON.parse(before), rendererVersion: "archcontext.docs-renderer/v6" }) };
      const docs = ["one", "two"].map(name => ({ path: `docs/architecture/${name}.md`, expectedHash: "missing", body: name + "\n" }));
      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection }, journal });
      const planned = draft(engine, [{ op: "render_projection", expectedHash: "missing", projectionFiles: [manifest] }, { op: "render_projection", expectedHash: "missing", projectionFiles: docs }]);
      if (faultAfterOperations) {
        await expect(engine.apply(f.root, planned, { approved: true, faultAfterOperations })).rejects.toThrow("fault-injection");
        expect(records.map(file => file.path)).toEqual(docs.map(file => file.path));
        expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(before);
      } else {
        expect((await engine.apply(f.root, planned, { approved: true })).status).toBe("applied");
        expect(records.map(file => file.path)).toEqual([...docs.map(file => file.path), MANIFEST]);
      }
      for (const [index, file] of records.entries()) expect(file.tempPath).toEndWith(`-${index + 1}`);
    } finally { f.cleanup(); }
  }
});


test("post-manifest awaits preserve external floors and report incomplete rollback", async () => {
  for (const stage of ["validation-invalid", "validation-throw", "callback-throw", "journal-throw"]) {
    const f = fixture();
    let validations = 0, raised = "", aborted = 0, committed = 0;
    const raise = () => {
      raised = JSON.stringify({ ...JSON.parse(readFileSync(join(f.root, MANIFEST), "utf8")), minimumRendererVersion: "archcontext.docs-renderer/v7" });
      writeFileSync(join(f.root, MANIFEST), raised);
    };
    const model = new YamlModelStore();
    const journal: ChangeSetJournalPort = {
      async beginChangeSet() { return "journal.floor"; }, async recordChangeSetFile() {},
      async commitChangeSet() { if (stage === "journal-throw") { raise(); throw new Error("commit failed"); } committed++; },
      async completeChangeSetCleanup() {}, async abortChangeSet() { aborted++; }, recoverPendingChangeSets() { return 0; }
    };
    try {
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v6" });
      const before = readFileSync(join(f.root, MANIFEST), "utf8");
      const engine = new ChangeSetEngine({ modelStore: { ...model, validateModel: async (input: Parameters<YamlModelStore["validateModel"]>[0]) => {
        validations++;
        if (validations === 2 && stage.startsWith("validation")) {
          raise();
          if (stage === "validation-throw") throw new Error("validation failed");
          return { valid: false, errors: ["invalid after apply"], warnings: [] };
        }
        return model.validateModel(input);
      } } as any, projection: { planGeneratedProjection }, journal });
      const file = "docs/architecture/later.md";
      const planned = draft(engine, [{ op: "render_projection", expectedHash: "missing", projectionFiles: [
        { path: MANIFEST, expectedHash: digestJson({ body: before }), body: JSON.stringify({ ...JSON.parse(before), rendererVersion: "archcontext.docs-renderer/v6" }) },
        { path: file, expectedHash: "missing", body: "new doc\n" }
      ] }]);
      const failure = await engine.apply(f.root, planned, { approved: true, afterModelValidatedBeforeCommit: async () => {
        if (stage === "callback-throw") { raise(); throw new Error("callback failed"); }
      } }).then(() => undefined, error => error);
      expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(raised);
      expect(failure?.reasonCode).toBe("changeset-rollback-conflict");
      expect(failure?.details).toMatchObject({ journalId: "journal.floor", changeSetId: planned.id, manualRecoveryRequired: true });
      expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(raised);
      expect(readFileSync(join(f.root, MANIFEST) + ".archctx-backup", "utf8")).toBe(before);
      expect(existsSync(join(f.root, file))).toBe(false);
      expect(aborted).toBe(0);
      expect(committed).toBe(0);
    } finally { f.cleanup(); }
  }
});

test("post-manifest ordinary validation and commit failures still roll back completely", async () => {
  for (const stage of ["validation-invalid", "validation-throw", "callback-throw", "journal-throw"]) {
    const f = fixture();
    let validations = 0, aborted = 0;
    const model = new YamlModelStore();
    try {
      f.writeManifest({ minimumRendererVersion: "archcontext.docs-renderer/v6" });
      const before = readFileSync(join(f.root, MANIFEST), "utf8");
      const engine = new ChangeSetEngine({ modelStore: { validateModel: async (input: Parameters<YamlModelStore["validateModel"]>[0]) => {
        validations++;
        if (validations === 2 && stage.startsWith("validation")) {
          if (stage === "validation-throw") throw new Error("validation failed");
          return { valid: false, errors: ["invalid after apply"], warnings: [] };
        }
        return model.validateModel(input);
      } } as any, projection: { planGeneratedProjection }, journal: {
        async beginChangeSet() { return "journal.floor"; }, async recordChangeSetFile() {},
        async commitChangeSet() { if (stage === "journal-throw") throw new Error("commit failed"); },
        async completeChangeSetCleanup() {}, async abortChangeSet() { aborted++; }, recoverPendingChangeSets() { return 0; }
      } });
      const planned = draft(engine, [{ op: "render_projection", expectedHash: "missing", projectionFiles: [
        { path: MANIFEST, expectedHash: digestJson({ body: before }), body: JSON.stringify({ ...JSON.parse(before), rendererVersion: "archcontext.docs-renderer/v6" }) },
        { path: "docs/architecture/later.md", expectedHash: "missing", body: "new doc\n" }
      ] }]);
      await expect(engine.apply(f.root, planned, { approved: true, afterModelValidatedBeforeCommit: async () => {
        if (stage === "callback-throw") throw new Error("callback failed");
      } })).rejects.toThrow();
      expect(readFileSync(join(f.root, MANIFEST), "utf8")).toBe(before);
      expect(existsSync(join(f.root, MANIFEST) + ".archctx-backup")).toBe(false);
      expect(existsSync(join(f.root, "docs/architecture/later.md"))).toBe(false);
      expect(aborted).toBe(1);
    } finally { f.cleanup(); }
  }
});


test("a failed manifest publication still restores its complete original backup", async()=>{
 const f=fixture();let aborted=0;
 try {
  f.writeManifest({minimumRendererVersion:"archcontext.docs-renderer/v6"});
  const before=readFileSync(join(f.root,MANIFEST),"utf8");
  const engine=new ChangeSetEngine({modelStore:new YamlModelStore(),projection:{planGeneratedProjection},journal:{
   async beginChangeSet(){return "journal.floor";},async recordChangeSetFile(_id,file){if(file.path===MANIFEST)mkdirSync(file.tempPath!);},
   async commitChangeSet(){},async completeChangeSetCleanup(){},async abortChangeSet(){aborted++;},recoverPendingChangeSets(){return 0;}
  }});
  await expect(engine.apply(f.root,draft(engine,[{op:"render_projection",expectedHash:"missing",projectionFiles:[{path:MANIFEST,expectedHash:digestJson({body:before}),body:JSON.stringify({...JSON.parse(before),rendererVersion:"archcontext.docs-renderer/v6"})}]}]),{approved:true})).rejects.toThrow();
  expect(readFileSync(join(f.root,MANIFEST),"utf8")).toBe(before);
  expect(existsSync(join(f.root,MANIFEST)+".archctx-backup")).toBe(false);
  expect(aborted).toBe(1);
 } finally {f.cleanup();}
});
