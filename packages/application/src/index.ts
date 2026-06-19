import { computeWorktreeDigest } from "../../architecture-domain/src/index";
import { ChangeSetEngine, type ChangeOperation, type ChangeSetBase, type ChangeSetReason } from "../../changeset-engine/src/index";
import { compileTaskContext, type ContextBudget } from "../../context-compiler/src/index";
import type { CodeFactsPort, ModelStorePort, WorkspaceRef } from "../../contracts/src/index";
import { detectArchitecturePressure } from "../../pressure-engine/src/index";
import { computeRefactorConfidence, createInterventionProposal, createProofPoint, decidePosture } from "../../refactor-decision/src/index";
import { completeTaskGate } from "../../review-engine/src/index";

export interface PrepareTaskInput {
  workspace: WorkspaceRef;
  task: string;
  codeFacts: CodeFactsPort;
  modelStore: ModelStorePort;
  budget?: ContextBudget;
  callerCoverage?: number;
  testsAvailable?: boolean;
  rollbackAvailable?: boolean;
}

export async function prepareTask(input: PrepareTaskInput) {
  const context = await compileTaskContext({
    workspace: input.workspace,
    task: input.task,
    codeFacts: input.codeFacts,
    modelStore: input.modelStore,
    budget: input.budget ?? { maxBytes: 12_288, maxItems: 12 }
  });
  const pressure = detectArchitecturePressure({ task: input.task, symbols: context.relevantNodes });
  const confidence = computeRefactorConfidence({
    callerCoverage: input.callerCoverage ?? 0.8,
    testsAvailable: input.testsAvailable ?? true,
    rollbackAvailable: input.rollbackAvailable ?? true
  });
  const posture = decidePosture(pressure, confidence);
  return {
    context,
    pressure,
    confidence,
    posture,
    proofPoint: posture === "proof-required" ? createProofPoint(input.task) : undefined,
    intervention: posture === "intervention" ? createInterventionProposal({ task: input.task, pressure, confidence }) : undefined
  };
}

export function checkpoint(input: { root: string; expectedWorktreeDigest: string }) {
  const current = computeWorktreeDigest(input.root);
  return {
    fresh: current === input.expectedWorktreeDigest,
    currentWorktreeDigest: current,
    expectedWorktreeDigest: input.expectedWorktreeDigest
  };
}

export function completeTask(input: Parameters<typeof completeTaskGate>[0]) {
  return completeTaskGate(input);
}

const EMPTY_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_REASON: ChangeSetReason = { taskSessionId: "task_application" };

export function planArchitectureUpdate(input: {
  id: string;
  operations: ChangeOperation[];
  base?: ChangeSetBase;
  reason?: ChangeSetReason;
}) {
  return new ChangeSetEngine().plan({
    id: input.id,
    base: input.base ?? defaultBase(),
    reason: input.reason ?? DEFAULT_REASON,
    operations: input.operations
  });
}

export async function applyArchitectureUpdate(root: string, input: {
  id: string;
  operations: ChangeOperation[];
  approved: boolean;
  expectedWorktreeDigest: string;
  headSha?: string;
  modelDigest?: string;
  reason?: ChangeSetReason;
}) {
  const freshness = checkpoint({ root, expectedWorktreeDigest: input.expectedWorktreeDigest });
  if (!freshness.fresh) throw new Error("Snapshot freshness check failed before ChangeSet apply");
  const engine = new ChangeSetEngine();
  const draft = engine.plan({
    id: input.id,
    base: {
      headSha: input.headSha ?? "local",
      worktreeDigest: input.expectedWorktreeDigest,
      modelDigest: input.modelDigest ?? EMPTY_DIGEST
    },
    reason: input.reason ?? DEFAULT_REASON,
    operations: input.operations
  });
  const approved = input.approved ? engine.approve(draft) : draft;
  return engine.apply(root, approved, { approved: input.approved });
}

function defaultBase(): ChangeSetBase {
  return { headSha: "local", worktreeDigest: EMPTY_DIGEST, modelDigest: EMPTY_DIGEST };
}
