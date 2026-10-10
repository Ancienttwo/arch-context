import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, stableYaml, type Json } from "@archcontext/contracts";
import type { ArchitectureFlowV1 } from "@archcontext/contracts";
import { architectureDocumentationProjectionWorktreeDigest, compileArchitectureSemanticState, ARCHITECTURE_DOCS_RENDERER_VERSION, compileSemanticCapabilityDiagrams, loadNativeModelFromArchContext, loadNativeModelFromModelFiles, type ArchitectureMajorChangeClassificationV1, type ArchitectureSelectorEvidenceV1, type ArchitectureSemanticStateV1, type NativeModel, type SemanticArchitectureNode, type SemanticArchitectureRelation } from "@archcontext/core/projection-engine";
import type { ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider, declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { SqliteLocalStore, type CommittedChangeSetForTaskSession } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import type { ChangeSetDraft } from "@archcontext/core/changeset-engine";
import {
  acceptedJournalLinks,
  captureModelTransitionBase,
  projectionManifestBaseline,
  recordModelTransitionEvidence,
  assertModelTransitionChain,
  assertProofChangesExplained,
  committedChangeAcceptancePlanId,
  decodeAcceptCommittedChangeInput,
  labelAcceptedNodeSets,
  planCommittedChangeAcceptance,
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

  test("a proof-only change is accepted only when the recorded source and selector evidence are unchanged", () => {
    const base = state(capability("capability.a", ["capability.a"], digest("5"), digest("6")));
    const proofOnly = state(capability("capability.a", ["capability.a"], digest("5"), digest("9")));
    const evidence = { sourceTreeDigest: digest("a"), selectorEvidenceDigest: digest("b"), rendererVersion: "renderer-v1" };
    expect(() => assertProofChangesExplained({ base, resulting: proofOnly, baselineEvidence: evidence, currentEvidence: { ...evidence } })).not.toThrow();
    // A compiler (renderer) change between baseline and acceptance is not credited to the journals either.
    for (const currentEvidence of [{ ...evidence, sourceTreeDigest: digest("c") }, { ...evidence, selectorEvidenceDigest: digest("c") }, { ...evidence, rendererVersion: "renderer-v2" }]) {
      expect(() => assertProofChangesExplained({ base, resulting: proofOnly, baselineEvidence: evidence, currentEvidence }))
        .toThrow(/proof-change-unexplained: capability.a/);
    }
    expect(() => assertProofChangesExplained({ base, resulting: proofOnly, baselineEvidence: undefined, currentEvidence: evidence }))
      .toThrow(/proof-change-unexplained/);
    const semanticToo = state(capability("capability.a", ["capability.a"], digest("4"), digest("9")));
    expect(() => assertProofChangesExplained({ base, resulting: semanticToo, baselineEvidence: evidence, currentEvidence: { ...evidence, selectorEvidenceDigest: digest("c") } })).not.toThrow();
  });

  test("the proof gate reads baseline evidence from the semantic baseline, not sticky provenance, and refuses legacy baselines", () => {
    // Codex R2 P1: render E0, re-baseline with E1 while the sticky top-level provenance keeps E0,
    // then restore E0. The baseline's own evidence says E1, so the restored E0 proof is unexplained.
    const cap = (flowProofFingerprint: string, semanticFingerprint = digest("5")) => capability("capability.a", ["capability.a"], semanticFingerprint, flowProofFingerprint);
    const consistent = (...capabilities: ReturnType<typeof capability>[]): ArchitectureSemanticStateV1 => ({
      schemaVersion: "archcontext.architecture-semantic-state/v1",
      capabilities,
      semanticFingerprint: digestJson(capabilities.map(({ capabilityId, semanticFingerprint }) => ({ capabilityId, semanticFingerprint })) as unknown as Json),
      flowProofFingerprint: digestJson(capabilities.map(({ capabilityId, flowProofFingerprint }) => ({ capabilityId, flowProofFingerprint })) as unknown as Json)
    });
    const e0 = { sourceTreeDigest: digest("a"), selectorEvidenceDigest: digest("0"), rendererVersion: "renderer-v1" };
    const e1 = { ...e0, selectorEvidenceDigest: digest("1") };
    const base = consistent(cap(digest("6")));
    const manifest = (evidence: typeof e0 | undefined) => JSON.stringify({
      provenance: { sourceTreeDigest: e0.sourceTreeDigest, codeGraphDigest: digest("c") },
      semanticBaseline: { semanticState: base, digests: { modelDigest: digest("d"), flowProofDigest: base.flowProofFingerprint }, ...(evidence ? { evidence } : {}) }
    });
    const rebaselinedOnE1 = projectionManifestBaseline(manifest(e1));
    expect(rebaselinedOnE1.evidence).toEqual(e1);
    const proofOnly = consistent(cap(digest("9")));
    expect(() => assertProofChangesExplained({ base: rebaselinedOnE1.semanticState, resulting: proofOnly, baselineEvidence: rebaselinedOnE1.evidence, currentEvidence: e0 }))
      .toThrow(/proof-change-unexplained: capability.a/);
    const legacy = projectionManifestBaseline(manifest(undefined));
    expect(legacy.evidence).toBeUndefined();
    expect(() => assertProofChangesExplained({ base: legacy.semanticState, resulting: proofOnly, baselineEvidence: legacy.evidence, currentEvidence: e0 }))
      .toThrow(/proof-change-unexplained/);
    // Ordinary semantic acceptance does not depend on recorded evidence.
    expect(() => assertProofChangesExplained({ base: legacy.semanticState, resulting: consistent(cap(digest("9"), digest("4"))), baselineEvidence: legacy.evidence, currentEvidence: e0 })).not.toThrow();
  });

  test("renaming another capability's flow participant moves this capability's proof and is accepted when evidence held", () => {
    const flow: ArchitectureFlowV1 = {
      schemaVersion: "archcontext.flow/v1", id: "flow.a", capabilityId: "capability.a", name: "A flow", applicability: "required",
      participants: [{ id: "hook", nodeId: "component.a-hook" }, { id: "journal", nodeId: "datastore.b-journal" }],
      steps: [{ id: "persist", from: "hook", to: "journal", label: "Persist", evidence: { entrypointId: "entrypoint.a", sourceSymbol: "run", sinkId: "sink.a" } }],
      outcomes: [
        { id: "ok", kind: "success", label: "Stored", steps: [], terminal: { participant: "hook", label: "Done" } },
        { id: "failed", kind: "error", label: "Failed", steps: [], terminal: { participant: "hook", label: "Retry" } }
      ]
    };
    const evidence: ArchitectureSelectorEvidenceV1[] = [{
      nodeId: "capability.a", entrypointId: "entrypoint.a", sourcePath: "src/a.ts", sourceSymbol: "run", sinkId: "sink.a",
      sinkPath: "src/b.ts", sinkSymbol: "write", matched: true, truncated: false, callSites: [{ path: "src/a.ts", line: 1 }]
    }];
    const semanticState = (journalName: string) => {
      const model = {
        nodes: [
          { schemaVersion: "archcontext.node/v2", id: "capability.a", kind: "capability", name: "A", status: "active",
            source: { entrypoints: [{ id: "entrypoint.a", path: "src/a.ts", symbols: [{ name: "run", sinks: [{ id: "sink.a", path: "src/b.ts", symbol: "write" }] }] }] } },
          { schemaVersion: "archcontext.node/v2", id: "component.a-hook", kind: "component", name: "Hook", status: "active", parent: "capability.a" },
          { schemaVersion: "archcontext.node/v2", id: "capability.b", kind: "capability", name: "B", status: "active" },
          { schemaVersion: "archcontext.node/v2", id: "datastore.b-journal", kind: "datastore", name: journalName, status: "active", parent: "capability.b" }
        ],
        relations: [
          { id: "relation.hook-journal", kind: "writes", source: "component.a-hook", target: "datastore.b-journal", intent: "persists" },
          { id: "relation.b-journal", kind: "owns", source: "capability.b", target: "datastore.b-journal", intent: "owns" }
        ],
        flows: [flow, { schemaVersion: "archcontext.flow/v1", id: "flow.b", capabilityId: "capability.b", name: "B flow", applicability: "not-applicable", rationale: "Fixture." }]
      } as unknown as NativeModel;
      const nodes = model.nodes.map((node) => ({ id: node.id, kind: node.kind, name: node.name, ...(node.parent ? { parent: node.parent } : {}), ...(node.source ? { source: node.source } : {}) })) as SemanticArchitectureNode[];
      return compileArchitectureSemanticState({
        model,
        compilations: ["capability.a", "capability.b"].map((capabilityId) => compileSemanticCapabilityDiagrams({
          capabilityId, nodes, relations: model.relations as SemanticArchitectureRelation[], flows: model.flows as ArchitectureFlowV1[], evidence
        }))
      });
    };
    const base = semanticState("Journal");
    const resulting = semanticState("Event Journal");
    const [baseA, resultA] = [base, resulting].map((entry) => entry.capabilities.find((capability) => capability.capabilityId === "capability.a")!);
    expect(resultA!.proofStatus).toEqual({ p1: "proven", p2: "proven" });
    expect(resultA!.semanticFingerprint).toBe(baseA!.semanticFingerprint);
    expect(resultA!.flowProofFingerprint).not.toBe(baseA!.flowProofFingerprint);
    const recorded = { sourceTreeDigest: digest("a"), selectorEvidenceDigest: digest("b"), rendererVersion: "renderer-v1" };
    expect(() => assertProofChangesExplained({ base, resulting, baselineEvidence: recorded, currentEvidence: { ...recorded } })).not.toThrow();
    expect(() => assertProofChangesExplained({ base, resulting, baselineEvidence: recorded, currentEvidence: { ...recorded, selectorEvidenceDigest: digest("c") } }))
      .toThrow(/proof-change-unexplained: capability.a/);
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
    expect(label(".archcontext/model/nodes/component.gone.yml", ["capability.a"]).directlyEditedNodeIds).toEqual(["component.gone"]);
    expect(labelAcceptedNodeSets({
      lastWriters: [write(".archcontext/model/nodes/component.real.yml")],
      writtenBodies: new Map([[".archcontext/model/nodes/component.real.yml", "id: component.real\n"]]),
      affectedNodeIds: ["capability.a", "component.real"],
      base,
      resulting,
      currentNodeIds: new Set(["capability.a", "component.real"])
    }).directlyEditedNodeIds).toEqual(["component.real"]);
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
      baselineAnchor: "journal",
      baselineAnchorRef: "changeset_journal.fixture",
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
const MANIFEST = "docs/architecture/.projection-manifest.json";

interface Fixture {
  root: string;
  store: SqliteLocalStore;
  daemon: Awaited<ReturnType<typeof createStartedDaemon>>;
}

interface FixtureOptions {
  rolloutMode?: "yaml" | "dual";
  /** Declared source for capability A, so its footprint (and the recorded source-tree evidence) can move. */
  capabilityASource?: boolean;
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

function createAcceptanceRepo(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-accept-v2-"));
  writeFileSync(join(root, "README.md"), "# acceptance fixture\n", "utf8");
  initializeArchContextModel(root, "Acceptance Fixture");
  declareOptionalCodeFacts(root);
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"));
  for (const [id, slug] of [[CAPABILITY_A, "hook-adapters"], [CAPABILITY_B, "session-store"]] as const) {
    writeYaml(root, nodePath(id), {
      schemaVersion: "archcontext.node/v2", id, kind: "capability", name: slug, status: "active", summary: `Owns ${slug}.`,
      extensions: { contractFiles: { agents: `packages/${slug}/AGENTS.md`, claude: `packages/${slug}/CLAUDE.md` } },
      ...(options.capabilityASource && id === CAPABILITY_A ? { source: { include: ["README.md"] } } : {})
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

async function startDaemon(options: FixtureOptions = {}) {
  const store = new SqliteLocalStore(join(mkdtempSync(join(STATE_ROOT, "store-")), "local-store.sqlite"));
  const daemon = await createStartedDaemon({
    localStore: store,
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    ...(options.rolloutMode ? { architectureLedger: { rolloutMode: options.rolloutMode } } : {})
  });
  return { store, daemon };
}

async function withFixture(run: (fixture: Fixture) => Promise<void>, options: FixtureOptions = {}): Promise<void> {
  const root = createAcceptanceRepo(options);
  const { store, daemon } = await startDaemon(options);
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

type Operation = { op: "create_entity" | "update_entity_fields" | "delete_entity"; path: string; body?: string };

async function change(fixture: Pick<Fixture, "daemon" | "root">, id: string, operations: Operation[], root = fixture.root): Promise<{ journalId: string; changeSetId: string }> {
  const plan = await fixture.daemon.planUpdate(root, {
    id,
    operations: operations.map((operation) => ({ ...operation, expectedHash: currentHash(root, operation.path) }))
  });
  expect(plan.ok, JSON.stringify(plan)).toBe(true);
  const applied = await fixture.daemon.applyUpdate(root, { id, approved: true, expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  return { journalId: (applied.data as any).journalId, changeSetId: id };
}

function editNode(root: string, id: string, fields: Record<string, Json>): Operation {
  const { schemaVersion: _schemaVersion, id: _id, name, status, kind, ...rest } = loadNativeModelFromArchContext(root).nodes.find((node) => node.id === id)! as unknown as Record<string, Json>;
  return { op: "update_entity_fields", path: nodePath(id), body: stableYaml({ schemaVersion: "archcontext.node/v2", id, kind, name, status, ...rest, ...fields }) };
}

/** Rewrites a model file with different bytes but the same parsed content: a semantic no-op journal. */
function noopRewrite(root: string, path: string): Operation {
  const current = readFileSync(join(root, path), "utf8");
  return { op: "update_entity_fields", path, body: `${JSON.stringify(parseJsonOrStableYaml(current, path), null, 2)}\n` };
}

const addComponent = (id = "component.added"): Operation => ({ op: "create_entity", path: nodePath(id), body: nodeBody(id, { parent: CAPABILITY_B }) });

async function preview(fixture: Fixture, journals: { journalId: string; changeSetId: string }[]) {
  return fixture.daemon.acceptCommittedChange(fixture.root, { journals });
}

async function approve(fixture: Fixture, journals: { journalId: string; changeSetId: string }[], previewed: any, overrides: Record<string, string> = {}) {
  return fixture.daemon.acceptCommittedChange(fixture.root, {
    journals, approved: true, acceptancePlanId: previewed.acceptancePlanId, expectedWorktreeDigest: previewed.expectedWorktreeDigest, ...overrides
  });
}

async function accept(fixture: Fixture, journals: { journalId: string; changeSetId: string }[]) {
  const previewed = await preview(fixture, journals);
  expect(previewed.ok, JSON.stringify(previewed)).toBe(true);
  const data = previewed.data as any;
  expect(data.status).toBe("preview");
  // The preview is not an acceptance: it must not carry anything a projection run could consume.
  expect(Object.keys(data).sort()).toEqual(["acceptancePlanId", "expectedWorktreeDigest", "plan", "status"]);
  expect(JSON.stringify(data)).not.toContain("architecture_event.");
  return { preview: data, approved: await approve(fixture, journals, data) };
}

async function expectRefused(fixture: Fixture, journals: { journalId: string; changeSetId: string }[], message: RegExp) {
  const previewed = await preview(fixture, journals);
  expect(previewed.ok, JSON.stringify(previewed)).toBe(false);
  expect((previewed as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
  expect((previewed as any).error.message).toMatch(message);
}

function acceptedEvents(fixture: Fixture) {
  const rows = (fixture.store as any).requireOpenDatabase().prepare("SELECT event_json FROM architecture_events WHERE event_type = ?").all("architecture.changeset.accepted") as { event_json: string }[];
  return rows.map((row) => JSON.parse(row.event_json));
}

/**
 * `planCommittedChangeAcceptance` takes one strict snapshot of the on-disk semantic model
 * (`readSemanticModelSnapshot`) and refuses when the passed-in `model` digests to something else:
 * a `model` captured before a concurrent, unjournaled edit must never be trusted for acceptance.
 */
test("planCommittedChangeAcceptance refuses a stale model that no longer matches the on-disk snapshot", () => {
  const root = createAcceptanceRepo();
  try {
    // Captured before the disk changes again, so it is stale by the time acceptance runs.
    const staleModel = loadNativeModelFromArchContext(root);
    writeYaml(root, nodePath("component.added-after-capture"), {
      schemaVersion: "archcontext.node/v2", id: "component.added-after-capture", kind: "component", name: "Added After Capture", status: "active", parent: CAPABILITY_B
    });

    const capabilityA = {
      capabilityId: CAPABILITY_A,
      memberNodeIds: [CAPABILITY_A],
      semanticFingerprint: digest("5"),
      flowProofFingerprint: digest("6"),
      proofStatus: { p1: "proven" as const, p2: "not-applicable" as const },
      facets: {} as never
    };
    const semanticState: ArchitectureSemanticStateV1 = {
      schemaVersion: "archcontext.architecture-semantic-state/v1",
      capabilities: [capabilityA],
      semanticFingerprint: digestJson([{ capabilityId: capabilityA.capabilityId, semanticFingerprint: capabilityA.semanticFingerprint }] as unknown as Json),
      flowProofFingerprint: digestJson([{ capabilityId: capabilityA.capabilityId, flowProofFingerprint: capabilityA.flowProofFingerprint }] as unknown as Json)
    };
    const manifestBody = JSON.stringify({
      provenance: { sourceTreeDigest: digest("a"), codeGraphDigest: digest("c") },
      semanticBaseline: {
        semanticState,
        digests: { modelDigest: digest("d"), flowProofDigest: semanticState.flowProofFingerprint }
      }
    });
    mkdirSync(join(root, "docs/architecture"), { recursive: true });
    writeFileSync(join(root, MANIFEST), manifestBody, "utf8");

    const journalRef = { journalId: "j1", changeSetId: "changeset.j1" };
    const journalEntry: CommittedChangeSetForTaskSession = {
      journalId: "j1",
      changeSetId: "changeset.j1",
      committedAt: "2026-09-28T00:00:00.000Z",
      files: [{ path: ".archcontext/model/nodes/component.container.yaml", operation: "write", hash: digest("a") }],
      modelTransition: { schemaVersion: "archcontext.changeset-model-transition/v1", before: digest("1"), after: digest("2") }
    };
    const majorChange: ArchitectureMajorChangeClassificationV1 = {
      schemaVersion: "archcontext.major-change-classification/v1",
      mode: "human-action-required",
      reasonCodes: ["node-added"],
      affectedNodeIds: []
    };
    const scope: ArchitectureLedgerScope = {
      repository: { repositoryId: "repo.fixture", storageRepositoryId: "storage.repo.fixture" },
      worktree: { workspaceId: "workspace.fixture", storageWorkspaceId: "storage.workspace.fixture", branch: "main", headSha: "a".repeat(40), worktreeDigest: digest("wt") }
    };

    expect(() => planCommittedChangeAcceptance(root, {
      requested: [journalRef],
      journals: [journalEntry],
      model: staleModel,
      existingFiles: [{ path: MANIFEST, body: manifestBody }],
      latestJournaledManifest: { journalId: "manifest-journal", hash: digestJson({ body: manifestBody } as unknown as Json), projectionOwned: true },
      projection: {
        majorChange,
        rejected: [],
        semanticState,
        architectureDigests: { modelDigest: digest("d") }
      },
      currentEvidence: { sourceTreeDigest: digest("a"), selectorEvidenceDigest: digest("b"), rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION },
      projectionWorktreeDigest: digest("wt"),
      scope
    })).toThrow(/accepted-committed-change-model-snapshot-mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("committed change acceptance v2", () => {
  test("accepts a node addition; only the approval issues the tuple, backed by a record-only v2 event", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add-component", [{ op: "create_entity", path: nodePath("component.added"), body: nodeBody("component.added", { parent: CAPABILITY_B, summary: "Added." }) }]);
      expect(acceptedEvents(fixture)).toHaveLength(0);
      const { preview: planned, approved } = await accept(fixture, [added]);
      expect(acceptedEvents(fixture)).toHaveLength(1);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan).toMatchObject({
        schemaVersion: "archcontext.accepted-committed-change-plan/v1",
        affectedNodeIds: [CAPABILITY_B, "component.added"],
        directlyEditedNodeIds: ["component.added"],
        affectedAncestorNodeIds: [CAPABILITY_B],
        carriedNodeIds: [],
        baselineAnchor: "journal"
      });
      expect(planned.plan.reasonCodes).toContain("node-added");
      expect(planned.plan.baselineAnchorRef).toBe((await fixture.store.readLatestCommittedChangeSetFile(fixture.root, MANIFEST))!.journalId);
      expect(JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8")).semanticBaseline.evidence).toEqual({
        sourceTreeDigest: expect.stringMatching(/^sha256:/), selectorEvidenceDigest: digestJson([]), rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION
      });
      expect(planned.plan.baselineModelDigest).toBe(planned.plan.journals[0].before);
      expect(planned.plan.modelDigest).toBe(digestJson(loadNativeModelFromArchContext(fixture.root) as unknown as Json));
      const data = approved.data as any;
      expect(data).toMatchObject({ status: "accepted", replayed: false, acceptancePlanId: planned.acceptancePlanId, journalIds: [added.journalId] });
      expect(data.acceptedChange).toEqual({
        changeSetId: "changeset.add-component",
        eventId: expect.stringMatching(/^architecture_event\.changeset_accepted\.[a-f0-9]{24}$/),
        reasonCodes: planned.plan.reasonCodes,
        affectedNodeIds: planned.plan.affectedNodeIds
      });
      const [event] = acceptedEvents(fixture);
      expect(event).toMatchObject({
        eventId: data.acceptedChange.eventId,
        payloadVersion: "archcontext.accepted-committed-change/v2",
        payload: {
          operations: [],
          acceptedCommittedChange: {
            schemaVersion: "archcontext.accepted-committed-change/v2",
            journals: planned.plan.journals,
            baselineModelDigest: planned.plan.baselineModelDigest,
            modelDigest: planned.plan.modelDigest,
            acceptancePlanId: planned.acceptancePlanId,
            baselineAnchor: "journal",
            baselineAnchorRef: planned.plan.baselineAnchorRef,
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
      const main = await change(fixture, "changeset.main", [addComponent()]);
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
      expect((approved.data as any).acceptedChange.changeSetId).toBe("changeset.main");
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

  test("accepts a node stored as nodes/<id>.yml, which the model loader reads", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.yml", [{ op: "create_entity", path: ".archcontext/model/nodes/component.yml-node.yml", body: nodeBody("component.yml-node", { parent: CAPABILITY_B }) }]);
      const { preview: planned, approved } = await accept(fixture, [added]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan.directlyEditedNodeIds).toEqual(["component.yml-node"]);
    });
  }, TIMEOUT);

  test("one event per baseline and model at a snapshot: a same-plan retry returns it, a padded journal list is refused", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const noop = await change(fixture, "changeset.noop", [noopRewrite(fixture.root, nodePath("component.child"))]);
      const noopJournal = await fixture.store.readCommittedChangeSet(fixture.root, noop.journalId);
      expect(noopJournal?.modelTransition?.before).toBe(noopJournal?.modelTransition?.after);

      const first = await accept(fixture, [added]);
      expect(first.approved.ok, JSON.stringify(first.approved)).toBe(true);
      const retry = await approve(fixture, [added], first.preview);
      expect(retry.ok, JSON.stringify(retry)).toBe(true);
      expect(retry.data).toMatchObject({ status: "accepted", replayed: true, acceptedChange: (first.approved.data as any).acceptedChange, eventHash: (first.approved.data as any).eventHash });

      // No-op semantic journals remain valid links, but cannot mint a second event for the same (B, C).
      const padded = await preview(fixture, [added, noop]);
      expect(padded.ok, JSON.stringify(padded)).toBe(true);
      expect((padded.data as any).acceptancePlanId).not.toBe(first.preview.acceptancePlanId);
      const paddedApproval = await approve(fixture, [added, noop], padded.data);
      expect(paddedApproval.ok).toBe(false);
      expect((paddedApproval as any).error.message).toMatch(/already has a different acceptance event at this snapshot/);
      expect(acceptedEvents(fixture)).toHaveLength(1);

      commitAll(fixture.root, "commit accepted change");
      const second = await accept(fixture, [added, noop]);
      expect(second.approved.ok, JSON.stringify(second.approved)).toBe(true);
      expect(second.preview.plan.headSha).not.toBe(first.preview.plan.headSha);
      expect((second.approved.data as any).acceptedChange.eventId).not.toBe((first.approved.data as any).acceptedChange.eventId);
      expect(acceptedEvents(fixture)).toHaveLength(2);
    });
  }, TIMEOUT);

  test("hand edits before, between or after the journals break the chain", async () => {
    await withFixture(async (fixture) => {
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "Hand edit." }), "utf8");
      const afterHandEdit = await change(fixture, "changeset.after-hand-edit", [addComponent()]);
      await expectRefused(fixture, [afterHandEdit], /chain-baseline-mismatch/);
    });
    await withFixture(async (fixture) => {
      const first = await change(fixture, "changeset.first", [addComponent()]);
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "Hand edit." }), "utf8");
      const second = await change(fixture, "changeset.second", [editNode(fixture.root, "component.added", { summary: "Second." })]);
      await expectRefused(fixture, [first, second], /chain-gap/);
    });
    await withFixture(async (fixture) => {
      const first = await change(fixture, "changeset.first", [addComponent()]);
      const second = await change(fixture, "changeset.second", [editNode(fixture.root, "component.added", { summary: "Second." })]);
      const unbroken = await preview(fixture, [first, second]);
      expect(unbroken.ok, JSON.stringify(unbroken)).toBe(true);
      writeFileSync(join(fixture.root, nodePath("component.added")), nodeBody("component.added", { parent: CAPABILITY_B, summary: "Trailing hand edit." }), "utf8");
      await expectRefused(fixture, [first, second], /chain-current-mismatch/);
    });
  }, TIMEOUT * 3);

  test("refuses journals from before the baseline, other roots, pending, aborted, mismatched, out of order or without transitions", async () => {
    await withFixture(async (fixture) => {
      const early = await change(fixture, "changeset.early", [addComponent("component.early")]);
      await baseline(fixture);
      const later = await change(fixture, "changeset.later", [addComponent("component.later")]);
      await expectRefused(fixture, [early, later], /chain-baseline-mismatch/);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 5));
      const latest = await change(fixture, "changeset.latest", [editNode(fixture.root, "component.later", { summary: "Latest." })]);
      await expectRefused(fixture, [latest, later], /journal-out-of-order/);
      await expectRefused(fixture, [{ ...later, changeSetId: "changeset.other" }], /journal-id-mismatch/);

      const otherRoot = createAcceptanceRepo();
      try {
        const foreign = await change(fixture, "changeset.foreign", [addComponent("component.foreign")], otherRoot);
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
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const outside = mkdtempSync(join(tmpdir(), "archctx-accept-v2-link-"));
      try {
        const target = join(outside, "component.added.yaml");
        writeFileSync(target, readFileSync(join(fixture.root, nodePath("component.added")), "utf8"), "utf8");
        rmSync(join(fixture.root, nodePath("component.added")));
        symlinkSync(target, join(fixture.root, nodePath("component.added")));
        await expectRefused(fixture, [added], /semantic-model-entry-not-regular/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
    await withFixture(async (fixture) => {
      const unprovable = await change(fixture, "changeset.drop-relation", [{ op: "delete_entity", path: ".archcontext/model/relations/relation.session-store.yaml" }]);
      await expectRefused(fixture, [unprovable], /proof-unprovable/);
    });
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      writeFileSync(join(fixture.root, "docs/architecture/modules/runtime-harness/session-store.md"), "# hand written\n", "utf8");
      await expectRefused(fixture, [added], /projection-rejected/);
    });
  }, TIMEOUT * 4);

  test("the chain anchor must be the committed or latest journaled projection manifest", async () => {
    // Probe P2: a hand edit rides a journal once the manifest's baseline digest is forged to match it.
    await withFixture(async (fixture) => {
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "HAND EDIT NOT JOURNALED." }), "utf8");
      const handDigest = digestJson(loadNativeModelFromArchContext(fixture.root) as unknown as Json);
      const journaled = await change(fixture, "changeset.after-hand", [addComponent()]);
      await expectRefused(fixture, [journaled], /chain-baseline-mismatch/);
      const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      manifest.semanticBaseline.digests.modelDigest = handDigest;
      writeFileSync(join(fixture.root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await expectRefused(fixture, [journaled], /baseline-unanchored/);
      expect(acceptedEvents(fixture)).toHaveLength(0);
    });
    // Opus R2-1: a replace ref that substitutes the forged blob for HEAD's committed one anchors nothing.
    await withFixture(async (fixture) => {
      commitAll(fixture.root, "commit baseline projection");
      const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const committedBlob = git("rev-parse", `HEAD:${MANIFEST}`);
      writeFileSync(join(fixture.root, nodePath("component.child")), nodeBody("component.child", { parent: "component.container", summary: "HAND EDIT NOT JOURNALED." }), "utf8");
      const handDigest = digestJson(loadNativeModelFromArchContext(fixture.root) as unknown as Json);
      const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      manifest.semanticBaseline.digests.modelDigest = handDigest;
      writeFileSync(join(fixture.root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const journaled = await change(fixture, "changeset.after-hand", [addComponent()]);
      await expectRefused(fixture, [journaled], /baseline-unanchored/);
      git("replace", committedBlob, git("hash-object", "-w", MANIFEST));
      expect(execFileSync("git", ["cat-file", "blob", `HEAD:${MANIFEST}`], { cwd: fixture.root, encoding: "utf8" })).toBe(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      await expectRefused(fixture, [journaled], /baseline-unanchored/);
      expect(acceptedEvents(fixture)).toHaveLength(0);
    });
    // Anchors compare raw bytes: invalid UTF-8 (0xff) never equals a committed U+FFFD.
    await withFixture(async (fixture) => {
      const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      writeFileSync(join(fixture.root, MANIFEST), `${JSON.stringify({ ...manifest, note: "\uFFFD" }, null, 2)}\n`, "utf8");
      commitAll(fixture.root, "commit manifest with U+FFFD");
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const committed = readFileSync(join(fixture.root, MANIFEST));
      const replacement = Buffer.from("\uFFFD", "utf8");
      const at = committed.indexOf(replacement);
      writeFileSync(join(fixture.root, MANIFEST), Buffer.concat([committed.subarray(0, at), Buffer.from([0xff]), committed.subarray(at + replacement.length)]));
      expect(readFileSync(join(fixture.root, MANIFEST), "utf8")).toBe(committed.toString("utf8"));
      await expectRefused(fixture, [added], /not-utf8/);
    });
    // Restoring an older journaled baseline by hand is not the latest journaled write either.
    await withFixture(async (fixture) => {
      const olderManifest = readFileSync(join(fixture.root, MANIFEST), "utf8");
      const first = await change(fixture, "changeset.first", [addComponent("component.first")]);
      await baseline(fixture);
      writeFileSync(join(fixture.root, MANIFEST), olderManifest, "utf8");
      await expectRefused(fixture, [first], /baseline-unanchored/);
    });
    // A committed manifest anchors the chain for a store that never journaled it.
    const root = createAcceptanceRepo();
    const seeded = await startDaemon();
    try {
      await baseline({ root, ...seeded });
      commitAll(root, "baseline projection");
    } finally {
      await seeded.daemon.stop();
    }
    const fresh = await startDaemon();
    const fixture = { root, ...fresh };
    try {
      expect(await fresh.store.readLatestCommittedChangeSetFile(root, MANIFEST)).toBeUndefined();
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const { preview: planned, approved } = await accept(fixture, [added]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan.baselineAnchor).toBe("head");
      expect(planned.plan.baselineAnchorRef).toBe(planned.plan.headSha);
      expect(planned.plan.headSha).toBe(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
      expect(acceptedEvents(fixture)[0]).toMatchObject({ headSha: planned.plan.headSha, payload: { acceptedCommittedChange: { baselineAnchor: "head", baselineAnchorRef: planned.plan.headSha } } });
    } finally {
      await fresh.daemon.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, TIMEOUT * 3);

  test("a journaled manifest write that the projection owner did not make anchors nothing", async () => {
    // Forgery: hand-edit a capability's model, then get an approved ChangeSet to journal a manifest that keeps
    // the OLD semantic state but claims the hand-edited model digest, then journal one real change.
    // `planUpdate` is the public entry: a caller-authored `render_projection` carries its own bytes verbatim,
    // so an operation kind alone cannot tell the projection owner from a caller.
    for (const via of ["update_entity_fields", "render_projection"] as const) {
      await withFixture(async (fixture) => {
        const hand = editNode(fixture.root, "component.container", { source: { include: ["README.md"] } });
        writeFileSync(join(fixture.root, hand.path), hand.body!, "utf8");
        const handDigest = digestJson(loadNativeModelFromArchContext(fixture.root) as unknown as Json);
        const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
        manifest.semanticBaseline.digests.modelDigest = handDigest;
        const forged = `${JSON.stringify(manifest, null, 2)}\n`;
        const expectedHash = currentHash(fixture.root, MANIFEST);
        const forgedId = `changeset.forged-manifest-${via}`;
        const plan = await fixture.daemon.planUpdate(fixture.root, {
          id: forgedId,
          operations: [via === "render_projection"
            ? { op: "render_projection", expectedHash: "missing", projectionFiles: [{ path: MANIFEST, expectedHash, body: forged }] }
            : { op: "update_entity_fields", path: MANIFEST, expectedHash, body: forged }]
        });
        expect(plan.ok, JSON.stringify(plan)).toBe(true);
        const applied = await fixture.daemon.applyUpdate(fixture.root, { id: forgedId, approved: true, expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest });
        expect(applied.ok, JSON.stringify(applied)).toBe(true);
        expect(readFileSync(join(fixture.root, MANIFEST), "utf8")).toBe(forged);
        const journaled = await change(fixture, "changeset.after-forged-manifest", [addComponent()]);
        await expectRefused(fixture, [journaled], /baseline-unanchored/);
        expect(acceptedEvents(fixture)).toHaveLength(0);
        // The forged write is the latest journaled manifest write, but it was not made by the projection owner.
        expect(await fixture.store.readLatestCommittedChangeSetFile(fixture.root, MANIFEST)).toMatchObject({ journalId: (applied.data as any).journalId, hash: digestJson({ body: forged }), projectionOwned: false });
      });
    }
  }, TIMEOUT * 2);

  test("a projection-owned manifest write anchors, and a later forged write does not inherit that trust", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const previewed = await preview(fixture, [added]);
      expect(previewed.ok, JSON.stringify(previewed)).toBe(true);
      expect((previewed.data as any).plan.baselineAnchor).toBe("journal");
      expect(await fixture.store.readLatestCommittedChangeSetFile(fixture.root, MANIFEST)).toMatchObject({ journalId: (previewed.data as any).plan.baselineAnchorRef, projectionOwned: true });
      // The same bytes re-journaled through a caller-planned ChangeSet are a new, unowned latest write.
      const body = readFileSync(join(fixture.root, MANIFEST), "utf8");
      const rewrite = await change(fixture, "changeset.rewrite-manifest", [{ op: "update_entity_fields", path: MANIFEST, body }]);
      await expectRefused(fixture, [added], /baseline-unanchored/);
      expect(await fixture.store.readLatestCommittedChangeSetFile(fixture.root, MANIFEST)).toMatchObject({ journalId: rewrite.journalId, projectionOwned: false });
      // A committed manifest is still anchored by HEAD whoever journaled it last.
      commitAll(fixture.root, "commit manifest");
      const committedAdd = await change(fixture, "changeset.add-after-commit", [addComponent("component.after-commit")]);
      const anchored = await preview(fixture, [added, committedAdd]);
      expect(anchored.ok, JSON.stringify(anchored)).toBe(true);
      expect((anchored.data as any).plan.baselineAnchor).toBe("head");
    });
  }, TIMEOUT * 2);

  test("re-planning a projection draft's id through the public entry does not inherit the projection marker", async () => {
    await withFixture(async (fixture) => {
      const id = "changeset.replanned-projection";
      const projected = await fixture.daemon.docsProjection(fixture.root, { action: "plan", profile: "repo-harness/v1", id });
      expect(projected.ok, JSON.stringify(projected)).toBe(true);
      const hand = editNode(fixture.root, "component.container", { source: { include: ["README.md"] } });
      writeFileSync(join(fixture.root, hand.path), hand.body!, "utf8");
      const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      manifest.semanticBaseline.digests.modelDigest = digestJson(loadNativeModelFromArchContext(fixture.root) as unknown as Json);
      const forged = `${JSON.stringify(manifest, null, 2)}\n`;
      // Same id as the daemon-planned draft: the stored draft is replaced by a caller-authored object.
      const plan = await fixture.daemon.planUpdate(fixture.root, {
        id,
        operations: [{ op: "render_projection", expectedHash: "missing", projectionFiles: [{ path: MANIFEST, expectedHash: currentHash(fixture.root, MANIFEST), body: forged }] }]
      });
      expect(plan.ok, JSON.stringify(plan)).toBe(true);
      const applied = await fixture.daemon.applyUpdate(fixture.root, { id, approved: true, expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest });
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      const journaled = await change(fixture, "changeset.after-replanned", [addComponent()]);
      await expectRefused(fixture, [journaled], /baseline-unanchored/);
      expect(await fixture.store.readLatestCommittedChangeSetFile(fixture.root, MANIFEST)).toMatchObject({ journalId: (applied.data as any).journalId, projectionOwned: false });
    });
  }, TIMEOUT * 2);

  test("a proof-only model change is accepted while evidence holds, and refused once source evidence moved", async () => {
    const toModule = (root: string) => editNode(root, "component.child", { kind: "module" });
    await withFixture(async (fixture) => {
      const kind = await change(fixture, "changeset.kind", [toModule(fixture.root)]);
      const { preview: planned, approved } = await accept(fixture, [kind]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
      expect(planned.plan).toMatchObject({ reasonCodes: ["verified-flow-proof-changed"], affectedNodeIds: [CAPABILITY_A], directlyEditedNodeIds: ["component.child"] });
    }, { capabilityASource: true });
    await withFixture(async (fixture) => {
      const kind = await change(fixture, "changeset.kind", [toModule(fixture.root)]);
      writeFileSync(join(fixture.root, "README.md"), "# acceptance fixture, source changed\n", "utf8");
      await expectRefused(fixture, [kind], new RegExp(`proof-change-unexplained: ${CAPABILITY_A}`));
      // A journaled rewrite of the capability's flow no longer explains an evidence change.
      const flowPath = ".archcontext/model/flows/flow.hook-adapters.yaml";
      const flowRewrite = await change(fixture, "changeset.flow-noop", [noopRewrite(fixture.root, flowPath)]);
      await expectRefused(fixture, [kind, flowRewrite], new RegExp(`proof-change-unexplained: ${CAPABILITY_A}`));
    }, { capabilityASource: true });
  }, TIMEOUT * 2);

  test("a manifest written before recorded evidence refuses proof-only changes but still accepts semantic ones", async () => {
    await withFixture(async (fixture) => {
      const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      delete manifest.semanticBaseline.evidence;
      writeFileSync(join(fixture.root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      commitAll(fixture.root, "legacy manifest without recorded evidence");
      const kind = await change(fixture, "changeset.kind", [editNode(fixture.root, "component.child", { kind: "module" })]);
      await expectRefused(fixture, [kind], new RegExp(`proof-change-unexplained: ${CAPABILITY_A}`));
    }, { capabilityASource: true });
    await withFixture(async (fixture) => {
      const manifest = JSON.parse(readFileSync(join(fixture.root, MANIFEST), "utf8"));
      delete manifest.semanticBaseline.evidence;
      writeFileSync(join(fixture.root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      commitAll(fixture.root, "legacy manifest without recorded evidence");
      const owned = await change(fixture, "changeset.ownership", [editNode(fixture.root, "component.container", { source: { include: ["README.md"] } })]);
      const { approved } = await accept(fixture, [owned]);
      expect(approved.ok, JSON.stringify(approved)).toBe(true);
    });
  }, TIMEOUT * 2);

  test("after the journals commit, byte and symlink swaps in the semantic set refuse at preview and approve", async () => {
    // Round-3 F2: every acceptance-side read is strict: regular files only, valid UTF-8 only.
    const swapReplacementForFf = (file: string) => {
      const valid = readFileSync(file);
      const replacement = Buffer.from("\uFFFD", "utf8");
      const at = valid.indexOf(replacement);
      expect(at).toBeGreaterThanOrEqual(0);
      writeFileSync(file, Buffer.concat([valid.subarray(0, at), Buffer.from([0xff]), valid.subarray(at + replacement.length)]));
      expect(readFileSync(file, "utf8")).toBe(valid.toString("utf8"));
    };
    const refusesBothWays = async (fixture: Fixture, journals: { journalId: string; changeSetId: string }[], tamper: () => void, message: RegExp) => {
      const previewed = await preview(fixture, journals);
      expect(previewed.ok, JSON.stringify(previewed)).toBe(true);
      tamper();
      const approved = await approve(fixture, journals, previewed.data);
      expect(approved.ok).toBe(false);
      expect((approved as any).error.message).toMatch(message);
      await expectRefused(fixture, journals, message);
      expect(acceptedEvents(fixture)).toHaveLength(0);
    };
    await withFixture(async (fixture) => {
      const edited = await change(fixture, "changeset.replacement-char", [editNode(fixture.root, "component.child", { summary: "Child \uFFFD marker." })]);
      await refusesBothWays(fixture, [edited], () => swapReplacementForFf(join(fixture.root, nodePath("component.child"))), /not-utf8/);
    });
    await withFixture(async (fixture) => {
      writeFileSync(join(fixture.root, nodePath("component.container")), nodeBody("component.container", {
        parent: CAPABILITY_A, summary: "Container \uFFFD.", ownership: { lifecycle: ["team-architecture"] }
      }), "utf8");
      await baseline(fixture);
      const added = await change(fixture, "changeset.add", [addComponent()]);
      await refusesBothWays(fixture, [added], () => swapReplacementForFf(join(fixture.root, nodePath("component.container"))), /not-utf8/);
    });
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const outside = mkdtempSync(join(tmpdir(), "archctx-accept-v2-unjournaled-link-"));
      try {
        await refusesBothWays(fixture, [added], () => {
          const target = join(outside, "component.child.yaml");
          writeFileSync(target, readFileSync(join(fixture.root, nodePath("component.child"))));
          rmSync(join(fixture.root, nodePath("component.child")));
          symlinkSync(target, join(fixture.root, nodePath("component.child")));
        }, /not-regular/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  }, TIMEOUT * 3);

  test("approval must match the previewed worktree digest and plan id; HEAD or baseline moves invalidate the preview", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const previewed = (await preview(fixture, [added])).data as any;
      expect(previewed.expectedWorktreeDigest).toBe(architectureDocumentationProjectionWorktreeDigest(fixture.root, loadNativeModelFromArchContext(fixture.root)));
      expect(((await approve(fixture, [added], previewed, { expectedWorktreeDigest: digest("d") })) as any).error.message).toMatch(/expected worktree digest mismatch/);
      expect(((await approve(fixture, [added], previewed, { acceptancePlanId: digest("e") })) as any).error.message).toMatch(/acceptance plan changed since preview/);

      // HEAD is covered by the plan but not by the chain or the worktree digest.
      commitAll(fixture.root, "move HEAD after preview");
      const afterCommit = await approve(fixture, [added], previewed);
      expect(afterCommit.ok).toBe(false);
      expect((afterCommit as any).error.message).toMatch(/acceptance plan changed since preview/);

      const current = (await preview(fixture, [added])).data as any;
      await baseline(fixture);
      const stale = await approve(fixture, [added], current);
      expect(stale.ok).toBe(false);
      expect((stale as any).error.message).toMatch(/chain-baseline-mismatch|acceptance plan changed/);
      expect(acceptedEvents(fixture)).toHaveLength(0);
    });
  }, TIMEOUT);

  test("refuses non-YAML ledger modes and the retired request shape", async () => {
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const refused = await fixture.daemon.acceptCommittedChange(fixture.root, { journals: [added] });
      expect((refused as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED", message: expect.stringMatching(/YAML read and write authority/) });
    }, { rolloutMode: "dual" });
    await withFixture(async (fixture) => {
      const added = await change(fixture, "changeset.add", [addComponent()]);
      const retired = await fixture.daemon.acceptCommittedChange(fixture.root, {
        journalId: added.journalId, changeSetId: added.changeSetId, approved: true, expectedWorktreeDigest: digest("a")
      } as any);
      expect((retired as any).error).toMatchObject({ code: "AC_SCHEMA_INVALID" });
    });
  }, TIMEOUT * 2);
});

describe("model transition evidence reads one snapshot", () => {
  const draft = (path: string, body: string) => ({ operations: [{ op: "update_entity_fields", path, expectedHash: "unused", body }] }) as unknown as ChangeSetDraft;
  const recorder = () => {
    const recorded: unknown[] = [];
    return { recorded, store: { recordChangeSetModelTransition: async (_journalId: string, transition: unknown) => { recorded.push(transition); } } };
  };
  const modelRoot = () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-transition-snapshot-"));
    mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
    writeFileSync(join(root, nodePath("component.a")), nodeBody("component.a", { summary: "A1." }));
    writeFileSync(join(root, nodePath("component.b")), nodeBody("component.b", { summary: "B1." }));
    return root;
  };

  test("the recorded after digest is the model parsed from the exact bytes that were checked", async () => {
    const root = modelRoot();
    try {
      const a2 = nodeBody("component.a", { summary: "A2 journaled." });
      const base = captureModelTransitionBase(root, draft(nodePath("component.a"), a2))!;
      expect(base.before).toBe(digestJson(loadNativeModelFromArchContext(root) as unknown as Json));
      writeFileSync(join(root, nodePath("component.a")), a2);
      const { recorded, store } = recorder();
      expect(await recordModelTransitionEvidence(store, root, "journal.snapshot", base)).toBe(true);
      expect(recorded).toEqual([{ schemaVersion: "archcontext.changeset-model-transition/v1", before: base.before, after: digestJson(loadNativeModelFromArchContext(root) as unknown as Json) }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Probe P3: a FIFO served one body to the hash pass and another to the model reload.
  test.skipIf(process.platform === "win32")("a FIFO standing in for an unwritten model file records nothing", async () => {
    const root = modelRoot();
    try {
      const a2 = nodeBody("component.a", { summary: "A2 journaled." });
      const b1 = nodeBody("component.b", { summary: "B1." });
      const base = captureModelTransitionBase(root, draft(nodePath("component.a"), a2))!;
      writeFileSync(join(root, nodePath("component.a")), a2);
      const fifo = join(root, nodePath("component.b"));
      rmSync(fifo);
      execFileSync("mkfifo", [fifo]);
      const feeder = Bun.spawn(["sh", "-c", 'printf "%s" "$B1" > "$F"; printf "%s" "$B2" > "$F"'], {
        env: { ...process.env, B1: b1, B2: nodeBody("component.b", { summary: "B2 HAND EDIT." }), F: fifo }
      });
      const { recorded, store } = recorder();
      expect(await recordModelTransitionEvidence(store, root, "journal.fifo", base)).toBe(false);
      expect(recorded).toEqual([]);
      feeder.kill();
      await feeder.exited;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("each model file is read exactly once per snapshot and the model is built from those bytes", async () => {
    const root = modelRoot();
    try {
      const a2 = nodeBody("component.a", { summary: "A2 journaled." });
      const substitute = nodeBody("component.b", { summary: "Bytes served by the reader, not on disk." });
      const reads: string[] = [];
      const reader = (absolute: string, path: string) => {
        reads.push(path);
        return path === nodePath("component.b") ? Buffer.from(substitute) : readFileSync(absolute);
      };
      const base = captureModelTransitionBase(root, draft(nodePath("component.a"), a2), reader)!;
      expect(reads.sort()).toEqual([nodePath("component.a"), nodePath("component.b")]);
      const served = (a: string) => new Map([[nodePath("component.a"), a], [nodePath("component.b"), substitute]]);
      expect(base.before).toBe(digestJson(loadNativeModelFromModelFiles(served(nodeBody("component.a", { summary: "A1." }))) as unknown as Json));
      expect(base.before).not.toBe(digestJson(loadNativeModelFromArchContext(root) as unknown as Json));
      // Capture side: the byte hashes come from the served bytes too, not from a second disk read.
      const hash = (body: string) => digestJson({ body } as unknown as Json);
      expect(base.files).toEqual(new Map([[nodePath("component.a"), hash(nodeBody("component.a", { summary: "A1." }))], [nodePath("component.b"), hash(substitute)]]));
      writeFileSync(join(root, nodePath("component.a")), a2);
      reads.length = 0;
      const { recorded, store } = recorder();
      expect(await recordModelTransitionEvidence(store, root, "journal.seam", base, reader)).toBe(true);
      expect(reads.sort()).toEqual([nodePath("component.a"), nodePath("component.b")]);
      expect((recorded[0] as { after: string }).after).toBe(digestJson(loadNativeModelFromModelFiles(served(a2)) as unknown as Json));
      // Record side: an independently stated base that expects the served bytes, never the disk's.
      const statedBase = { before: base.before, files: new Map([[nodePath("component.a"), hash(nodeBody("component.a", { summary: "A1." }))], [nodePath("component.b"), hash(substitute)]]), expectedWrites: base.expectedWrites };
      const second = recorder();
      expect(await recordModelTransitionEvidence(second.store, root, "journal.seam-stated", statedBase, reader)).toBe(true);
      expect(await recordModelTransitionEvidence(second.store, root, "journal.seam-disk", statedBase)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a model file that is not valid UTF-8 yields no base and records nothing", async () => {
    const root = modelRoot();
    try {
      const a2 = nodeBody("component.a", { summary: "A2 journaled." });
      const base = captureModelTransitionBase(root, draft(nodePath("component.a"), a2))!;
      writeFileSync(join(root, nodePath("component.a")), a2);
      const valid = Buffer.from(nodeBody("component.b", { summary: "B \uFFFD." }), "utf8");
      const replacement = Buffer.from("\uFFFD", "utf8");
      const at = valid.indexOf(replacement);
      const invalid = Buffer.concat([valid.subarray(0, at), Buffer.from([0xff]), valid.subarray(at + replacement.length)]);
      writeFileSync(join(root, nodePath("component.b")), invalid);
      // The lossy directory loader cannot tell the two apart; the evidence snapshot refuses.
      expect(readFileSync(join(root, nodePath("component.b")), "utf8")).toBe(valid.toString("utf8"));
      const { recorded, store } = recorder();
      expect(await recordModelTransitionEvidence(store, root, "journal.utf8", base)).toBe(false);
      expect(recorded).toEqual([]);
      expect(captureModelTransitionBase(root, draft(nodePath("component.a"), nodeBody("component.a", { summary: "A3." })))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a symlinked model entry records nothing and yields no base", async () => {
    const root = modelRoot();
    const outside = mkdtempSync(join(tmpdir(), "archctx-transition-link-"));
    try {
      const a2 = nodeBody("component.a", { summary: "A2 journaled." });
      const base = captureModelTransitionBase(root, draft(nodePath("component.a"), a2))!;
      writeFileSync(join(root, nodePath("component.a")), a2);
      writeFileSync(join(outside, "component.b.yaml"), readFileSync(join(root, nodePath("component.b")), "utf8"));
      rmSync(join(root, nodePath("component.b")));
      symlinkSync(join(outside, "component.b.yaml"), join(root, nodePath("component.b")));
      const { recorded, store } = recorder();
      expect(await recordModelTransitionEvidence(store, root, "journal.symlink", base)).toBe(false);
      expect(recorded).toEqual([]);
      expect(captureModelTransitionBase(root, draft(nodePath("component.a"), nodeBody("component.a", { summary: "A3." })))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
