import { describe, expect, test } from "bun:test";
import {
  classifyArchitectureMajorChange,
  compileArchitectureSemanticState,
  produceArchitectureRefreshSignals,
  type NativeModel,
  type SemanticCapabilityDiagramCompilation
} from "../src/index";
import type { AcceptedArchitectureChangeReferenceV1, ArchitectureDigestSetV1, ArchitectureMajorChangeReasonCode } from "@archcontext/contracts";

describe("AXR4 architecture major-change classifier", () => {
  test("maps every closed semantic facet to its reason code", () => {
    const cases: Array<[ArchitectureMajorChangeReasonCode, (model: NativeModel) => NativeModel, string?]> = [
      ["constraint-changed", (model) => mutateNode(model, "module.api", { extensions: { constraints: ["tenant-bound"] } })],
      ["entrypoint-changed", (model) => mutateNode(model, "module.api", { source: { include: ["src/api/**"], entrypoints: [{ id: "entrypoint.api.v2", path: "src/api/v2.ts", symbols: [{ name: "handleV2", sinks: [{ id: "sink.store.write", path: "src/store.ts", symbol: "write" }] }] }] } })],
      ["interface-changed", (model) => mutateNode(model, "module.api", { interfaces: { provides: ["interface.api-v2"] } })],
      ["lifecycle-changed", (model) => mutateNode(model, "module.api", { status: "deprecated" })],
      ["node-added", (model) => ({ ...model, nodes: [...model.nodes, { schemaVersion: "archcontext.node/v2", id: "component.api.worker", kind: "component", name: "Worker", status: "active", parent: "capability.api", summary: "Runs work." }] })],
      ["node-moved", (model) => mutateNode(model, "module.api", { parent: "component.api.boundary" })],
      ["node-removed", (model) => ({ ...model, nodes: model.nodes.filter((node) => node.id !== "module.api") })],
      ["node-renamed", (model) => mutateNode(model, "module.api", { name: "API Runtime" })],
      ["ownership-changed", (model) => mutateNode(model, "module.api", { ownership: { data: ["datastore.audit"], lifecycle: ["request"] } })],
      ["relation-changed", (model) => ({ ...model, relations: model.relations.map((relation) => ({ ...relation, intent: "Persist audited request" })) })],
      ["responsibility-changed", (model) => mutateNode(model, "module.api", { responsibilities: ["validate", "dispatch", "audit"] })],
      ["risk-boundary-changed", (model) => mutateNode(model, "module.api", { criticality: "critical", riskDomains: ["payments", "privacy"] })],
      ["verified-flow-proof-changed", (model) => model, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
    ];
    for (const [reason, mutate, proofDigest] of cases) {
      const base = compile(baseModel(), proof());
      const resulting = compile(mutate(baseModel()), proof(proofDigest));
      const classified = classifyArchitectureMajorChange({ base, resulting });
      expect(classified.mode).toBe("human-action-required");
      expect(classified.reasonCodes, reason).toContain(reason);
    }
  });

  test("accepted semantic delta emits one receipt-bound stable signal", () => {
    const base = compile(baseModel(), proof());
    const resulting = compile(mutateNode(baseModel(), "module.api", { responsibilities: ["validate", "dispatch", "audit"] }), proof());
    const acceptedChange: AcceptedArchitectureChangeReferenceV1 = {
      changeSetId: "changeset.api-major-v2",
      eventId: "architecture_event.changeset_apply.api-major-v2",
      reasonCodes: ["responsibility-changed"],
      affectedNodeIds: ["capability.api", "module.api"]
    };
    const classification = classifyArchitectureMajorChange({ base, resulting, acceptedChange });
    expect(classification.mode).toBe("refresh-required");
    const input = signalInput(classification);
    const first = produceArchitectureRefreshSignals(input);
    const second = produceArchitectureRefreshSignals(input);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0].signalId).toBe(first[0].idempotencyKey);
    expect(first[0].acceptedChange).toEqual(acceptedChange);
    expect(first[0].projectionReceiptDigest).toBe(DIGESTS.resulting.projectionDigest);
  });

  test("source, renderer, layout and generated-only digest changes emit no signal", () => {
    const semantic = compile(baseModel(), proof());
    const classification = classifyArchitectureMajorChange({ base: semantic, resulting: semantic });
    expect(classification).toMatchObject({ mode: "none", reasonCodes: [], affectedNodeIds: [] });
    expect(produceArchitectureRefreshSignals(signalInput(classification, {
      resultingDigests: {
        ...DIGESTS.resulting,
        sourceTreeDigest: digest("9"),
        projectionDigest: digest("8")
      }
    }))).toEqual([]);
  });

  test("reordering semantic set fields is canonical and does not create a major change", () => {
    const base = compile(baseModel(), proof());
    const reordered = compile(mutateNode(baseModel(), "module.api", {
      responsibilities: ["validate", "dispatch"],
      riskDomains: ["privacy"],
      ownership: { lifecycle: ["request"], data: ["datastore.request"] }
    }), proof());
    expect(classifyArchitectureMajorChange({ base, resulting: reordered }).mode).toBe("none");
  });

  test("unprovable required flow emits human action without accepted semantic truth", () => {
    const resulting = compile(baseModel(), proof(undefined, "unprovable"));
    const classification = classifyArchitectureMajorChange({ resulting });
    expect(classification).toEqual({
      schemaVersion: "archcontext.major-change-classification/v1",
      mode: "human-action-required",
      cause: "unresolved-major-candidate",
      reasonCodes: ["verified-flow-proof-changed"],
      affectedNodeIds: ["capability.api"]
    });
    const [signal] = produceArchitectureRefreshSignals(signalInput(classification));
    expect(signal.mode).toBe("human-action-required");
    expect(signal.acceptedChange).toBeUndefined();
  });

  test("stale worktree and unbound accepted references fail closed", () => {
    const base = compile(baseModel(), proof());
    const resulting = compile(mutateNode(baseModel(), "module.api", { name: "API Runtime" }), proof());
    const acceptedChange: AcceptedArchitectureChangeReferenceV1 = {
      changeSetId: "changeset.rename",
      eventId: "architecture_event.rename",
      reasonCodes: ["node-renamed"],
      affectedNodeIds: ["capability.other"]
    };
    expect(() => classifyArchitectureMajorChange({ base, resulting, acceptedChange }))
      .toThrow("architecture-major-change-accepted-reference-does-not-bind-observed-delta");
    const classification = classifyArchitectureMajorChange({ base, resulting });
    expect(() => produceArchitectureRefreshSignals(signalInput(classification, {
      expected: { repositoryId: "repo.test", workspaceId: "workspace.test", headSha: "b".repeat(40), worktreeDigest: digest("1") }
    }))).toThrow("architecture-refresh-signal-stale-worktree");
  });

  test("signal wire payload contains no source body, diff, CodeGraph output or prompt", () => {
    const base = compile(baseModel(), proof());
    const resulting = compile(mutateNode(baseModel(), "module.api", { name: "API Runtime" }), proof());
    const classification = classifyArchitectureMajorChange({ base, resulting });
    const wire = JSON.stringify(produceArchitectureRefreshSignals(signalInput(classification)));
    for (const forbidden of ["SECRET_SENTINEL", "rawDiff", "callSites", "prompt", "completion"]) {
      expect(wire).not.toContain(forbidden);
    }
  });
});

function baseModel(): NativeModel {
  return {
    nodes: [
      { schemaVersion: "archcontext.node/v2", id: "capability.api", kind: "capability", name: "API", status: "active", summary: "Owns the API." },
      { schemaVersion: "archcontext.node/v2", id: "component.api.boundary", kind: "component", name: "Boundary", status: "active", parent: "capability.api", summary: "Accepts calls." },
      {
        schemaVersion: "archcontext.node/v2",
        id: "module.api",
        kind: "module",
        name: "API Module",
        status: "active",
        parent: "capability.api",
        summary: "Validates and dispatches requests.",
        responsibilities: ["dispatch", "validate"],
        source: { include: ["src/api/**"] },
        ownership: { data: ["datastore.request"], lifecycle: ["request"] },
        interfaces: { provides: ["interface.api-v1"] },
        criticality: "high",
        riskDomains: ["privacy"],
        extensions: { constraints: ["authenticated"] }
      },
      { schemaVersion: "archcontext.node/v2", id: "datastore.request", kind: "datastore", name: "Request Store", status: "active", summary: "Stores requests." }
    ],
    relations: [{ id: "relation.api-store", kind: "writes", source: "module.api", target: "datastore.request", intent: "Persist request" }],
    flows: []
  };
}

function mutateNode(model: NativeModel, id: string, patch: Record<string, unknown>): NativeModel {
  return { ...model, nodes: model.nodes.map((node) => node.id === id ? { ...node, ...patch } as any : node) };
}

function proof(
  proofDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  p2Status: "not-applicable" | "proven" | "unprovable" = "not-applicable"
): SemanticCapabilityDiagramCompilation {
  return {
    schemaVersion: "archcontext.semantic-diagram-compilation/v1",
    capabilityId: "capability.api",
    p1: { status: "proven", nodes: [], edges: [], diagnostics: [], mermaid: "flowchart LR" },
    p2: {
      status: p2Status,
      ...(p2Status === "not-applicable" ? { rationale: "No runtime flow." } : {}),
      diagrams: [],
      diagnostics: p2Status === "unprovable" ? [{ code: "flow-missing", detail: "missing" }] : [],
      mermaid: []
    },
    evidenceCoverage: { requiredSelectors: 0, provenSelectors: 0, unboundSelectors: [] },
    proofDigest
  };
}

function compile(model: NativeModel, compilation: SemanticCapabilityDiagramCompilation) {
  return compileArchitectureSemanticState({ model, compilations: [compilation] });
}

const DIGESTS = {
  base: digestSet("1", "2", "3", "4"),
  resulting: digestSet("5", "6", "7", "8")
};

function signalInput(
  classification: ReturnType<typeof classifyArchitectureMajorChange>,
  overrides: Record<string, unknown> = {}
) {
  return {
    classification,
    repositoryId: "repo.test",
    workspaceId: "workspace.test",
    headSha: "a".repeat(40),
    worktreeDigest: digest("0"),
    baseDigests: DIGESTS.base,
    resultingDigests: DIGESTS.resulting,
    projectionReceiptDigest: DIGESTS.resulting.projectionDigest,
    ...overrides
  };
}

function digestSet(model: string, source: string, proofValue: string, projection: string): ArchitectureDigestSetV1 {
  return {
    modelDigest: digest(model),
    sourceTreeDigest: digest(source),
    flowProofDigest: digest(proofValue),
    projectionDigest: digest(projection)
  };
}

function digest(char: string): `sha256:${string}` {
  return `sha256:${char.repeat(64)}`;
}
