import { rmSync, tempRepo, removeTempRepo, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { digestJson, type JsonEnvelope } from "@archcontext/contracts";
import { DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY } from "@archcontext/local-runtime/local-store-sqlite";
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
  test("Explorer loopback service is token-gated, read-only, and revocable", async () => {
    const root = tempRepo();
    try {
      const localStore = new TestLocalStore(DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY, () => "2026-06-20T00:00:00.000Z");
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
      expect(localStore.explorerManifestCacheHits).toBe(1);
      expect(localStore.explorerRuntimeMetrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ metricName: "cache-rebuild", reasonCode: "manifest-miss", value: 1 }),
        expect.objectContaining({ metricName: "compile-time-ms", reasonCode: "projection-compile" })
      ]));
      const testCacheStats = await localStore.readExplorerProjectionCacheStats({
        repository: bodyV2.data.inputManifest.repository,
        worktree: bodyV2.data.inputManifest.worktree
      });
      expect(testCacheStats.metrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ metricName: "cache-hit", reasonCode: "manifest-read", sampleCount: 1 }),
        expect.objectContaining({ metricName: "cache-rebuild", reasonCode: "manifest-miss", sampleCount: 1 })
      ]));

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

      const runtimeStatus = await daemon.runtimeStatus(root);
      const migrated = await daemon.ledgerMigrate(root, {
        fromYaml: true,
        dryRun: false,
        expectedWorktreeDigest: (runtimeStatus.data as any).worktreeDigest
      });
      expect(migrated.ok).toBe(true);
      const authorityProjectionResponse = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(authorityProjectionResponse.status).toBe(200);
      const authorityProjection = await authorityProjectionResponse.json() as any;
      expect(authorityProjection.data.cursor.authorityCursor).toBeTruthy();
      const bookStatus = await daemon.book(root, { command: "status" });
      const eventId = (bookStatus.data as any).freshness.ledgerCursor.lastEventId;
      expect(eventId).toBeTruthy();
      const delta = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(eventId)}&headEventId=${encodeURIComponent(eventId)}&baseProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(delta.status).toBe(200);
      expect(((await delta.json()) as any).data.counts).toEqual({ "architecture-fact": 0, evidence: 0, projection: 0 });
      expect(localStore.explorerCacheMetadata.get(authorityProjection.data.projectionDigest)).toMatchObject({ pinReason: "delta-head" });
      const malformedDelta = await daemon.explorerProjectionDelta(root, {} as any);
      expect(malformedDelta.ok).toBe(false);
      expect((malformedDelta.error as any).reasonCode).toBe("invalid-delta-query");
      const missingEventDelta = await fetch(`${data.url}delta?baseEventId=arch_event.missing&headEventId=${encodeURIComponent(eventId)}&baseProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(missingEventDelta.status).toBe(409);
      expect(((await missingEventDelta.json()) as any).error.reasonCode).toBe("authority-event-missing");

      const authorityCursor = authorityProjection.data.cursor.authorityCursor;
      const observedSymbolId = authorityProjection.data.occurrences
        .flatMap((occurrence: any) => occurrence.provenance.observedSymbolIds)[0];
      const targetEntityId = authorityProjection.data.occurrences
        .flatMap((occurrence: any) => occurrence.provenance.declaredEntityIds)[0];
      expect(observedSymbolId).toBeTruthy();
      expect(targetEntityId).toBeTruthy();
      const explorerAnchor = await localStore.createArchitectureLedgerSnapshot({
        repository: authorityCursor.repository,
        worktree: authorityCursor.worktree,
        sourceMode: "dual",
        projectionDigest: authorityProjection.data.projectionDigest,
        inputDigests: { modelDigest: authorityCursor.graphDigest },
        createdAt: "2026-06-20T00:00:00.500Z"
      });
      expect(explorerAnchor.schemaVersion).toBe("archcontext.architecture-snapshot/v2");
      const evidenceItem = {
        schemaVersion: "archcontext.evidence-item/v2",
        evidenceId: "evidence.explorer-lifecycle",
        kind: "architecture-declaration",
        strength: "verified",
        polarity: "positive",
        origin: "runtime-daemon",
        subject: targetEntityId,
        selector: { kind: "symbol", id: observedSymbolId, symbolId: observedSymbolId },
        summary: "Explorer lifecycle binding",
        coverage: { level: "complete", scope: targetEntityId },
        supports: ["checkpoint"],
        provenance: { producer: "runtime-daemon.test", command: "test Explorer lifecycle", inputDigest: digestJson({ observedSymbolId, targetEntityId } as any) },
        createdAt: "2026-06-20T00:00:01.000Z",
        digest: digestJson({ evidenceId: "evidence.explorer-lifecycle", observedSymbolId, targetEntityId } as any)
      };
      const evidenceBinding = {
        schemaVersion: "archcontext.evidence-binding/v1",
        bindingId: "binding.explorer-lifecycle",
        evidenceId: evidenceItem.evidenceId,
        target: { kind: "entity", id: targetEntityId },
        bindingReason: "direct-selector",
        authorityEffect: "checkpoint-eligible",
        createdAt: "2026-06-20T00:00:01.000Z",
        provenance: evidenceItem.provenance
      };
      await localStore.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{
          schemaVersion: "archcontext.architecture-event/v1",
          eventId: "arch_event.explorer_lifecycle",
          eventType: "architecture.evidence.lifecycle",
          payloadVersion: "archcontext.architecture-evidence-lifecycle/v2",
          repository: authorityCursor.repository,
          worktree: authorityCursor.worktree,
          baseDigest: authorityCursor.graphDigest,
          resultingDigest: authorityCursor.graphDigest,
          headSha: authorityCursor.worktree.headSha,
          actor: { kind: "daemon", id: "archctxd.test" },
          source: "apply_update",
          timestamp: "2026-06-20T00:00:01.000Z",
          idempotencyKey: "explorer-evidence-lifecycle",
          provenance: evidenceItem.provenance,
          payload: {
            summary: "Create Explorer evidence binding",
            evidenceOperations: [
              { target: "item", action: "create", evidenceId: evidenceItem.evidenceId, value: evidenceItem },
              { target: "binding", action: "create", bindingId: evidenceBinding.bindingId, value: evidenceBinding }
            ]
          }
        } as any]
      });
      const lifecycleFeedRecord = localStore.architectureChangeFeed.at(-1)!;
      expect(lifecycleFeedRecord.eventId).toBe("arch_event.explorer_lifecycle");
      expect(Math.max(...[...localStore.architectureChangeFeedConsumers.values()].map((consumer) => consumer.checkpoint), 0)).toBeLessThan(lifecycleFeedRecord.feedSequence);
      const lifecycleProjectionResponse = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(lifecycleProjectionResponse.status).toBe(200);
      const lifecycleProjection = await lifecycleProjectionResponse.json() as any;
      expect(lifecycleProjection.data.inputManifest.bindingsDigest).not.toBe(authorityProjection.data.inputManifest.bindingsDigest);
      expect(lifecycleProjection.data.occurrences.some((occurrence: any) => occurrence.provenance.evidenceBindingIds.includes(evidenceBinding.bindingId))).toBe(true);
      expect(lifecycleProjection.data.occurrences.some((occurrence: any) => occurrence.backlinks.changedByEventIds.includes("arch_event.explorer_lifecycle"))).toBe(true);
      expect(lifecycleProjection.data.occurrences.some((occurrence: any) => occurrence.inspector.historyEvents.some((event: any) => event.eventId === "arch_event.explorer_lifecycle"))).toBe(true);
      expect(localStore.invalidatedExplorerProjections.has(authorityProjection.data.projectionDigest)).toBe(true);
      expect(Math.max(...[...localStore.architectureChangeFeedConsumers.values()].map((consumer) => consumer.checkpoint), 0)).toBe(lifecycleFeedRecord.feedSequence);
      const anchoredLifecycleReplay = await localStore.replayArchitectureLedger({ repository: authorityCursor.repository, worktree: authorityCursor.worktree });
      expect(anchoredLifecycleReplay.replay.anchorSnapshotId).toBe(explorerAnchor.snapshotId);
      expect(anchoredLifecycleReplay.replay.tailEventCount).toBe(1);
      const lifecycleEventId = lifecycleProjection.data.cursor.authorityCursor.eventId;
      const lifecycleDelta = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(eventId)}&headEventId=${encodeURIComponent(lifecycleEventId)}&baseProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(lifecycleDelta.status).toBe(200);
      expect(((await lifecycleDelta.json()) as any).data.counts.evidence).toBe(2);
      const mismatchedCursor = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(eventId)}&headEventId=${encodeURIComponent(lifecycleEventId)}&baseProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(mismatchedCursor.status).toBe(409);
      expect(((await mismatchedCursor.json()) as any).error.reasonCode).toBe("projection-authority-mismatch");
      const reversedCursor = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(lifecycleEventId)}&headEventId=${encodeURIComponent(eventId)}&baseProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(reversedCursor.status).toBe(409);
      expect(((await reversedCursor.json()) as any).error.reasonCode).toBe("authority-cursor-reversed");

      const detailProjection = await fetch(`${data.url}projection/v2?level=detail&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      const detailBody = await detailProjection.json() as any;
      const projectionOnlyDelta = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(lifecycleEventId)}&headEventId=${encodeURIComponent(lifecycleEventId)}&baseProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(detailBody.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionOnlyDelta.status).toBe(409);
      const projectionOnlyDeltaBody = await projectionOnlyDelta.json() as any;
      expect(projectionOnlyDeltaBody.error.message).toContain("incompatible Explorer delta: manifest");
      expect(projectionOnlyDeltaBody.error.reasonCode).toBe("projection-manifest-incompatible");

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
      const updatedEvidenceItem = {
        ...evidenceItem,
        summary: "Explorer lifecycle binding updated",
        digest: digestJson({ evidenceId: evidenceItem.evidenceId, summary: "Explorer lifecycle binding updated" } as any)
      };
      await localStore.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{
          schemaVersion: "archcontext.architecture-event/v1",
          eventId: "arch_event.explorer_lifecycle_update",
          eventType: "architecture.evidence.lifecycle",
          payloadVersion: "archcontext.architecture-evidence-lifecycle/v2",
          repository: authorityCursor.repository,
          worktree: authorityCursor.worktree,
          baseDigest: authorityCursor.graphDigest,
          resultingDigest: authorityCursor.graphDigest,
          headSha: authorityCursor.worktree.headSha,
          actor: { kind: "daemon", id: "archctxd.test" },
          source: "apply_update",
          timestamp: "2026-06-20T00:00:02.000Z",
          idempotencyKey: "explorer-evidence-lifecycle-update",
          provenance: evidenceItem.provenance,
          payload: {
            summary: "Update Explorer evidence item",
            evidenceOperations: [
              { target: "item", action: "update", evidenceId: updatedEvidenceItem.evidenceId, previousDigest: digestJson(evidenceItem as any), value: updatedEvidenceItem }
            ]
          }
        } as any]
      });
      await fetch(`${data.url}projection/v2?level=overview&maxNodes=5&maxRelations=5`, { headers: { Authorization: `Bearer ${data.token}` } });
      const eventChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Explorer SSE invalidation timeout")), 2_000))
      ]);
      const eventText = new TextDecoder().decode(eventChunk.value);
      expect(eventText).toContain("authority-changed");
      expect(eventText).toContain("feedSequence");
      expect(eventText).toContain("subjectsDigest");
      expect(eventText).not.toContain("summary");
      expect(eventText).not.toContain("payload");
      expect(eventText).not.toContain("sourceBody");
      expect(eventText).not.toContain("src/");
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
      expect(body).not.toContain("malformed.yaml");
      await daemon.stopExplorer();
    } finally {
      removeTempRepo(root);
    }
  });
});
