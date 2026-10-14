import { expect, test } from "bun:test";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH,
  projectionTargetChangesIssues,
  type ArchitectureDocsProjectionManifestCapabilityV3,
  type ArchitectureDocsProjectionManifestTargetV3,
  type ArchitectureDocsProjectionManifestV3,
  type ProjectionFileResultV1,
  type ProjectionTargetChangeV1
} from "@archcontext/contracts";
import { classifyProjectionTargetChanges, type ProjectionTargetChangeInput } from "../src/projection-target-changes";

/**
 * #327 finding 2: the per-target classification over synthetic committed and rendered states.
 * Every case also passes the contract's own invariants against the files it was given.
 */

const digest = (fill: string) => `sha256:${fill.repeat(64)}` as const;
const A = "capability.flows.alpha";
const B = "capability.flows.beta";
const C = "capability.flows.gamma";
const INDEX = "projection_target.architecture.index";
const MERMAID = "projection_target.diagram.mermaid";
const ENTITY_A = "projection_target.entity.alpha";
const ENTITY_B = "projection_target.entity.beta";
const ENTITY_C = "projection_target.entity.gamma";
const PATH = {
  [INDEX]: "docs/architecture/index.md",
  [MERMAID]: "docs/architecture/diagrams/architecture.mmd",
  [ENTITY_A]: "docs/architecture/modules/flows/alpha.md",
  [ENTITY_B]: "docs/architecture/modules/flows/beta.md",
  [ENTITY_C]: "docs/architecture/modules/flows/gamma.md"
} as const;

function capability(capabilityId: string, members: string[], overrides: Partial<ArchitectureDocsProjectionManifestCapabilityV3> = {}): ArchitectureDocsProjectionManifestCapabilityV3 {
  return {
    capabilityId,
    memberNodeIds: [capabilityId, ...members].sort(),
    semanticFingerprint: digest("a"),
    flowProofFingerprint: digest("b"),
    proofStatus: { p1: "proven", p2: "proven" },
    facets: {} as ArchitectureDocsProjectionManifestCapabilityV3["facets"],
    selectorEvidenceDigest: digest("c"),
    ...overrides
  };
}

function entityRow(targetId: keyof typeof PATH, nodeId: string, stamps: Record<string, string>, outputDigest = digest("1")): ArchitectureDocsProjectionManifestTargetV3 {
  return { type: "entity-summary", scope: { kind: "entity", id: nodeId, entityKind: "capability" }, path: PATH[targetId], ownership: "mixed", format: "markdown", outputDigest, sourceStamps: stamps };
}

function baseRows(): Record<string, ArchitectureDocsProjectionManifestTargetV3> {
  return {
    [INDEX]: { type: "architecture-index", scope: { kind: "repository" }, path: PATH[INDEX], ownership: "mixed", format: "markdown", outputDigest: digest("2") },
    [MERMAID]: { type: "diagram-mermaid", scope: { kind: "diagram", id: "architecture" }, path: PATH[MERMAID], ownership: "generated", format: "mermaid", outputDigest: digest("3") },
    [ENTITY_A]: entityRow(ENTITY_A, A, { [A]: digest("4"), [`${A}.child`]: digest("5") }),
    [ENTITY_B]: entityRow(ENTITY_B, B, { [B]: digest("6") }, digest("7"))
  };
}

function manifest(capabilities = [capability(A, [`${A}.child`]), capability(B, [])], targets = baseRows()): ArchitectureDocsProjectionManifestV3 {
  return {
    schemaVersion: "archcontext.architecture-docs-projection-manifest/v3",
    rendererVersion: "archcontext.docs-renderer/v6",
    profile: "repo-harness/v1",
    layoutVersion: "archcontext.docs-layout/v1",
    generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1" },
    semanticBaseline: { modelDigest: digest("d"), capabilities },
    targets
  };
}

/** The committed state rendered again unchanged: same rows, same capabilities, nothing to write. */
function unchangedInput(): ProjectionTargetChangeInput {
  const committed = manifest();
  return {
    committed,
    renderedTargets: baseRows(),
    capabilities: committed.semanticBaseline.capabilities.map(({ selectorEvidenceDigest: _selectorEvidenceDigest, ...entry }) => entry),
    selectorEvidenceDigests: Object.fromEntries(committed.semanticBaseline.capabilities.map((entry) => [entry.capabilityId, entry.selectorEvidenceDigest])),
    files: [],
    rejected: [],
    orphans: [],
    blockedTargets: []
  };
}

function write(path: string, action: "create" | "update" | "delete"): ProjectionFileResultV1 {
  return action === "create"
    ? { path, action, preimageDigest: null, outputDigest: digest("e") }
    : action === "delete"
      ? { path, action, preimageDigest: digest("f"), outputDigest: null }
      : { path, action, preimageDigest: digest("f"), outputDigest: digest("e") };
}

const MANIFEST_WRITE = write(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, "update");

function classify(input: ProjectionTargetChangeInput): Map<string, ProjectionTargetChangeV1> {
  const changes = classifyProjectionTargetChanges(input);
  expect(projectionTargetChangesIssues(changes, input.files)).toEqual([]);
  // Every planned doc write or delete is one change, and the manifest is never a target.
  expect(changes.filter((entry) => entry.plannedAction !== "none").map((entry) => entry.path))
    .toEqual(input.files.filter((file) => file.path !== ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH && !input.rejected.some((entry) => entry.path === file.path)).map((file) => file.path).sort());
  expect(changes.map((entry) => entry.path)).not.toContain(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
  return new Map(changes.map((entry) => [entry.targetId, entry]));
}

const summary = (entry: ProjectionTargetChangeV1 | undefined) => entry && ({ classification: entry.classification, plannedAction: entry.plannedAction, reasonCodes: entry.reasonCodes, affectedCapabilityIds: entry.affectedCapabilityIds });

test("the committed state rendered again classifies every target unchanged", () => {
  const changes = classify(unchangedInput());
  expect([...changes.keys()].sort()).toEqual([ENTITY_A, ENTITY_B, INDEX, MERMAID].sort());
  for (const entry of changes.values()) {
    expect(entry).toMatchObject({ classification: "unchanged", plannedAction: "none", reasonCodes: [], affectedCapabilityIds: [], stampChanged: false, outputChanged: false, semanticChanged: false, proofChanged: false });
  }
});

test("a source edit that moves only a stamp is stamp-only, writes no document and names its capability", () => {
  const input = unchangedInput();
  input.renderedTargets[ENTITY_A] = entityRow(ENTITY_A, A, { [A]: digest("4"), [`${A}.child`]: digest("9") });
  input.files = [MANIFEST_WRITE];
  const changes = classify(input);
  expect(summary(changes.get(ENTITY_A))).toEqual({ classification: "stamp-only", plannedAction: "none", reasonCodes: ["source-stamp-changed"], affectedCapabilityIds: [A] });
  for (const targetId of [ENTITY_B, INDEX, MERMAID]) expect(changes.get(targetId)!.classification).toBe("unchanged");
});

test("a changed rendered output is output-change and its plannedAction is the files[] action", () => {
  const input = unchangedInput();
  input.renderedTargets[ENTITY_B] = entityRow(ENTITY_B, B, { [B]: digest("8") }, digest("9"));
  input.files = [MANIFEST_WRITE, write(PATH[ENTITY_B], "update")];
  expect(summary(classify(input).get(ENTITY_B))).toEqual({ classification: "output-change", plannedAction: "update", reasonCodes: ["rendered-output-changed", "source-stamp-changed"], affectedCapabilityIds: [B] });
});

test("a write whose rendered output equals the committed row (marker or bytes only) is output-change, never unchanged", () => {
  const input = unchangedInput();
  input.files = [write(PATH[INDEX], "update"), write(PATH[MERMAID], "create")];
  const changes = classify(input);
  expect(summary(changes.get(INDEX))).toEqual({ classification: "output-change", plannedAction: "update", reasonCodes: ["file-bytes-changed"], affectedCapabilityIds: [] });
  expect(summary(changes.get(MERMAID))).toEqual({ classification: "output-change", plannedAction: "create", reasonCodes: ["file-bytes-changed"], affectedCapabilityIds: [] });
});

test("a semantic delta with unchanged rendered bytes is semantic-change on its documents and the repository-wide targets", () => {
  const input = unchangedInput();
  input.capabilities = input.capabilities.map((entry) => entry.capabilityId === A ? { ...entry, semanticFingerprint: digest("9") } : entry);
  input.files = [MANIFEST_WRITE];
  const changes = classify(input);
  expect(summary(changes.get(ENTITY_A))).toEqual({ classification: "semantic-change", plannedAction: "none", reasonCodes: ["semantic-fingerprint-changed"], affectedCapabilityIds: [A] });
  for (const targetId of [INDEX, MERMAID]) {
    expect(summary(changes.get(targetId))).toEqual({ classification: "semantic-change", plannedAction: "none", reasonCodes: ["semantic-fingerprint-changed"], affectedCapabilityIds: [A] });
  }
  expect(changes.get(ENTITY_B)!.classification).toBe("unchanged");
});

test("a proof change with no bytes to write is proof-change on the capability's documents only", () => {
  for (const [field, reason] of [["flowProofFingerprint", "flow-proof-changed"], ["selectorEvidenceDigest", "selector-evidence-changed"]] as const) {
    const input = unchangedInput();
    if (field === "flowProofFingerprint") input.capabilities = input.capabilities.map((entry) => entry.capabilityId === A ? { ...entry, flowProofFingerprint: digest("9") } : entry);
    else input.selectorEvidenceDigests = { ...input.selectorEvidenceDigests, [A]: digest("9") };
    input.files = [MANIFEST_WRITE];
    const changes = classify(input);
    expect(summary(changes.get(ENTITY_A))).toEqual({ classification: "proof-change", plannedAction: "none", reasonCodes: [reason], affectedCapabilityIds: [A] });
    // Repository-wide targets render no flow proof.
    for (const targetId of [ENTITY_B, INDEX, MERMAID]) expect(changes.get(targetId)!.classification).toBe("unchanged");
  }
});

test("precedence: proof outranks semantic, output and stamp changes on one target", () => {
  const input = unchangedInput();
  input.capabilities = input.capabilities.map((entry) => entry.capabilityId === A ? { ...entry, semanticFingerprint: digest("8"), flowProofFingerprint: digest("9") } : entry);
  input.renderedTargets[ENTITY_A] = entityRow(ENTITY_A, A, { [A]: digest("9"), [`${A}.child`]: digest("5") }, digest("9"));
  input.files = [MANIFEST_WRITE, write(PATH[ENTITY_A], "update")];
  const entry = classify(input).get(ENTITY_A)!;
  expect(entry).toMatchObject({ stampChanged: true, outputChanged: true, semanticChanged: true, proofChanged: true, classification: "proof-change", plannedAction: "update" });
  expect(entry.reasonCodes).toEqual(["flow-proof-changed", "rendered-output-changed", "semantic-fingerprint-changed", "source-stamp-changed"]);
});

test("without a committed manifest every target is baseline-missing, never unchanged", () => {
  const input = { ...unchangedInput(), committed: undefined, files: [write(ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, "create"), write(PATH[MERMAID], "update")] };
  const changes = classify(input);
  for (const entry of changes.values()) {
    expect(entry).toMatchObject({ classification: "baseline-missing", stampChanged: null, semanticChanged: null, proofChanged: null, affectedCapabilityIds: [] });
    expect(entry.reasonCodes).toContain("baseline-missing");
  }
  expect(changes.get(MERMAID)).toMatchObject({ plannedAction: "update", outputChanged: true, reasonCodes: ["baseline-missing", "file-bytes-changed"] });
  expect(changes.get(INDEX)).toMatchObject({ plannedAction: "none", outputChanged: false, reasonCodes: ["baseline-missing"] });
});

test("a committed manifest without a row for a target it should describe is baseline-missing for that target", () => {
  const input = unchangedInput();
  const { [INDEX]: _index, ...rows } = baseRows();
  input.committed = manifest(undefined, rows);
  const changes = classify(input);
  expect(changes.get(INDEX)).toMatchObject({ classification: "baseline-missing", stampChanged: null, semanticChanged: false, proofChanged: false, reasonCodes: ["target-row-missing"] });
  expect(changes.get(ENTITY_A)!.classification).toBe("unchanged");
});

test("a known proof change outranks a missing committed row: proof-change with the row-missing reason", () => {
  const input = unchangedInput();
  const { [ENTITY_A]: _alpha, ...rows } = baseRows();
  input.committed = manifest(undefined, rows);
  input.capabilities = input.capabilities.map((entry) => entry.capabilityId === A ? { ...entry, flowProofFingerprint: digest("9") } : entry);
  input.files = [MANIFEST_WRITE, write(PATH[ENTITY_A], "create")];
  const entry = classify(input).get(ENTITY_A)!;
  expect(entry).toMatchObject({ classification: "proof-change", stampChanged: null, semanticChanged: false, proofChanged: true, plannedAction: "create" });
  expect(entry.reasonCodes).toEqual(["flow-proof-changed", "target-row-missing"]);
  expect(entry.affectedCapabilityIds).toEqual([A]);
});

test("a missing committed row explained by a semantic change is semantic-change, never baseline-missing", () => {
  const input = unchangedInput();
  const { [ENTITY_A]: _alpha, ...rows } = baseRows();
  input.committed = manifest(undefined, rows);
  input.capabilities = input.capabilities.map((entry) => entry.capabilityId === A ? { ...entry, semanticFingerprint: digest("8") } : entry);
  input.files = [MANIFEST_WRITE, write(PATH[ENTITY_A], "create")];
  const entry = classify(input).get(ENTITY_A)!;
  expect(entry).toMatchObject({ classification: "semantic-change", semanticChanged: true, proofChanged: false, plannedAction: "create" });
  expect(entry.stampChanged).toBe(true);
  expect(entry.reasonCodes).toEqual(["semantic-fingerprint-changed", "source-stamp-changed", "target-added"]);
});

test("an added capability's document is a semantic create, and a removed one's orphan is a semantic delete", () => {
  const input = unchangedInput();
  input.capabilities = [...input.capabilities.filter((entry) => entry.capabilityId !== B), (({ selectorEvidenceDigest: _s, ...entry }) => entry)(capability(C, []))];
  input.selectorEvidenceDigests = { [A]: digest("c"), [C]: digest("c") };
  const { [ENTITY_B]: _beta, ...rows } = baseRows();
  input.renderedTargets = { ...rows, [ENTITY_C]: entityRow(ENTITY_C, C, { [C]: digest("4") }) };
  input.orphans = [{ path: PATH[ENTITY_B], targetId: ENTITY_B, disposition: "delete" }];
  input.files = [MANIFEST_WRITE, write(PATH[ENTITY_B], "delete"), write(PATH[ENTITY_C], "create"), write(PATH[INDEX], "update")];
  const changes = classify(input);
  expect(summary(changes.get(ENTITY_C))).toEqual({ classification: "semantic-change", plannedAction: "create", reasonCodes: ["semantic-fingerprint-changed", "source-stamp-changed", "target-added"], affectedCapabilityIds: [C] });
  expect(summary(changes.get(ENTITY_B))).toEqual({ classification: "semantic-change", plannedAction: "delete", reasonCodes: ["semantic-fingerprint-changed", "source-stamp-changed", "target-removed"], affectedCapabilityIds: [B] });
  expect(summary(changes.get(INDEX))).toEqual({ classification: "semantic-change", plannedAction: "update", reasonCodes: ["file-bytes-changed", "semantic-fingerprint-changed"], affectedCapabilityIds: [B, C] });
  expect(changes.get(ENTITY_A)!.classification).toBe("unchanged");
});

test("an orphan that needs human review is blocked and never deleted", () => {
  const input = unchangedInput();
  const { [ENTITY_B]: _beta, ...rows } = baseRows();
  input.renderedTargets = rows;
  input.capabilities = input.capabilities.filter((entry) => entry.capabilityId !== B);
  input.orphans = [{ path: PATH[ENTITY_B], targetId: ENTITY_B, disposition: "human-review" }];
  input.files = [MANIFEST_WRITE];
  expect(classify(input).get(ENTITY_B)).toMatchObject({ classification: "blocked", plannedAction: "none", outputChanged: true, reasonCodes: ["orphan-review-required", "semantic-fingerprint-changed", "source-stamp-changed", "target-removed"] });
});

test("an orphan the committed manifest has no row for is blocked or baseline-missing, never unchanged", () => {
  const orphan = "projection_target.entity.legacy";
  for (const disposition of ["delete", "human-review"] as const) {
    const input = unchangedInput();
    input.orphans = [{ path: "docs/architecture/modules/flows/legacy.md", targetId: orphan, disposition }];
    input.files = disposition === "delete" ? [write("docs/architecture/modules/flows/legacy.md", "delete")] : [];
    expect(summary(classify(input).get(orphan))).toEqual({
      classification: disposition === "delete" ? "baseline-missing" : "blocked",
      plannedAction: disposition === "delete" ? "delete" : "none",
      reasonCodes: disposition === "delete" ? ["target-removed", "target-row-missing"] : ["orphan-review-required", "target-removed", "target-row-missing"],
      affectedCapabilityIds: []
    });
  }
});

test("a carried-forward target is blocked with its coverage reasons and keeps its comparisons", () => {
  const input = unchangedInput();
  input.capabilities = input.capabilities.map((entry) => entry.capabilityId === A ? { ...entry, flowProofFingerprint: digest("9"), proofStatus: { p1: "proven", p2: "unprovable" } } : entry);
  input.renderedTargets[ENTITY_A] = entityRow(ENTITY_A, A, { [A]: digest("9"), [`${A}.child`]: digest("5") }, digest("9"));
  input.renderedTargets[ENTITY_B] = entityRow(ENTITY_B, B, { [B]: digest("9") }, digest("7"));
  input.blockedTargets = [{ targetId: ENTITY_A, path: PATH[ENTITY_A], capabilityIds: [A], reasonCodes: ["unprovable-required-flow", "verified-flow-proof-changed"] }];
  input.files = [MANIFEST_WRITE];
  const changes = classify(input);
  expect(changes.get(ENTITY_A)).toMatchObject({
    classification: "blocked",
    plannedAction: "none",
    stampChanged: true,
    outputChanged: true,
    proofChanged: true,
    semanticChanged: false,
    affectedCapabilityIds: [A],
    reasonCodes: ["flow-proof-changed", "rendered-output-changed", "source-stamp-changed", "unprovable-required-flow", "verified-flow-proof-changed"]
  });
  expect(summary(changes.get(ENTITY_B))).toEqual({ classification: "stamp-only", plannedAction: "none", reasonCodes: ["source-stamp-changed"], affectedCapabilityIds: [B] });
});

test("a target rejected for adoption or ownership repair is blocked and not a planned write", () => {
  const input = unchangedInput();
  input.rejected = [{ path: PATH[INDEX], reasonCode: "projection-adoption-required" }, { path: PATH[MERMAID], reasonCode: "projection-ambiguous-ownership" }];
  input.files = [write(PATH[INDEX], "update"), write(PATH[MERMAID], "update")];
  const changes = classify(input);
  expect(summary(changes.get(INDEX))).toEqual({ classification: "blocked", plannedAction: "none", reasonCodes: ["adoption-required"], affectedCapabilityIds: [] });
  expect(summary(changes.get(MERMAID))).toEqual({ classification: "blocked", plannedAction: "none", reasonCodes: ["ambiguous-ownership"], affectedCapabilityIds: [] });
});
