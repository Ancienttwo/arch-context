import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, stableYaml, type Json } from "@archcontext/contracts";
import type { ArchitectureSemanticStateV1 } from "@archcontext/core/projection-engine";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { SqliteLocalStore, type CommittedChangeSetForTaskSession } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import {
  acceptedJournalLinks,
  assertModelTransitionChain,
  assertProofChangesExplained,
  committedChangeAcceptancePlanId,
  decodeAcceptCommittedChangeInput,
  labelAcceptedNodeSets,
  semanticLastWriters,
  type CommittedChangeAcceptancePlanV1
} from "../src/committed-change-acceptance";
import { createStartedDaemon } from "../src/index";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-accept-v2-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

const TIMEOUT = process.platform === "win32" ? 240_000 : 60_000;
const digest = (fill: string) => `sha256:${fill.repeat(64)}`;

describe("committed change acceptance helpers", () => {
  const transition = (before: string, after: string) => ({ schemaVersion: "archcontext.changeset-model-transition/v1" as const, before, after });
  const journal = (journalId: string, overrides: Partial<CommittedChangeSetForTaskSession> = {}): CommittedChangeSetForTaskSession => ({
    journalId,
    changeSetId: `changeset.${journalId}`,
    committedAt: "2026-09-28T00:00:00.000Z",
    files: [{ path: ".archcontext/model/nodes/component.a.yaml", operation: "write", hash: digest("a") }],
    modelTransition: transition(digest("1"), digest("2")),
    ...overrides
  });
  const ref = (journalId: string) => ({ journalId, changeSetId: `changeset.${journalId}` });

  test("the model transition chain must run from the baseline through every journal to the current model", () => {
    const links = [{ journalId: "j1", before: digest("1"), after: digest("2") }, { journalId: "j2", before: digest("2"), after: digest("3") }];
    expect(() => assertModelTransitionChain(digest("1"), digest("3"), links)).not.toThrow();
    expect(() => assertModelTransitionChain(digest("0"), digest("3"), links)).toThrow(/chain-baseline-mismatch/);
    expect(() => assertModelTransitionChain(digest("1"), digest("3"), [links[0]!, { ...links[1]!, before: digest("9") }])).toThrow(/chain-gap: j1 -> j2/);
    expect(() => assertModelTransitionChain(digest("1"), digest("4"), links)).toThrow(/chain-current-mismatch/);
    expect(() => assertModelTransitionChain(digest("1"), digest("1"), [])).toThrow(/chain-empty/);
  });

  test("journal links require committed, matching, semantic, evidenced and ordered journals", () => {
    expect(acceptedJournalLinks([ref("j1")], [journal("j1")])[0]).toMatchObject({ journalId: "j1", before: digest("1"), after: digest("2") });
    expect(() => acceptedJournalLinks([ref("j1")], [undefined])).toThrow(/journal-not-committed/);
    expect(() => acceptedJournalLinks([{ journalId: "j1", changeSetId: "changeset.other" }], [journal("j1")])).toThrow(/journal-id-mismatch/);
    expect(() => acceptedJournalLinks([ref("j1")], [journal("j1", { files: [{ path: ".archcontext/waivers/w.json", operation: "write", hash: digest("a") }] })]))
      .toThrow(/journal-without-semantic-write/);
    expect(() => acceptedJournalLinks([ref("j1")], [journal("j1", { modelTransition: undefined })])).toThrow(/journal-without-transition/);
    expect(() => acceptedJournalLinks([ref("j2"), ref("j1")], [
      journal("j2", { committedAt: "2026-09-28T00:00:01.000Z" }),
      journal("j1", { committedAt: "2026-09-28T00:00:00.000Z" })
    ])).toThrow(/journal-out-of-order/);
    expect(semanticLastWriters([
      { journalId: "j1", files: [{ path: ".archcontext/model/nodes/component.a.yaml", operation: "write", hash: digest("a") }, { path: ".archcontext/generated/ARCHITECTURE.md", operation: "write", hash: digest("c") }] },
      { journalId: "j2", files: [{ path: ".archcontext/model/nodes/component.a.yaml", operation: "delete", hash: "missing" }] }
    ])).toEqual([{ path: ".archcontext/model/nodes/component.a.yaml", operation: "delete", hash: "missing", journalId: "j2" }]);
  });

  const capability = (capabilityId: string, memberNodeIds: string[], semanticFingerprint = digest("5"), flowProofFingerprint = digest("6")) => ({
    capabilityId,
    memberNodeIds,
    semanticFingerprint,
    flowProofFingerprint,
    proofStatus: { p1: "proven" as const, p2: "not-applicable" as const },
    facets: {} as never
  });
  const state = (...capabilities: ReturnType<typeof capability>[]): ArchitectureSemanticStateV1 => ({
    schemaVersion: "archcontext.architecture-semantic-state/v1",
    capabilities,
    semanticFingerprint: digest("7"),
    flowProofFingerprint: digest("8")
  });
  const write = (path: string) => ({ path, operation: "write" as const, hash: digest("a"), journalId: "j1" });
  const remove = (path: string) => ({ path, operation: "delete" as const, hash: "missing", journalId: "j1" });

  test("node sets label a moved container directly and its children as carried", () => {
    const base = state(capability("capability.a", ["capability.a", "component.c", "component.d"]), capability("capability.b", ["capability.b"]));
    const resulting = state(capability("capability.a", ["capability.a"]), capability("capability.b", ["capability.b", "component.c", "component.d"]));
    expect(labelAcceptedNodeSets({
      lastWriters: [write(".archcontext/model/nodes/component.c.yaml")],
      writtenBodies: new Map([[".archcontext/model/nodes/component.c.yaml", "id: component.c\nparent: capability.b\n"]]),
      affectedNodeIds: ["capability.a", "capability.b", "component.c", "component.d"],
      base,
      resulting,
      currentNodeIds: new Set(["capability.a", "capability.b", "component.c", "component.d"])
    })).toEqual({
      directlyEditedNodeIds: ["component.c"],
      affectedAncestorNodeIds: ["capability.a", "capability.b"],
      carriedNodeIds: ["component.d"]
    });
  });

  test("relation-only and flow-only edits label the capability as an affected ancestor", () => {
    const base = state(capability("capability.a", ["capability.a"]));
    for (const path of [".archcontext/model/relations/relation.a.yaml", ".archcontext/model/flows/flow.a.yaml"]) {
      expect(labelAcceptedNodeSets({
        lastWriters: [write(path)],
        writtenBodies: new Map([[path, "id: relation.a\n"]]),
        affectedNodeIds: ["capability.a"],
        base,
        resulting: base,
        currentNodeIds: new Set(["capability.a"])
      })).toEqual({ directlyEditedNodeIds: [], affectedAncestorNodeIds: ["capability.a"], carriedNodeIds: [] });
    }
  });

  test("a proof-only change is accepted only when a bound journal wrote the capability's flow", () => {
    const base = state(capability("capability.a", ["capability.a"], digest("5"), digest("6")));
    const proofOnly = state(capability("capability.a", ["capability.a"], digest("5"), digest("9")));
    expect(() => assertProofChangesExplained({ base, resulting: proofOnly, journaledFlowCapabilityIds: new Set() }))
      .toThrow(/proof-change-unexplained: capability.a/);
    expect(() => assertProofChangesExplained({ base, resulting: proofOnly, journaledFlowCapabilityIds: new Set(["capability.a"]) })).not.toThrow();
    const semanticToo = state(capability("capability.a", ["capability.a"], digest("4"), digest("9")));
    expect(() => assertProofChangesExplained({ base, resulting: semanticToo, journaledFlowCapabilityIds: new Set() })).not.toThrow();
  });

  test("a deleted node is named by its standard path, must exist in the baseline and be gone now", () => {
    const base = state(capability("capability.a", ["capability.a", "component.gone"]));
    const resulting = state(capability("capability.a", ["capability.a"]));
    const label = (path: string, currentNodeIds: string[], baseline = base) => labelAcceptedNodeSets({
      lastWriters: [remove(path)],
      writtenBodies: new Map(),
      affectedNodeIds: ["capability.a", "component.gone"],
      base: baseline,
      resulting,
      currentNodeIds: new Set(currentNodeIds)
    });
    expect(label(".archcontext/model/nodes/component.gone.yaml", ["capability.a"])).toEqual({
      directlyEditedNodeIds: ["component.gone"],
      affectedAncestorNodeIds: ["capability.a"],
      carriedNodeIds: []
    });
    expect(() => label(".archcontext/model/nodes/component.gone.yaml", ["capability.a", "component.gone"])).toThrow(/deleted-node-unbound/);
    expect(() => label(".archcontext/model/nodes/component.gone.yaml", ["capability.a"], resulting)).toThrow(/deleted-node-unbound/);
    expect(() => label(".archcontext/model/nodes/component.gone.yml", ["capability.a"])).toThrow(/node-path-nonstandard/);
    expect(() => labelAcceptedNodeSets({
      lastWriters: [write(".archcontext/model/nodes/misnamed.yaml")],
      writtenBodies: new Map([[".archcontext/model/nodes/misnamed.yaml", "id: component.real\n"]]),
      affectedNodeIds: ["capability.a"],
      base,
      resulting,
      currentNodeIds: new Set(["capability.a", "component.real"])
    })).toThrow(/node-path-nonstandard/);
  });

  test("the acceptance plan id is a stable digest of the whole plan", () => {
    const plan = (): CommittedChangeAcceptancePlanV1 => ({
      schemaVersion: "archcontext.accepted-committed-change-plan/v1",
      journals: [{ journalId: "j1", changeSetId: "changeset.j1", committedAt: "2026-09-28T00:00:00.000Z", before: digest("1"), after: digest("2") }],
      baselineModelDigest: digest("1"),
      modelDigest: digest("2"),
      reasonCodes: ["ownership-changed"],
      affectedNodeIds: ["capability.a"],
      directlyEditedNodeIds: ["component.c"],
      affectedAncestorNodeIds: ["capability.a"],
      carriedNodeIds: [],
      fileSetDigest: digest("3"),
      projectionWorktreeDigest: digest("4"),
      headSha: "a".repeat(40)
    });
    expect(committedChangeAcceptancePlanId(plan())).toBe(committedChangeAcceptancePlanId(plan()));
    expect(committedChangeAcceptancePlanId(plan())).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(committedChangeAcceptancePlanId({ ...plan(), baselineModelDigest: digest("0") })).not.toBe(committedChangeAcceptancePlanId(plan()));
  });

  test("the request decoder is closed and refuses the retired four-field shape", () => {
    const one = [{ journalId: "j1", changeSetId: "changeset.j1" }];
    expect(decodeAcceptCommittedChangeInput({ journals: one })).toEqual({ journals: one, approved: false });
    expect(decodeAcceptCommittedChangeInput({ journals: one, approved: true, expectedWorktreeDigest: digest("1"), acceptancePlanId: digest("2") }))
      .toEqual({ journals: one, approved: true, expectedWorktreeDigest: digest("1"), acceptancePlanId: digest("2") });
    for (const invalid of [
      { journalId: "j1", changeSetId: "changeset.j1", approved: true, expectedWorktreeDigest: digest("1") },
      { journals: [] },
      { journals: Array.from({ length: 33 }, (_, index) => ({ journalId: `j${index}`, changeSetId: `c${index}` })) },
      { journals: [...one, ...one] },
      { journals: [{ ...one[0], extra: true }] },
      { journals: one, approved: true },
      { journals: one, acceptancePlanId: digest("2") },
      { journals: one, approved: true, expectedWorktreeDigest: "sha256:short", acceptancePlanId: digest("2") }
    ]) {
      expect(() => decodeAcceptCommittedChangeInput(invalid)).toThrow();
    }
  });
});

const CAPABILITY_A = "capability.runtime-harness.hook-adapters";
const CAPABILITY_B = "capability.runtime-harness.session-store";

interface Fixture {
  root: string;
  store: SqliteLocalStore;
  daemon: Awaited<ReturnType<typeof createStartedDaemon>>;
}

function writeYaml(root: string, path: string, value: Record<string, Json>): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), stableYaml(value), "utf8");
}

function nodePath(id: string): string {
  return `.archcontext/model/nodes/${id}.yaml`;
}

function nodeBody(id: string, fields: Record<string, Json> = {}): string {
  return stableYaml({ schemaVersion: "archcontext.node/v2", id, kind: "component", name: id, status: "active", ...fields });
}

function createAcceptanceRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-accept-v2-"));
  writeFileSync(join(root, "README.md"), "# acceptance fixture\n", "utf8");
  initializeArchContextModel(root, "Acceptance Fixture");
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"));
  for (const [id, slug] of [[CAPABILITY_A, "hook-adapters"], [CAPABILITY_B, "session-store"]] as const) {
    writeYaml(root, nodePath(id), {
      schemaVersion: "archcontext.node/v2", id, kind: "capability", name: slug, status: "active", summary: `Owns ${slug}.`,
      extensions: { contractFiles: { agents: `packages/${slug}/AGENTS.md`, claude: `packages/${slug}/CLAUDE.md` } }
    });
    writeYaml(root, `.archcontext/model/relations/relation.${slug}.yaml`, {
      schemaVersion: "archcontext.relation/v1", id: `relation.${slug}`, kind: "writes", source: id, target: id, intent: `Persist ${slug} state`
    });
    writeYaml(root, `.archcontext/model/flows/flow.${slug}.yaml`, {
      schemaVersion: "archcontext.flow/v1", id: `flow.${slug}`, capabilityId: id, name: `${slug} flow`, applicability: "not-applicable", rationale: "Acceptance fixture."
    });
  }
  writeFileSync(join(root, nodePath("component.container")), nodeBody("component.container", {
    parent: CAPABILITY_A, summary: "Container.", ownership: { lifecycle: ["team-architecture"] }
  }), "utf8");
  writeFileSync(join(root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "Child." }), "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  commitAll(root, "fixture");
  return root;
}

function commitAll(root: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", message], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

async function baseline(fixture: Fixture): Promise<void> {
  const applied = await fixture.daemon.docsProjection(fixture.root, { action: "apply", profile: "repo-harness/v1", approved: true });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
}

async function withFixture(run: (fixture: Fixture) => Promise<void>, options: { rolloutMode?: "yaml" | "dual" } = {}): Promise<void> {
  const root = createAcceptanceRepo();
  const store = new SqliteLocalStore(join(mkdtempSync(join(STATE_ROOT, "store-")), "local-store.sqlite"));
  const daemon = await createStartedDaemon({
    localStore: store,
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    ...(options.rolloutMode ? { architectureLedger: { rolloutMode: options.rolloutMode } } : {})
  });
  const fixture = { root, store, daemon };
  try {
    await baseline(fixture);
    await run(fixture);
  } finally {
    await daemon.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

function currentHash(root: string, path: string): string {
  try {
    return digestJson({ body: readFileSync(join(root, path), "utf8") });
  } catch {
    return "missing";
  }
}

async function change(fixture: Fixture, id: string, operations: { op: "create_entity" | "update_entity_fields" | "delete_entity"; path: string; body?: string }[], root = fixture.root): Promise<{ journalId: string; changeSetId: string }> {
  const plan = await fixture.daemon.planUpdate(root, {
    id,
    operations: operations.map((operation) => ({ ...operation, expectedHash: currentHash(root, operation.path) }))
  });
  expect(plan.ok, JSON.stringify(plan)).toBe(true);
  const applied = await fixture.daemon.applyUpdate(root, { id, approved: true, expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  return { journalId: (applied.data as any).journalId, changeSetId: id };
}

function editNode(root: string, id: string, fields: Record<string, Json>) {
  return { op: "update_entity_fields" as const, path: nodePath(id), body: nodeBody(id, { ...nodeFields(root, id), ...fields }) };
}

function nodeFields(root: string, id: string): Record<string, Json> {
  const model = loadNativeModelFromArchContext(root);
  const { schemaVersion: _schemaVersion, id: _id, kind: _kind, name: _name, status: _status, ...rest } = model.nodes.find((node) => node.id === id)! as unknown as Record<string, Json>;
  return rest;
}

async function preview(fixture: Fixture, journals: { journalId: string; changeSetId: string }[]) {
  return fixture.daemon.acceptCommittedChange(fixture.root, { journals });
}

async function accept(fixture: Fixture, journals: { journalId: string; changeSetId: string }[]) {
  const previewed = await preview(fixture, journals);
  expect(previewed.ok, JSON.stringify(previewed)).toBe(true);
  const data = previewed.data as any;
  expect(data.status).toBe("preview");
  const approved = await fixture.daemon.acceptCommittedChange(fixture.root, {
    journals,
    approved: true,
    acceptancePlanId: data.acceptancePlanId,
    expectedWorktreeDigest: data.expectedWorktreeDigest
  });
  return { preview: data, approved };
}

async function expectRefused(fixture: Fixture, journals: { journalId: string; changeSetId: string }[], message: RegExp) {
  const previewed = await preview(fixture, journals);
  expect(previewed.ok, JSON.stringify(previewed)).toBe(false);
  expect((previewed as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
  expect((previewed as any).error.message).toMatch(message);
}

async function acceptedEvent(fixture: Fixture, eventId: string) {
  const rows = (fixture.store as any).requireOpenDatabase().prepare("SELECT event_json FROM architecture_events WHERE event_id LIKE ?").all(`%:${eventId}`) as { event_json: string }[];
  return rows.map((row) => JSON.parse(row.event_json));
}

describe("committed change acceptance v2", () => {
  test("accepts a node addition and records a record-only v2 event", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add-component", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B, summary: "Added." }) }]);
      const { preview: planned, approved } = await accept(fixture, [added]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan).toMatchObject({
        schemaVersion: "archcontext.accepted-committed-change-plan/v1",
        affectedNodeIds: [CAPABILITY_B, "component.added"],
        directlyEditedNodeIds: ["component.added"],
        affectedAncestorNodeIds: [CAPABILITY_B],
        carriedNodeIds: []
      });
      expect(planned.plan.reasonCodes).toContain("node-added");
      expect(planned.plan.baselineModelDigest).toBe(planned.plan.journals[0].before);
      expect(planned.plan.modelDigest).toBe(digestJson(loadNativeModelFromArchContext(fixture.root) as unknown as Json));
      const data = approved.data as any;
      expect(data).toMatchObject({ status: "accepted", acceptedChange: planned.acceptedChange, acceptancePlanId: planned.acceptancePlanId, journalIds: [added.journalId] });
      expect(data.acceptedChange.eventId).toMatch(/^architecture_event\.changeset_accepted\.[a-f0-9]{24}$/);
      const [event] = await acceptedEvent(fixture, data.acceptedChange.eventId);
      expect(event).toMatchObject({
        eventType: "architecture.changeset.accepted",
        payloadVersion: "archcontext.accepted-committed-change/v2",
        payload: {
          operations: [],
          acceptedCommittedChange: {
            schemaVersion: "archcontext.accepted-committed-change/v2",
            journals: planned.plan.journals,
            baselineModelDigest: planned.plan.baselineModelDigest,
            modelDigest: planned.plan.modelDigest,
            acceptancePlanId: planned.acceptancePlanId,
            authority: "yaml"
          }
        }
      });
      expect(event.baseDigest).toBe(event.resultingDigest);
      expect(event.idempotencyKey).toBe(`architecture-ledger-accepted-committed/v2:${data.acceptedChange.eventId}`);
      expect(JSON.stringify(event)).not.toContain("Added.");
    });
  }, TIMEOUT);

  test("accepts an ownership-only edit whose affected set is the capability, not the edited node", async () => {
    await withFixture(async (fixture) => {
      const owned = await change(fixture, "changeset.ownership", [editNode(fixture.root, "component.container", { source: { include: ["README.md"] } })]);
      const { preview: planned, approved } = await accept(fixture, [owned]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan).toMatchObject({
        reasonCodes: ["ownership-changed"],
        affectedNodeIds: [CAPABILITY_A],
        directlyEditedNodeIds: ["component.container"],
        affectedAncestorNodeIds: [CAPABILITY_A],
        carriedNodeIds: []
      });
    });
  }, TIMEOUT);

  test("accepts a main journal plus a follow-up, with a waiver journal in between", async () => {
    await withFixture(async (fixture) => {
      const main = await change(fixture, "changeset.main", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      const waiver = await fixture.daemon.planPracticeWaiver(fixture.root, {
        id: "changeset.waiver",
        waiverId: "accept-waiver",
        taskSessionId: "task_waiver",
        practiceId: "modularity.no-new-cycle",
        checkId: "no-new-cycle",
        owner: "team-architecture",
        reason: "External migration window requires keeping this edge until the upstream cutover is complete.",
        createdAt: "2026-06-24T00:00:00.000Z",
        reviewAt: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-24T00:00:00.000Z",
        evidenceDigest: digest("1"),
        subjects: ["module.a->module.b"]
      });
      expect(waiver.ok, JSON.stringify(waiver)).toBe(true);
      const waiverApply = await fixture.daemon.applyUpdate(fixture.root, { id: "changeset.waiver", approved: true, expectedWorktreeDigest: (waiver.data as any).draft.base.worktreeDigest });
      expect(waiverApply.ok, JSON.stringify(waiverApply)).toBe(true);
      const followUp = await change(fixture, "changeset.follow-up", [editNode(fixture.root, "component.added", { summary: "Follow-up summary." })]);

      await expectRefused(fixture, [main], /chain-current-mismatch/);
      await expectRefused(fixture, [main, { journalId: (waiverApply.data as any).journalId, changeSetId: "changeset.waiver" }, followUp], /journal-without-semantic-write/);
      const { preview: planned, approved } = await accept(fixture, [main, followUp]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan.journals.map((entry: any) => entry.journalId)).toEqual([main.journalId, followUp.journalId]);
      expect(planned.plan.journals[0].after).toBe(planned.plan.journals[1].before);
      expect(planned.acceptedChange.changeSetId).toBe("changeset.main");
    });
  }, TIMEOUT);

  test("accepts a node rename and a moved container that carries its child", async () => {
    await withFixture(async (fixture) => {
      const renamed = await change(fixture, "changeset.rename", [
        { op: "delete_entity", path: nodePath("component.child") },
        { op: "create_entity", path: nodePath("component.renamed-child"), body: nodeBody("component.renamed-child", { parent: "component.container", summary: "Child." }) }
      ]);
      const { preview: renamePlan, approved: renameApproved } = await accept(fixture, [renamed]);
      expect(renameApproved.ok, JSON.stringify(renameApproved)).toBe(true);
      expect(renamePlan.plan.reasonCodes).toEqual(expect.arrayContaining(["node-added", "node-removed"]));
      expect(renamePlan.plan.directlyEditedNodeIds).toEqual(["component.child", "component.renamed-child"]);

      await baseline(fixture);
      const moved = await change(fixture, "changeset.move-container", [editNode(fixture.root, "component.container", { parent: CAPABILITY_B })]);
      const { preview: movePlan, approved: moveApproved } = await accept(fixture, [moved]);
      expect(moveApproved.ok, JSON.stringify(moveApproved)).toBe(true);
      expect(movePlan.plan).toMatchObject({
        affectedNodeIds: [CAPABILITY_A, CAPABILITY_B, "component.container", "component.renamed-child"],
        directlyEditedNodeIds: ["component.container"],
        affectedAncestorNodeIds: [CAPABILITY_A, CAPABILITY_B],
        carriedNodeIds: ["component.renamed-child"]
      });
    });
  }, TIMEOUT);

  test("the same transition at a new HEAD gets the same event id in a new scope, and a replay at the same snapshot is refused", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      const first = await accept(fixture, [added]);
      expect(first.approved.ok, JSON.stringify(first.approved)).toBe(true);
      const replay = await fixture.daemon.acceptCommittedChange(fixture.root, {
        journals: [added], approved: true, acceptancePlanId: first.preview.acceptancePlanId, expectedWorktreeDigest: first.preview.expectedWorktreeDigest
      });
      expect(replay.ok).toBe(false);
      expect((replay as any).error.message).toMatch(/already has an acceptance event at this snapshot/);

      commitAll(fixture.root, "commit accepted change");
      const second = await accept(fixture, [added]);
      expect(second.approved.ok, JSON.stringify(second.approved)).toBe(true);
      expect((second.approved.data as any).acceptedChange.eventId).toBe((first.approved.data as any).acceptedChange.eventId);
      expect(second.preview.plan.headSha).not.toBe(first.preview.plan.headSha);
      expect(await acceptedEvent(fixture, (first.approved.data as any).acceptedChange.eventId)).toHaveLength(2);
    });
  }, TIMEOUT);

  test("hand edits before, between or after the journals break the chain", async () => {
    await withFixture(async (fixture) => {
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "Hand edit." }), "utf8");
      const afterHandEdit = await change(fixture, "changeset.after-hand-edit", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      await expectRefused(fixture, [afterHandEdit], /chain-baseline-mismatch/);
    });
    await withFixture(async (fixture) => {
      const first = await change(fixture, "changeset.first", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "Hand edit." }), "utf8");
      const second = await change(fixture, "changeset.second", [editNode(fixture.root, "component.added", { summary: "Second." })]);
      await expectRefused(fixture, [first, second], /chain-gap/);
      writeFileSync(join(fixture.root, nodePath("component.added")), nodeBody("component.added", { parent: CAPABILITY_B, summary: "Trailing hand edit." }), "utf8");
      await expectRefused(fixture, [first, second], /chain-gap|chain-current-mismatch/);
    });
    await withFixture(async (fixture) => {
      const only = await change(fixture, "changeset.only", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "Hand edit." }), "utf8");
      await expectRefused(fixture, [only], /chain-current-mismatch/);
    });
  }, TIMEOUT * 3);

  test("refuses journals from before the baseline, other roots, pending, aborted, mismatched, out of order or without transitions", async () => {
    await withFixture(async (fixture) => {
      const early = await change(fixture, "changeset.early", [{ op: "create_entity", path: nodePath("component.early"), body: nodeBody("component.early", { parent: CAPABILITY_B }) }]);
      await baseline(fixture);
      const later = await change(fixture, "changeset.later", [{ op: "create_entity", path: nodePath("component.later"), body: nodeBody("component.later", { parent: CAPABILITY_B }) }]);
      await expectRefused(fixture, [early, later], /chain-baseline-mismatch/);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 5));
      const latest = await change(fixture, "changeset.latest", [editNode(fixture.root, "component.later", { summary: "Latest." })]);
      await expectRefused(fixture, [latest, later], /journal-out-of-order/);
      await expectRefused(fixture, [{ ...later, changeSetId: "changeset.other" }], /journal-id-mismatch/);

      const otherRoot = createAcceptanceRepo();
      try {
        const foreign = await change(fixture, "changeset.foreign", [{ op: "create_entity", path: nodePath("component.foreign"), body: nodeBody("component.foreign", { parent: CAPABILITY_B }) }], otherRoot);
        await expectRefused(fixture, [foreign], /journal-not-committed/);
      } finally {
        rmSync(otherRoot, { recursive: true, force: true });
      }

      const draft = (id: string) => ({
        schemaVersion: "archcontext.changeset/v1" as const, id, status: "approved" as const,
        base: { headSha: "a".repeat(40), worktreeDigest: digest("0"), modelDigest: digest("0") },
        reason: { taskSessionId: "task_accept" }, operations: [], preconditions: [], postconditions: [], requiresConfirmation: true, idempotencyKey: `idem_${id}`
      });
      const semanticFile = { path: nodePath("component.later"), existed: true, operation: "update_entity_fields" as const, bodyHash: currentHash(fixture.root, nodePath("component.later")) };
      const pending = await fixture.store.beginChangeSet(fixture.root, draft("changeset.pending"));
      await fixture.store.recordChangeSetFile(pending, semanticFile);
      await expectRefused(fixture, [{ journalId: pending, changeSetId: "changeset.pending" }], /journal-not-committed/);
      const aborted = await fixture.store.beginChangeSet(fixture.root, draft("changeset.aborted"));
      await fixture.store.abortChangeSet(aborted, "fault");
      await expectRefused(fixture, [{ journalId: aborted, changeSetId: "changeset.aborted" }], /journal-not-committed/);
      const untracked = await fixture.store.beginChangeSet(fixture.root, draft("changeset.untracked"));
      await fixture.store.recordChangeSetFile(untracked, semanticFile);
      await fixture.store.commitChangeSet(untracked);
      await expectRefused(fixture, [later, { journalId: untracked, changeSetId: "changeset.untracked" }], /journal-without-transition/);

      for (const journals of [[later, later], Array.from({ length: 33 }, (_, index) => ({ journalId: `changeset_${index}`, changeSetId: `changeset.${index}` }))]) {
        const refused = await preview(fixture, journals);
        expect((refused as any).error).toMatchObject({ code: "AC_SCHEMA_INVALID" });
      }
    });
  }, TIMEOUT);

  test("refuses non-standard node paths, symlinked segments, unprovable proofs and rejected projection entries", async () => {
    await withFixture(async (fixture) => {
      const misnamed = await change(fixture, "changeset.misnamed", [{ op: "create_entity", path: ".archcontext/model/nodes/misnamed.yaml", body: nodeBody("component.real", { parent: CAPABILITY_B }) }]);
      await expectRefused(fixture, [misnamed], /node-path-nonstandard/);
    });
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      const outside = mkdtempSync(join(tmpdir(), "archctx-accept-v2-link-"));
      try {
        const target = join(outside, "component.added.yaml");
        writeFileSync(target, readFileSync(join(fixture.root, nodePath("component.added")), "utf8"), "utf8");
        rmSync(join(fixture.root, nodePath("component.added")));
        symlinkSync(target, join(fixture.root, nodePath("component.added")));
        await expectRefused(fixture, [added], /symlink/i);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
    await withFixture(async (fixture) => {
      const unprovable = await change(fixture, "changeset.drop-relation", [{ op: "delete_entity", path: ".archcontext/model/relations/relation.session-store.yaml" }]);
      await expectRefused(fixture, [unprovable], /proof-unprovable/);
    });
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      writeFileSync(join(fixture.root, "docs/architecture/modules/runtime-harness/session-store.md"), "# hand written\n", "utf8");
      await expectRefused(fixture, [added], /projection-rejected/);
    });
  }, TIMEOUT * 4);

  test("approval must match the previewed worktree digest and plan id; a re-baseline invalidates the preview", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      const previewed = (await preview(fixture, [added])).data as any;
      expect(previewed.expectedWorktreeDigest).toBe(architectureDocumentationProjectionWorktreeDigest(fixture.root, loadNativeModelFromArchContext(fixture.root)));
      const approve = (overrides: Record<string, string>) => fixture.daemon.acceptCommittedChange(fixture.root, {
        journals: [added], approved: true, acceptancePlanId: previewed.acceptancePlanId, expectedWorktreeDigest: previewed.expectedWorktreeDigest, ...overrides
      });
      expect(((await approve({ expectedWorktreeDigest: digest("d") })) as any).error.message).toMatch(/expected worktree digest mismatch/);
      expect(((await approve({ acceptancePlanId: digest("e") })) as any).error.message).toMatch(/acceptance plan changed since preview/);
      await baseline(fixture);
      const stale = await approve({});
      expect(stale.ok).toBe(false);
      expect((stale as any).error.message).toMatch(/chain-baseline-mismatch|acceptance plan changed/);
      expect(await acceptedEvent(fixture, previewed.acceptedChange.eventId)).toHaveLength(0);
    });
  }, TIMEOUT);

  test("refuses non-YAML ledger modes and the retired request shape", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      const refused = await fixture.daemon.acceptCommittedChange(fixture.root, { journals: [added] });
      expect((refused as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED", message: expect.stringMatching(/YAML read and write authority/) });
    }, { rolloutMode: "dual" });
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B }) }]);
      const retired = await fixture.daemon.acceptCommittedChange(fixture.root, {
        journalId: added.journalId, changeSetId: added.changeSetId, approved: true, expectedWorktreeDigest: digest("a")
      } as any);
      expect((retired as any).error).toMatchObject({ code: "AC_SCHEMA_INVALID" });
    });
  }, TIMEOUT * 2);
});
