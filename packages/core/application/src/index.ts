import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { ChangeSetEngine, type ChangeOperation, type ChangeSetBase, type ChangeSetReason } from "@archcontext/core/changeset-engine";
import { compileTaskContext, type ContextBudget } from "@archcontext/core/context-compiler";
import {
  digestJson,
  type CodeFactsPort,
  type ModelStorePort,
  type PracticeCheckpointEvent,
  type PracticeCheckpointResultV1,
  type PracticeCheckpointSnapshotV1,
  type PracticeMatchV1,
  type WorkspaceRef
} from "@archcontext/contracts";
import type { ArchitecturePressure, PressureSignal } from "@archcontext/core/pressure-engine";
import { computeRefactorConfidence, createInterventionProposal, createProofPoint, decidePosture } from "@archcontext/core/refactor-decision";
import { completeTaskGate } from "@archcontext/core/review-engine";

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

export interface CheckpointTaskInput {
  workspace: WorkspaceRef;
  taskSessionId: string;
  task: string;
  event: PracticeCheckpointEvent;
  changedPaths?: string[];
  toolCallId?: string;
  expectedHeadSha?: string;
  expectedWorktreeDigest?: string;
  previous?: PracticeCheckpointSnapshotV1;
  codeFacts: CodeFactsPort;
  modelStore: ModelStorePort;
  budget?: ContextBudget;
}

export async function prepareTask(input: PrepareTaskInput) {
  const context = await compileTaskContext({
    workspace: input.workspace,
    task: input.task,
    codeFacts: input.codeFacts,
    modelStore: input.modelStore,
    budget: input.budget ?? { maxBytes: 12_288, maxItems: 12 }
  });
  const pressure: ArchitecturePressure = {
    level: context.architecturePressure.level,
    score: context.architecturePressure.score,
    signals: (context.extensions.pressureSignals as PressureSignal[] | undefined) ?? context.architecturePressure.signals.map((type) => ({
      type: type as PressureSignal["type"],
      severity: "low",
      evidence: ["compiled-context"],
      evidenceKind: "heuristic",
      evidenceDetails: []
    }))
  };
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

export async function checkpointTask(input: CheckpointTaskInput): Promise<PracticeCheckpointResultV1> {
  await input.codeFacts.sync({ workspace: input.workspace, changedPaths: input.changedPaths ?? [] });
  const context = await compileTaskContext({
    workspace: input.workspace,
    task: input.task,
    codeFacts: input.codeFacts,
    modelStore: input.modelStore,
    budget: input.budget ?? { maxBytes: 12_288, maxItems: 12 }
  });
  const worktreeDigest = computeWorktreeDigest(input.workspace.root);
  const nextSnapshot: PracticeCheckpointSnapshotV1 = {
    schemaVersion: "archcontext.practice-checkpoint-snapshot/v1",
    task: input.task,
    headSha: input.workspace.headSha,
    worktreeDigest,
    contextDigest: context.extensions.digest,
    practiceGuidanceDigest: context.extensions.practiceGuidanceDigest,
    catalogDigest: context.practiceGuidance.catalogDigest,
    matches: context.practiceGuidance.matches
  };
  const staleReasons = [
    ...(input.expectedHeadSha && input.expectedHeadSha !== input.workspace.headSha ? ["stale-head" as const] : []),
    ...(input.expectedWorktreeDigest && input.expectedWorktreeDigest !== worktreeDigest ? ["stale-worktree" as const] : [])
  ];
  const delta = practiceDelta(input.previous?.matches ?? [], nextSnapshot.matches);
  const noBaseline = input.previous === undefined;
  const noDelta = delta.added.length === 0 && delta.removed.length === 0 && delta.upgraded.length === 0 && delta.downgraded.length === 0;
  const reasonCode = staleReasons[0] ?? (noBaseline ? "no-baseline" : noDelta ? "no-op" : "fresh");
  const changedPaths = normalizeChangedPaths(input.changedPaths ?? []);
  const withoutDigests = {
    schemaVersion: "archcontext.practice-checkpoint/v1" as const,
    taskSessionId: input.taskSessionId,
    event: input.event,
    headSha: input.workspace.headSha,
    ...(input.expectedHeadSha === undefined ? {} : { expectedHeadSha: input.expectedHeadSha }),
    worktreeDigest,
    ...(input.expectedWorktreeDigest === undefined ? {} : { expectedWorktreeDigest: input.expectedWorktreeDigest }),
    fresh: staleReasons.length === 0,
    reasonCode,
    staleReasons,
    changedPaths,
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    catalogDigest: nextSnapshot.catalogDigest,
    contextDigest: nextSnapshot.contextDigest,
    ...(input.previous?.contextDigest === undefined ? {} : { previousContextDigest: input.previous.contextDigest }),
    practiceGuidanceDigest: nextSnapshot.practiceGuidanceDigest,
    ...(input.previous?.practiceGuidanceDigest === undefined ? {} : { previousPracticeGuidanceDigest: input.previous.practiceGuidanceDigest }),
    delta,
    hook: {
      egress: "none" as const,
      failOpen: true as const,
      pathCount: changedPaths.length,
      network: "forbidden" as const,
      pathSummary: summarizeCheckpointPaths(input.workspace.root, changedPaths)
    },
    nextSnapshot
  };
  const noOpDigest = digestJson({
    taskSessionId: input.taskSessionId,
    event: input.event,
    changedPaths: withoutDigests.changedPaths,
    contextDigest: nextSnapshot.contextDigest,
    practiceGuidanceDigest: nextSnapshot.practiceGuidanceDigest
  } as any);
  return {
    ...withoutDigests,
    noOpDigest,
    resultDigest: digestJson({ ...withoutDigests, noOpDigest } as any)
  };
}

export function completeTask(input: Parameters<typeof completeTaskGate>[0]) {
  return completeTaskGate(input);
}

const DEFAULT_REASON: ChangeSetReason = { taskSessionId: "task_application" };

export function planArchitectureUpdate(input: {
  id: string;
  operations: ChangeOperation[];
  base: ChangeSetBase;
  reason?: ChangeSetReason;
}) {
  return new ChangeSetEngine().plan({
    id: input.id,
    base: input.base,
    reason: input.reason ?? DEFAULT_REASON,
    operations: input.operations
  });
}

export interface ApplyArchitectureUpdateDeps {
  changeSetEngine: ChangeSetEngine;
}

export async function applyArchitectureUpdate(root: string, input: {
  id: string;
  operations: ChangeOperation[];
  approved: boolean;
  expectedWorktreeDigest: string;
  headSha: string;
  modelDigest: string;
  reason?: ChangeSetReason;
}, deps?: ApplyArchitectureUpdateDeps) {
  const freshness = checkpoint({ root, expectedWorktreeDigest: input.expectedWorktreeDigest });
  if (!freshness.fresh) throw new Error("Snapshot freshness check failed before ChangeSet apply");
  const engine = deps?.changeSetEngine;
  if (!engine) throw new Error("applyArchitectureUpdate requires a ChangeSetEngine dependency");
  const draft = engine.plan({
    id: input.id,
    base: {
      headSha: input.headSha,
      worktreeDigest: input.expectedWorktreeDigest,
      modelDigest: input.modelDigest
    },
    reason: input.reason ?? DEFAULT_REASON,
    operations: input.operations
  });
  const approved = input.approved ? engine.approve(draft) : draft;
  return engine.apply(root, approved, { approved: input.approved });
}

const ENFORCEMENT_RANK = { advisory: 0, checkpoint: 1, complete: 2 } as const;

function practiceDelta(previous: PracticeMatchV1[], current: PracticeMatchV1[]): PracticeCheckpointResultV1["delta"] {
  const previousById = new Map(previous.map((match) => [match.practiceId, match]));
  const currentById = new Map(current.map((match) => [match.practiceId, match]));
  const added: PracticeMatchV1[] = [];
  const removed: PracticeMatchV1[] = [];
  const upgraded: PracticeMatchV1[] = [];
  const downgraded: PracticeMatchV1[] = [];
  const unchanged: PracticeMatchV1[] = [];

  for (const match of current) {
    const before = previousById.get(match.practiceId);
    if (!before) {
      added.push(match);
      continue;
    }
    const movement = matchMovement(before, match);
    if (movement > 0) upgraded.push(match);
    else if (movement < 0) downgraded.push(match);
    else unchanged.push(match);
  }
  for (const match of previous) {
    if (!currentById.has(match.practiceId)) removed.push(match);
  }
  return {
    schemaVersion: "archcontext.practice-delta/v1",
    added,
    removed,
    upgraded,
    downgraded,
    unchanged,
    requiresProof: current.filter((match) => match.enforcement === "checkpoint" && match.confidence !== "high")
  };
}

function matchMovement(previous: PracticeMatchV1, current: PracticeMatchV1): number {
  const enforcement = ENFORCEMENT_RANK[current.enforcement] - ENFORCEMENT_RANK[previous.enforcement];
  if (enforcement !== 0) return enforcement;
  const scoreMovement = current.score - previous.score;
  if (Math.abs(scoreMovement) >= 10) return scoreMovement;
  const confidence = confidenceRank(current.confidence) - confidenceRank(previous.confidence);
  if (confidence !== 0) return confidence;
  return current.assetDigest === previous.assetDigest ? 0 : 1;
}

function confidenceRank(confidence: PracticeMatchV1["confidence"]): number {
  return confidence === "high" ? 2 : confidence === "medium" ? 1 : 0;
}

function normalizeChangedPaths(paths: string[]): string[] {
  return [...new Set(paths
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter((path) => path.length > 0 && !path.startsWith("/") && !path.includes(".."))
  )].sort();
}

function summarizeCheckpointPaths(root: string, paths: string[]): PracticeCheckpointResultV1["hook"]["pathSummary"] {
  const summary = {
    schemaVersion: "archcontext.checkpoint-path-summary/v1" as const,
    total: paths.length,
    source: 0,
    generated: 0,
    ignored: 0,
    binary: 0,
    deleted: 0,
    renameHints: 0
  };
  for (const path of paths) {
    const kind = classifyCheckpointPath(root, path);
    summary[kind] += 1;
  }
  summary.renameHints = Math.min(summary.deleted, summary.source);
  return summary;
}

function classifyCheckpointPath(root: string, path: string): "source" | "generated" | "ignored" | "binary" | "deleted" {
  if (isIgnoredCheckpointPath(path)) return "ignored";
  if (isGeneratedCheckpointPath(path)) return "generated";
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return "deleted";
  try {
    if (!statSync(absolute).isFile()) return "ignored";
  } catch {
    return "deleted";
  }
  if (isBinaryCheckpointPath(path)) return "binary";
  return "source";
}

function isGeneratedCheckpointPath(path: string): boolean {
  return path.startsWith(".archcontext/generated/") ||
    path.startsWith("dist/") ||
    path.startsWith("build/") ||
    path.includes("/generated/");
}

function isIgnoredCheckpointPath(path: string): boolean {
  return path.startsWith(".git/") ||
    path.startsWith("node_modules/") ||
    path.startsWith("coverage/") ||
    path.endsWith(".log");
}

function isBinaryCheckpointPath(path: string): boolean {
  return CHECKPOINT_BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

const CHECKPOINT_BINARY_EXTENSIONS = new Set([
  ".bin",
  ".bmp",
  ".db",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".sqlite",
  ".wasm",
  ".webp",
  ".zip"
]);
