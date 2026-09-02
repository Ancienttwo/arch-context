import { createHash } from "node:crypto";
import {
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  REFACTOR_REQUEST_SCHEMA_VERSION,
  architectureTargetDeltaInterventionId,
  refactorProposalDigest,
  type ArchitectureTargetDeltaV1,
  type ModuleStatisticsSnapshotV1,
  type RefactorProposalV1,
  type RefactorRequestV1
} from "@archcontext/contracts";
import { buildModuleStatisticsSnapshot, type ModuleStatisticsInputV1 } from "../../module-statistics/src/index";
import type { NativeModel } from "../../projection-engine/src/index";
import type { RefactorAssessmentInputV1 } from "../src/index";

export function digestOf(seed: string): string {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

export const WORKTREE_DIGEST = digestOf("worktree.rf2");

/**
 * Two modules and two components, so the ladder's three node-count shapes are all reachable:
 * `component.a` alone (module), `component.a` + `component.b` (cross_module through siblings), and
 * `component.a` + `module.m` (cross_module through a file the parent owns directly).
 */
export const MODEL: NativeModel = {
  nodes: [
    { id: "module.m", kind: "module", name: "M", source: { include: ["src/m/**"] } },
    { id: "component.a", kind: "component", name: "A", parent: "module.m", source: { include: ["src/m/a/**"] } },
    { id: "component.b", kind: "component", name: "B", parent: "module.m", source: { include: ["src/m/b/**"] } },
    { id: "module.c", kind: "module", name: "C", source: { include: ["src/c/**"] } }
  ],
  relations: [{ id: "relation.a-to-b", kind: "uses", source: "component.a", target: "component.b", intent: "calls B" }]
};

/** `component.shadow` claims a path inside `module.m` while parented under `module.c`: contested. */
export const CONTESTED_MODEL: NativeModel = {
  ...MODEL,
  nodes: [
    ...MODEL.nodes,
    { id: "component.shadow", kind: "component", name: "Shadow", parent: "module.c", source: { include: ["src/m/a/**"] } }
  ]
};

/** `module.m` declares no footprint, so a `node`-scoped request against it fails the model gate. */
export const UNDECLARED_MODEL: NativeModel = {
  ...MODEL,
  nodes: MODEL.nodes.map((node) => (node.id === "module.m" ? { id: node.id, kind: node.kind, name: node.name } : node))
};

export const TRACKED_FILES = [
  { path: "src/c/z.ts", lineCount: 6 },
  { path: "src/m/a/x.ts", lineCount: 8 },
  { path: "src/m/b/y.ts", lineCount: 4 },
  { path: "src/m/root.ts", lineCount: 3 },
  { path: "tools/gen.ts", lineCount: 2 }
];

/** `component.a` and `module.c` import each other, so the module graph carries one component. */
export const CYCLE_EDGES = [
  { from: "src/m/a/x.ts", specifier: "../../c/z", to: "src/c/z.ts" },
  { from: "src/c/z.ts", specifier: "../m/a/x", to: "src/m/a/x.ts" }
];

export function makeSnapshotInput(overrides: Partial<ModuleStatisticsInputV1> = {}): ModuleStatisticsInputV1 {
  return {
    model: MODEL,
    repository: { repositoryId: "repo.rf2", storageRepositoryId: "storage.repo.rf2" },
    worktree: {
      workspaceId: "workspace.rf2",
      storageWorkspaceId: "storage.workspace.rf2",
      branch: "main",
      headSha: "1f0c4b8a2d6e9071b3c5d7e9f0a1b2c3d4e5f607",
      worktreeDigest: WORKTREE_DIGEST
    },
    trackedFiles: TRACKED_FILES,
    importEdges: [],
    workspacePackages: [],
    truncated: false,
    edgeLimit: 20000,
    codeFacts: {
      version: "0.9.1",
      binaryDigest: digestOf("index-binary"),
      availability: "ready",
      indexedWorktreeDigest: WORKTREE_DIGEST
    },
    createdAt: "2026-09-03T05:12:00.000Z",
    ...overrides
  };
}

export function makeSnapshot(overrides: Partial<ModuleStatisticsInputV1> = {}): ModuleStatisticsSnapshotV1 {
  return buildModuleStatisticsSnapshot(makeSnapshotInput(overrides));
}

/** Seals an authored delta: `interventionId` is derived, `unresolvedTargets` starts empty. */
export function makeTargetDelta(
  overrides: Partial<Omit<ArchitectureTargetDeltaV1, "interventionId" | "unresolvedTargets">> = {}
): ArchitectureTargetDeltaV1 {
  const authored: ArchitectureTargetDeltaV1 = {
    interventionId: "",
    trigger: ["component.a and component.b share one lifecycle owner"],
    thesis: "Move the shared surface under module.c and drop the sibling relation.",
    targetState: { owners: {}, requiredRelations: [], removedConcepts: [] },
    migrationState: { active: false, compatibilityContracts: [], temporaryRelations: [] },
    completionCriteria: [
      {
        outcomeId: "outcome.cross-module-edges",
        metric: "crossModuleEdgeCount",
        subjectSelectorId: "repository:repo.rf2",
        nodeId: null,
        operator: "less_than",
        value: 2,
        required: true
      }
    ],
    falsifiers: ["crossModuleEdgeCount does not fall after the move"],
    benefitLedger: { benefits: ["one owner per surface"], costs: ["one migration window"], rollbackPoint: "revert the move commit" },
    unresolvedTargets: [],
    ...overrides
  };
  return { ...authored, interventionId: architectureTargetDeltaInterventionId(authored) };
}

export function makeProposal(overrides: Partial<Omit<RefactorProposalV1, "proposalDigest">> = {}): RefactorProposalV1 {
  const authored: RefactorProposalV1 = {
    schemaVersion: REFACTOR_PROPOSAL_SCHEMA_VERSION,
    authoredBy: { kind: "subagent", id: "agent.refactor-planner", source: "subagent" },
    intent: "Collapse the duplicated boundary between component.a and component.b.",
    scopePaths: ["src/m/a/x.ts"],
    targetOutcomes: [
      {
        outcomeId: "outcome.internal-edges",
        metric: "internalEdgeCount",
        subjectSelectorId: "component.a",
        nodeId: "component.a",
        operator: "less_than",
        value: 3,
        required: true
      }
    ],
    killList: [],
    proposalDigest: "",
    ...overrides
  };
  return { ...authored, proposalDigest: refactorProposalDigest(authored) };
}

export function makeRequest(overrides: Partial<RefactorRequestV1> = {}): RefactorRequestV1 {
  return { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" }, ...overrides };
}

export function makeAssessmentInput(overrides: Partial<RefactorAssessmentInputV1> = {}): RefactorAssessmentInputV1 {
  return {
    snapshot: makeSnapshot(),
    model: MODEL,
    request: makeRequest(),
    requestId: "request.rf2-fixture",
    createdAt: "2026-09-03T05:13:00.000Z",
    ...overrides
  };
}
