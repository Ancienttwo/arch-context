import { describe, expect, test } from "bun:test";
import type { ArchitectureFlowV1 } from "@archcontext/contracts";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNativeModelFromArchContext } from "../src/index";
import {
  architectureSelectorProofStatus,
  checkSemanticFlowSelectors,
  compileSemanticCapabilityDiagrams,
  type ArchitectureSelectorEvidenceV1,
  type SemanticArchitectureNode,
  type SemanticArchitectureRelation
} from "../src/semantic-diagrams";

const capabilityId = "capability.runtime.hooks";

const nodes: SemanticArchitectureNode[] = [
  {
    id: capabilityId,
    kind: "capability",
    name: "Runtime Hook Adapters",
    source: {
      entrypoints: [
        {
          id: "entrypoint.hook.stop",
          path: "src/hook.ts",
          symbols: [
            {
              name: "runHook",
              sinks: [
                { id: "sink.hook.journal", path: "src/journal.ts", symbol: "writeEvent" },
                { id: "sink.hook.receipt", path: "src/receipt.ts", symbol: "writeReceipt" },
                { id: "sink.hook.error", path: "src/output.ts", symbol: "reportFailure" }
              ]
            }
          ]
        }
      ]
    }
  },
  { id: "actor.agent", kind: "actor", name: "Agent Runtime", parent: capabilityId },
  { id: "component.hook", kind: "component", name: "Stop Hook", parent: capabilityId },
  { id: "datastore.journal", kind: "datastore", name: "Durable Event Journal", parent: capabilityId },
  { id: "component.projection", kind: "component", name: "Projection Worker", parent: capabilityId }
];

const relations: SemanticArchitectureRelation[] = [
  { id: "relation.agent-hook", kind: "calls", source: "actor.agent", target: "component.hook", intent: "submits changed capability" },
  { id: "relation.hook-journal", kind: "writes", source: "component.hook", target: "datastore.journal", intent: "persists one durable event" },
  { id: "relation.hook-worker", kind: "calls", source: "component.hook", target: "component.projection", intent: "waits for projection receipt" }
];

const flow: ArchitectureFlowV1 = {
  schemaVersion: "archcontext.flow/v1",
  id: "flow.runtime.hooks.stop",
  capabilityId,
  name: "Stop hook projection refresh",
  applicability: "required",
  participants: [
    { id: "agent", nodeId: "actor.agent" },
    { id: "hook", nodeId: "component.hook" },
    { id: "journal", nodeId: "datastore.journal" },
    { id: "worker", nodeId: "component.projection" }
  ],
  steps: [
    {
      id: "submit",
      from: "agent",
      to: "hook",
      label: "Submit changed capability",
      evidence: { entrypointId: "entrypoint.hook.stop", sourceSymbol: "runHook", sinkId: "sink.hook.journal" }
    },
    {
      id: "persist",
      from: "hook",
      to: "journal",
      label: "Persist durable refresh event",
      evidence: { entrypointId: "entrypoint.hook.stop", sourceSymbol: "runHook", sinkId: "sink.hook.journal" }
    }
  ],
  outcomes: [
    {
      id: "projected",
      kind: "success",
      label: "Projection accepted",
      steps: [
        {
          id: "receipt",
          from: "hook",
          to: "worker",
          label: "Read accepted ChangeSet receipt",
          evidence: { entrypointId: "entrypoint.hook.stop", sourceSymbol: "runHook", sinkId: "sink.hook.receipt" }
        }
      ],
      terminal: { participant: "hook", label: "Acknowledge event" }
    },
    {
      id: "failed",
      kind: "error",
      label: "Projection failed",
      steps: [
        {
          id: "failure",
          from: "hook",
          to: "worker",
          label: "Record retryable failure",
          evidence: { entrypointId: "entrypoint.hook.stop", sourceSymbol: "runHook", sinkId: "sink.hook.error" }
        }
      ],
      terminal: { participant: "hook", label: "Keep event pending" }
    }
  ]
};

const evidence: ArchitectureSelectorEvidenceV1[] = [
  evidenceFor("sink.hook.journal", "src/journal.ts", "writeEvent"),
  evidenceFor("sink.hook.receipt", "src/receipt.ts", "writeReceipt"),
  evidenceFor("sink.hook.error", "src/output.ts", "reportFailure")
];

describe("semantic architecture compiler", () => {
  test("compiles semantic P1 and a success/error P2 only from declared authority plus exact evidence", () => {
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [flow], evidence });
    expect(result.p1.status).toBe("proven");
    expect(result.p2.status).toBe("proven");
    expect(result.evidenceCoverage).toEqual({ requiredSelectors: 3, provenSelectors: 3, unboundSelectors: [] });
    expect(result.p1.mermaid).toContain("Runtime Hook Adapters");
    expect(result.p1.mermaid).toContain("Durable Event Journal");
    expect(result.p1.mermaid).not.toContain("src/");
    expect(result.p2.mermaid[0]).toContain("alt Projection accepted");
    expect(result.p2.mermaid[0]).toContain("else Projection failed");
    expect(result.p2.mermaid[0]).toContain("Keep event pending");
    expect(result.p2.mermaid[0]).not.toContain("src/hook.ts");
  });

  test("keeps an explicit not-applicable flow distinct from unprovable", () => {
    const notApplicable: ArchitectureFlowV1 = {
      schemaVersion: "archcontext.flow/v1",
      id: "flow.runtime.hooks.background",
      capabilityId,
      name: "Background synchronization",
      applicability: "not-applicable",
      rationale: "This capability is invoked only by the Stop hook."
    };
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [notApplicable], evidence: [] });
    expect(result.p1.status).toBe("proven");
    expect(result.p2.status).toBe("not-applicable");
    expect(result.p2.rationale).toContain("Stop hook");
    expect(result.p2.mermaid).toEqual([]);
  });

  test("missing, unmatched, ambiguous or truncated selectors are unprovable", () => {
    for (const changedEvidence of [
      evidence.slice(1),
      evidence.map((entry, index) => index === 0 ? { ...entry, matched: false, callSites: [] } : entry),
      [...evidence, evidence[0]],
      evidence.map((entry, index) => index === 0 ? { ...entry, ambiguous: true } : entry),
      evidence.map((entry, index) => index === 0 ? { ...entry, truncated: true } : entry)
    ]) {
      const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [flow], evidence: changedEvidence });
      expect(result.p2.status).toBe("unprovable");
      expect(result.p2.mermaid).toEqual([]);
      expect(result.evidenceCoverage.unboundSelectors.length).toBeGreaterThan(0);
    }
  });

  test("selector proof status names why a selector is unproven, and only proven binds a step (#300)", () => {
    const base = evidence[0]!;
    const unmatched = { ...base, matched: false, callSites: [] };
    const cases: Array<[ArchitectureSelectorEvidenceV1[], string, string | undefined]> = [
      [[base], "proven", undefined],
      [[unmatched], "no-direct-call", "selector-evidence-unmatched"],
      [[{ ...unmatched, referenceSites: [{ path: "src/hook.ts", line: 4 }] }], "only-references", "selector-evidence-unmatched"],
      [[{ ...unmatched, rejectedBuiltinCallSites: [{ path: "src/hook.ts", line: 5 }] }], "false-builtin-call", "selector-evidence-unmatched"],
      [[{ ...base, ambiguous: true }], "ambiguous-symbol", "selector-evidence-ambiguous"],
      [[base, base], "ambiguous-symbol", "selector-evidence-ambiguous"],
      [[{ ...base, truncated: true }], "evidence-truncated", "selector-evidence-truncated"],
      [[], "evidence-missing", "selector-evidence-missing"]
    ];
    for (const [entries, status, diagnostic] of cases) {
      expect(architectureSelectorProofStatus(entries), status).toBe(status as never);
      const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [flow], evidence: [...entries, ...evidence.slice(1)] });
      expect(result.p2.status, status).toBe(diagnostic === undefined ? "proven" : "unprovable");
      expect(result.p2.diagnostics.map((entry): string => entry.code), status).toEqual(diagnostic === undefined ? [] : [diagnostic, diagnostic]);
    }
  });

  test("flow selector check reports every declared selector with its flow steps and the projection P2 status (#300)", () => {
    const unused: SemanticArchitectureNode = {
      ...nodes[0]!,
      source: {
        entrypoints: [{
          ...nodes[0]!.source!.entrypoints![0]!,
          symbols: [{
            name: "runHook",
            sinks: [...nodes[0]!.source!.entrypoints![0]!.symbols[0]!.sinks, { id: "sink.hook.unused", path: "src/deps.ts", symbol: "readBinding" }]
          }]
        }]
      }
    };
    const checkNodes = [unused, ...nodes.slice(1)];
    const checkEvidence = [
      { ...evidence[0]!, matched: false, callSites: [], rejectedBuiltinCallSites: [{ path: "src/hook.ts", line: 5 }] },
      ...evidence.slice(1),
      { ...evidenceFor("sink.hook.unused", "src/deps.ts", "readBinding"), matched: false, callSites: [] }
    ];
    const check = checkSemanticFlowSelectors({ nodes: checkNodes, relations, flows: [flow], evidence: checkEvidence });
    expect(check.selectors.map((selector) => [selector.sinkId, selector.status, selector.flowSteps])).toEqual([
      ["sink.hook.error", "proven", [{ flowId: flow.id, stepId: "failure" }]],
      ["sink.hook.journal", "false-builtin-call", [{ flowId: flow.id, stepId: "submit" }, { flowId: flow.id, stepId: "persist" }]],
      ["sink.hook.receipt", "proven", [{ flowId: flow.id, stepId: "receipt" }]],
      ["sink.hook.unused", "no-direct-call", []]
    ]);
    expect(check.selectors[1]!.rejectedBuiltinCallSites).toEqual([{ path: "src/hook.ts", line: 5 }]);
    expect(check.summary).toEqual({ selectors: 4, proven: 2, unproven: 2, usedUnproven: 1 });
    const projected = compileSemanticCapabilityDiagrams({ capabilityId, nodes: checkNodes, relations, flows: [flow], evidence: checkEvidence });
    expect(check.capabilities).toEqual([{ capabilityId, p2Status: projected.p2.status, diagnostics: projected.p2.diagnostics }]);
    expect(check.capabilities[0]!.p2Status).toBe("unprovable");
    expect(check.ok).toBe(false);

    const proven = checkSemanticFlowSelectors({ nodes, relations, flows: [flow], evidence });
    expect(proven.ok).toBe(true);
    expect(proven.summary).toEqual({ selectors: 3, proven: 3, unproven: 0, usedUnproven: 0 });
  });

  test("raw paths and call trails cannot synthesize a verified flow", () => {
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [], evidence });
    expect(result.p2.status).toBe("unprovable");
    expect(result.p2.diagnostics.map((entry) => entry.code)).toContain("flow-missing");
    expect(result.p2.mermaid).toEqual([]);
  });

  test("missing branch terminal and dangling participants fail closed", () => {
    const broken = structuredClone(flow) as Extract<ArchitectureFlowV1, { applicability: "required" }>;
    broken.outcomes = broken.outcomes.filter((outcome) => outcome.kind === "success");
    broken.steps[0].to = "missing";
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [broken], evidence });
    expect(result.p2.status).toBe("unprovable");
    expect(result.p2.diagnostics.map((entry) => entry.code)).toContain("outcome-kind-missing");
    expect(result.p2.diagnostics.map((entry) => entry.code)).toContain("participant-reference-missing");
  });

  test("a dangling parent reference makes P1 unprovable instead of silently dropping the node", () => {
    const result = compileSemanticCapabilityDiagrams({
      capabilityId,
      nodes: [...nodes, { id: "component.orphan", kind: "component", name: "Orphan", parent: "capability.missing" }],
      relations,
      flows: [flow],
      evidence
    });
    expect(result.p1.status).toBe("unprovable");
    expect(result.p1.diagnostics).toContainEqual({
      code: "parent-node-missing",
      detail: "component.orphan references capability.missing"
    });
    expect(result.p1.mermaid).toBeUndefined();
  });

  test("duplicate participants, missing relation bindings and unknown terminal participants fail closed", () => {
    const broken = structuredClone(flow) as Extract<ArchitectureFlowV1, { applicability: "required" }>;
    broken.participants.push({ id: "hook", nodeId: "component.projection" });
    broken.outcomes[0].terminal.participant = "missing";
    const result = compileSemanticCapabilityDiagrams({
      capabilityId,
      nodes,
      relations: relations.filter((relation) => relation.id !== "relation.hook-worker"),
      flows: [broken],
      evidence
    });
    expect(result.p2.status).toBe("unprovable");
    expect(result.p2.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "participant-id-duplicate",
      "relation-binding-missing",
      "terminal-participant-missing"
    ]));
    expect(result.p2.mermaid).toEqual([]);
  });

  test("a flow whose semantic id names the capability but capabilityId points elsewhere is unprovable", () => {
    const mismatched = { ...flow, capabilityId: "capability.other" } as ArchitectureFlowV1;
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes, relations, flows: [mismatched], evidence });
    expect(result.p2.status).toBe("unprovable");
    expect(result.p2.diagnostics.map((entry) => entry.code)).toContain("flow-capability-mismatch");
    expect(result.p2.mermaid).toEqual([]);
  });

  test("escapes Mermaid delimiters without changing semantic labels upstream", () => {
    const escapedNodes = nodes.map((node) => node.id === "component.hook" ? { ...node, name: 'Hook "A" #1, stop;' } : node);
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes: escapedNodes, relations, flows: [flow], evidence });
    expect(result.p1.mermaid).toContain("Hook #quot;A#quot; #35;1#44; stop#59;");
    expect(result.p2.mermaid[0]).toContain("Hook #quot;A#quot; #35;1#44; stop#59;");
  });

  test("escapes with Mermaid entity codes that decode back to the model text (#302)", () => {
    const label = 'a,b;c#d #44; e "q" #quot;';
    const escapedNodes = nodes.map((node) => node.id === "component.hook" ? { ...node, name: label } : node);
    const escapedRelations = relations.map((relation) => relation.id === "relation.hook-worker" ? { ...relation, intent: label } : relation);
    const escapedFlow = structuredClone(flow) as Extract<ArchitectureFlowV1, { applicability: "required" }>;
    escapedFlow.steps[0]!.label = label;
    escapedFlow.outcomes[0]!.label = label;
    escapedFlow.outcomes[0]!.terminal.label = label;
    const result = compileSemanticCapabilityDiagrams({ capabilityId, nodes: escapedNodes, relations: escapedRelations, flows: [escapedFlow], evidence });
    const escaped = "a#44;b#59;c#35;d #35;44#59; e #quot;q#quot; #35;quot#59;";
    const decode = (value: string) => value.replace(/#(\d+|quot);/g, (_match, code: string) => code === "quot" ? "\"" : String.fromCharCode(Number(code)));
    expect(decode(escaped)).toBe(label);

    const diagrams = [result.p1.mermaid!, ...result.p2.mermaid];
    expect(diagrams).toHaveLength(2);
    for (const diagram of diagrams) {
      expect(diagram).not.toMatch(/[＃；，]/);
      expect(diagram).not.toContain(label);
      // `"` is kept as an entity code, never replaced by `'`.
      expect(diagram).not.toContain("'q'");
    }
    expect(result.p1.mermaid).toContain(`["${escaped}"]`);
    expect(result.p1.mermaid).toContain(`-->|"${escaped}"|`);
    expect(result.p2.mermaid[0]).toContain(` as ${escaped}\n`);
    expect(result.p2.mermaid[0]).toContain(`: ${escaped}\n`);
    expect(result.p2.mermaid[0]).toContain(`  alt ${escaped}\n`);
  });

  test("proves both pinned repo-harness pilot capabilities from node-v2, flow-v1 and exact selector evidence", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/repo-harness-semantic-pilot");
    const model = loadNativeModelFromArchContext(root);
    const fixture = JSON.parse(readFileSync(join(root, "evidence.json"), "utf8")) as { evidence: ArchitectureSelectorEvidenceV1[] };
    const capabilityIds = [
      "capability.runtime-harness.hook-adapters",
      "capability.verification.codegraph-readiness"
    ];
    for (const pilotCapabilityId of capabilityIds) {
      const result = compileSemanticCapabilityDiagrams({
        capabilityId: pilotCapabilityId,
        nodes: model.nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          name: node.name,
          ...(node.parent ? { parent: node.parent } : {}),
          ...(node.source ? { source: node.source as never } : {})
        })),
        relations: model.relations,
        flows: model.flows ?? [],
        evidence: fixture.evidence
      });
      expect(result.p1.status).toBe("proven");
      expect(result.p2.status).toBe("proven");
      expect(result.evidenceCoverage.unboundSelectors).toEqual([]);
      expect(result.evidenceCoverage.provenSelectors).toBe(result.evidenceCoverage.requiredSelectors);
      expect(result.p1.mermaid).toContain("flowchart LR");
      expect(result.p2.mermaid[0]).toContain("sequenceDiagram");
      expect(result.p2.mermaid[0]).toContain('"actorTextColor":"#ffffff"');
      expect(result.p2.mermaid[0]).toContain('"signalTextColor":"#e5e7eb"');
      expect(result.p2.mermaid[0]).toContain("alt ");
      expect(result.p2.mermaid[0]).toContain("else ");
    }
  });

  test("loader rejects node-v1 and malformed flow-v1 before the compiler can cast them", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-semantic-loader-"));
    const nodesDir = join(root, ".archcontext/model/nodes");
    const flowsDir = join(root, ".archcontext/model/flows");
    mkdirSync(nodesDir, { recursive: true });
    mkdirSync(flowsDir, { recursive: true });
    try {
      writeFileSync(join(nodesDir, "node.yaml"), "schemaVersion: archcontext.node/v1\nid: capability.test\nkind: capability\nname: Test\n");
      expect(() => loadNativeModelFromArchContext(root)).toThrow("architecture-node-schema-version-unsupported");
      writeFileSync(join(nodesDir, "node.yaml"), "schemaVersion: archcontext.node/v2\nid: capability.test\nkind: capability\nname: Test\n");
      writeFileSync(join(flowsDir, "flow.yaml"), "schemaVersion: archcontext.flow/v1\nid: flow.test\ncapabilityId: capability.test\nname: Test\napplicability: not-applicable\nrationale: explicit\nsteps: []\n");
      expect(() => loadNativeModelFromArchContext(root)).toThrow("architecture-flow-invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function evidenceFor(sinkId: string, sinkPath: string, sinkSymbol: string): ArchitectureSelectorEvidenceV1 {
  return {
    nodeId: capabilityId,
    entrypointId: "entrypoint.hook.stop",
    sourcePath: "src/hook.ts",
    sourceSymbol: "runHook",
    sinkId,
    sinkPath,
    sinkSymbol,
    matched: true,
    truncated: false,
    callSites: [{ path: sinkPath, line: 10 }]
  };
}
