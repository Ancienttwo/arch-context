import { rmSync, tempRepo, removeTempRepo, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExplorerProjectionV2, type JsonEnvelope } from "@archcontext/contracts";
import { SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { ArchctxDaemon } from "../src/index";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-explorer-server-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("daemon Explorer server", () => {
  test("Explorer loopback service is token-gated, read-only, caches manifests in kv_cache, and revokes cleanly", async () => {
    const root = tempRepo();
    try {
      const localStore = new TestLocalStore(() => "2026-06-20T00:00:00.000Z");
      const daemon = await createStartedTestDaemon({ localStore, clock: () => "2026-06-20T00:00:00.000Z" });
      await daemon.init(root, "Explorer App");
      await daemon.prepare(root, "change the Explorer runtime boundary", 12_288, 12, "task.explorer-current");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      expect(started.ok).toBe(true);
      const data = started.data as any;
      expect(data.host).toBe("127.0.0.1");
      expect(data.readOnly).toBe(true);

      expect((await fetch(`${data.url}health`)).status).toBe(401);
      for (const headers of [{ Host: "attacker.example" }, { Origin: "https://attacker.example" }, { Origin: "null" }] as Record<string, string>[]) {
        expect((await fetch(`${data.url}health`, { headers: { ...headers, Authorization: `Bearer ${data.token}` } })).status).toBe(403);
      }
      expect((await fetch(`${data.url}health`, { headers: { Authorization: `Bearer ${data.token}`, Origin: new URL(data.url).origin } })).status).toBe(200);

      const projectionDenied = await fetch(`${data.url}projection`);
      expect(projectionDenied.status).toBe(401);

      const projectionWrite = await fetch(`${data.url}projection`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionWrite.status).toBe(405);

      const projection = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projection.status).toBe(404);

      const projectionV2 = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionV2.status).toBe(200);
      const bodyV2 = await projectionV2.json() as any;
      expect(bodyV2.data.schemaVersion).toBe("archcontext.explorer-projection/v2");
      expect(bodyV2.data.view.id).toBe("system-map");
      expect(bodyV2.data.availableViews.map((view: any) => view.id)).toEqual(["system-map", "task-impact", "drift-pressure", "data-flow", "external-integrations"]);
      expect(bodyV2.data.occurrences.length).toBeLessThanOrEqual(5);
      expect(bodyV2.data.page.budget).toEqual({ maxNodes: 5, maxRelations: 5 });
      expect(JSON.stringify(bodyV2.data)).not.toContain("sourceBody");
      expect(bodyV2.data.capabilities).toMatchObject({ readOnly: true, mutationMode: "forbidden", egress: "none" });

      const repeatedProjectionV2 = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(repeatedProjectionV2.status).toBe(200);
      expect(((await repeatedProjectionV2.json()) as any).data.projectionDigest).toBe(bodyV2.data.projectionDigest);
      const manifestEntries = await localStore.listCacheEntries("explorer_projection_manifest");
      expect(manifestEntries.length).toBeGreaterThanOrEqual(1);

      for (const view of ["data-flow", "external-integrations"] as const) {
        const typedView = await fetch(`${data.url}projection/v2?view=${view}&maxNodes=5&maxRelations=5`, {
          headers: { Authorization: `Bearer ${data.token}` }
        });
        expect(typedView.status).toBe(200);
        const typedBody = await typedView.json() as any;
        expect(typedBody.data.view.id).toBe(view);
        expect(typedBody.data.page.returnedNodes).toBeLessThanOrEqual(5);
        expect(typedBody.data.page.returnedRelations).toBeLessThanOrEqual(5);
      }

      const taskImpact = await fetch(`${data.url}projection/v2?view=task-impact&taskSessionId=task.explorer-current&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(taskImpact.status).toBe(200);
      expect(((await taskImpact.json()) as any).data.view.id).toBe("task-impact");
      writeFileSync(join(root, "TASK-SESSION-STALE.md"), "stale task cursor\n", "utf8");
      const staleTask = await fetch(`${data.url}projection/v2?view=task-impact&taskSessionId=task.explorer-current`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(staleTask.status).toBe(409);
      const systemMapWithStaleTaskHint = await fetch(`${data.url}projection/v2?view=system-map&taskSessionId=task.explorer-current`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(systemMapWithStaleTaskHint.status).toBe(200);
      const missingTask = await fetch(`${data.url}projection/v2?view=task-impact&taskSessionId=task.missing`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(missingTask.status).toBe(409);

      const driftPressure = await fetch(`${data.url}projection/v2?view=drift-pressure&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(driftPressure.status).toBe(200);
      expect(((await driftPressure.json()) as any).data.view.id).toBe("drift-pressure");

      const deniedBudget = await fetch(`${data.url}projection/v2?maxNodes=1001&maxRelations=5001`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(deniedBudget.status).toBe(400);

      const malformedDelta = await daemon.explorerProjectionDelta(root, {} as any);
      expect(malformedDelta.ok).toBe(false);
      expect((malformedDelta.error as any).reasonCode).toBe("invalid-delta-query");

      const sseAbort = new AbortController();
      const sse = await fetch(`${data.url}events`, { headers: { Authorization: `Bearer ${data.token}` }, signal: sseAbort.signal });
      expect(sse.status).toBe(200);
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      const reader = sse.body!.getReader();
      await reader.read();
      await fetch(`${data.url}projection/v2?level=overview&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      const projectionInvalidationChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Explorer projection invalidation timeout")), 2_000))
      ]);
      const projectionInvalidationText = new TextDecoder().decode(projectionInvalidationChunk.value);
      expect(projectionInvalidationText).toContain("projection-invalidated");
      expect(projectionInvalidationText).toContain("viewDefinitionDigest");
      expect(projectionInvalidationText).toContain("projectionDigest");
      expect(projectionInvalidationText).not.toContain("sourceBody");
      sseAbort.abort();

      const staleV2 = await fetch(`${data.url}projection/v2?expectedHeadSha=${"f".repeat(40)}&expectedWorktreeDigest=${encodeURIComponent(bodyV2.data.cursor.worktree.worktreeDigest)}&expectedGraphDigest=${encodeURIComponent(bodyV2.data.cursor.graphDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(staleV2.status).toBe(409);
      expect(((await staleV2.json()) as any).error.code).toBe("AC_PRECONDITION_FAILED");

      const html = await fetch(data.url, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toContain("text/html");
      expect(html.headers.get("content-security-policy")).toBe("default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      const htmlBody = await html.text();
      expect(htmlBody).toContain("ArchContext Explorer");
      expect(htmlBody).toContain("Data Flow");
      expect(htmlBody).toContain("External Integrations");
      expect(htmlBody).toContain("read-only · local · no egress");
      expect(htmlBody).not.toContain("https://");

      await daemon.revokeExplorerToken();
      const revoked = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(revoked.status).toBe(401);
      await daemon.stopExplorer();
      expect((daemon.explorerStatus().data as any).running).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("Explorer compares projections across a YAML model change via SQLite cache", async () => {
    const root = tempRepo();
    const stateDir = mkdtempSync(join(RUNTIME_TEST_STATE_ROOT, "delta-"));
    let now = "2026-06-20T00:00:00.000Z";
    const clock = () => now;
    const localStore = new SqliteLocalStore(join(stateDir, "runtime.sqlite"));
    let daemon: ArchctxDaemon | undefined;
    try {
      daemon = await createStartedTestDaemon({ localStore, clock });
      await daemon.init(root, "Explorer Graph Delta App");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      expect(started.ok).toBe(true);
      const { url, token } = started.data as { url: string; token: string };
      const headers = { Authorization: `Bearer ${token}` };
      const readProjection = async () => {
        const response = await fetch(`${url}projection/v2?maxNodes=20&maxRelations=20`, { headers });
        expect(response.status).toBe(200);
        return (await response.json() as { data: ExplorerProjectionV2 }).data;
      };

      const base = await readProjection();
      expect(base.occurrences.length).toBeGreaterThan(0);

      now = "2026-06-20T00:00:01.000Z";
      const entityId = "module.delta-head";
      const path = `.archcontext/model/nodes/${entityId}.yaml`;
      const body = `schemaVersion: archcontext.node/v2
id: ${entityId}
kind: module
name: New module
status: active
summary: Add an Explorer module
`;
      writeFileSync(join(root, path), body, "utf8");

      const head = await readProjection();
      expect(head.projectionDigest).not.toBe(base.projectionDigest);

      const params = new URLSearchParams({
        baseEventId: "git.base",
        headEventId: "git.head",
        baseProjectionDigest: base.projectionDigest,
        headProjectionDigest: head.projectionDigest
      });
      const delta = await fetch(`${url}delta?${params}`, { headers });
      expect(delta.status).toBe(200);
      expect(await delta.json()).toMatchObject({
        ok: true,
        data: {
          base: { eventId: "git.base", projectionDigest: base.projectionDigest },
          head: { eventId: "git.head", projectionDigest: head.projectionDigest },
          factChanges: [{ subjectId: `entity:${entityId}`, change: "added" }]
        }
      });
    } finally {
      await daemon?.stop();
      localStore.close();
      removeTempRepo(root);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("Explorer token expiry fails closed for HTML and SSE without ambient authentication", async () => {
    const root = tempRepo();
    let now = "2026-06-20T00:00:00.000Z";
    let daemon: ArchctxDaemon | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let expireSession: (() => void) | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => now });
      await daemon.init(root, "Explorer Token Expiry App");
      const realSetTimeout = globalThis.setTimeout;
      // Drive the expiry callback with the injected clock; real socket setup may exceed 250ms.
      const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
        if (delay !== 250) return realSetTimeout(callback, delay, ...args);
        expiryTimer = realSetTimeout(() => {}, 60_000);
        expiryTimer.unref();
        expireSession = () => {
          clearTimeout(expiryTimer);
          callback(...args);
        };
        return expiryTimer;
      }) as typeof setTimeout);
      let started: JsonEnvelope;
      try {
        started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 0.25 });
      } finally {
        schedule.mockRestore();
      }
      expect(expireSession).toBeDefined();
      const data = started.data as any;
      const beforeExpiry = await fetch(data.url, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(beforeExpiry.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const connectedSse = await fetch(`${data.url}events`, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(connectedSse.status).toBe(200);
      const connectedReader = connectedSse.body!.getReader();
      expect((await connectedReader.read()).done).toBe(false);
      now = "2026-06-20T00:00:02.000Z";
      const expiredHtml = await fetch(data.url, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(expiredHtml.status).toBe(401);
      const expiredSse = await fetch(`${data.url}events`, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(expiredSse.status).toBe(401);
      const ambient = await fetch(data.url, { headers: { Cookie: `token=${data.token}` } });
      expect(ambient.status).toBe(401);
      expireSession!();
      expect((await connectedReader.read()).done).toBe(true);
      expect((daemon.explorerStatus().data as any).revoked).toBe(true);
      await daemon.stopExplorer();
    } finally {
      clearTimeout(expiryTimer);
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("Explorer fails closed over malformed repository model input without leaking its body", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      await daemon.init(root, "Malformed Explorer App");
      const malformedPath = join(root, ".archcontext", "model", "nodes", "malformed.yaml");
      writeFileSync(malformedPath, "schemaVersion: broken\nTOP_SECRET_BODY: should-not-leak\n", "utf8");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      const data = started.data as any;
      const response = await fetch(`${data.url}projection/v2`, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain("TOP_SECRET_BODY");
      expect(body).not.toContain("should-not-leak");
      await daemon.stopExplorer();
      await daemon.stop();
    } finally {
      removeTempRepo(root);
    }
  });
});
