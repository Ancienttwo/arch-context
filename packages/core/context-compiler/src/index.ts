import {
  activeRepositoriesForTask,
  landscapeDigest,
  type CrossRepoRelation,
  type Landscape
} from "@archcontext/core/architecture-domain";
import { digestJson, type CodeFactsPort, type Json, type ModelStorePort, type NormalizedCodeContext, type PracticeGuidanceResultV1, type WorkspaceRef } from "@archcontext/contracts";
import type { ArchitecturePosture } from "@archcontext/core/architecture-domain";
import { loadPracticeCatalog } from "@archcontext/core/practice-catalog";
import { matchPracticesForTask } from "@archcontext/core/practice-engine";
import { detectArchitecturePressure, type PressureSignal } from "@archcontext/core/pressure-engine";
import { computeRefactorConfidence, decidePosture } from "@archcontext/core/refactor-decision";

export interface ContextBudget {
  maxBytes: number;
  maxItems: number;
}

export interface CompiledTaskContext {
  schemaVersion: "archcontext.task-context/v1";
  task: string;
  posture: ArchitecturePosture;
  architecturePressure: {
    level: "low" | "medium" | "high";
    score: number;
    signals: string[];
  };
  refactorConfidence: {
    level: "low" | "medium" | "high";
    score: number;
    coverage: string[];
  };
  relevantNodes: string[];
  constraints: string[];
  decisions: string[];
  realConstraints: string[];
  unknowns: string[];
  recommendedTargetState: Record<string, Json>;
  requiredCheckpoints: string[];
  resources: { type: string; uri: string; digest?: string }[];
  practiceGuidance: PracticeGuidanceResultV1;
  extensions: {
    codeFactsDigest: string;
    modelDigest: string;
    codeContextDigest: string;
    catalogDigest: string;
    practiceGuidanceDigest: string;
    pressureSignals?: PressureSignal[];
    landscapeDigest?: string;
    activeRepositories?: string[];
    crossRepoRelations?: string[];
    byteLength: number;
    budgetExceeded: boolean;
    digest: string;
  };
}

export interface LandscapeCodeFactsPort {
  syncRepositories(workspaces: WorkspaceRef[]): Promise<unknown[]>;
  buildLandscapeTaskContext(input: {
    task: string;
    workspaces: WorkspaceRef[];
    maxSymbols: number;
    includeSource: boolean;
    activeRepositoryIds?: string[];
  }): Promise<NormalizedCodeContext>;
}

export async function compileTaskContext(input: {
  workspace: WorkspaceRef;
  task: string;
  codeFacts: CodeFactsPort;
  modelStore: ModelStorePort;
  budget: ContextBudget;
}): Promise<CompiledTaskContext> {
  const codeFacts = await input.codeFacts.ensureReady(input.workspace);
  const model = await input.modelStore.validateModel(input.workspace);
  const codeContext = await input.codeFacts.buildTaskContext({
    task: input.task,
    maxSymbols: input.budget.maxItems,
    includeSource: false
  });
  const pressure = detectArchitecturePressure({
    task: input.task,
    symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
    files: [...new Set(codeContext.symbols.map((symbol) => symbol.path))],
    edges: codeContext.edges,
    observedEvidence: codeContext.evidence
  });
  const confidence = computeRefactorConfidence({
    callerCoverage: codeContext.symbols.length > 0 ? 1 : 0,
    testsAvailable: codeContext.evidence.some((evidence) => evidence.confidence === "verified"),
    rollbackAvailable: true
  });
  const posture = decidePosture(pressure, confidence);
  const resources = [
    { type: "code-context", uri: `archcontext://code-context/${codeContext.digest}`, digest: codeContext.digest },
    { type: "model", uri: `archcontext://model/${model.modelDigest}`, digest: model.modelDigest }
  ];
  const catalog = loadPracticeCatalog({ root: input.workspace.root });
  const practiceGuidance = matchPracticesForTask({
    task: input.task,
    catalog,
    codeContext,
    pressure,
    maxMatches: Math.min(5, Math.max(3, input.budget.maxItems))
  });
  let context: Omit<CompiledTaskContext, "extensions"> = {
    schemaVersion: "archcontext.task-context/v1" as const,
    task: input.task,
    posture,
    architecturePressure: {
      level: pressure.level,
      score: pressure.score,
      signals: pressure.signals.map((signal) => signal.type)
    },
    refactorConfidence: {
      level: confidence.level,
      score: confidence.score,
      coverage: confidence.coverage
    },
    relevantNodes: codeContext.symbols.map((symbol) => symbol.id).slice(0, input.budget.maxItems),
    constraints: practiceGuidance.constraints,
    decisions: practiceGuidance.decisions,
    realConstraints: practiceGuidance.realConstraints,
    unknowns: practiceGuidance.unknowns,
    recommendedTargetState: {
      practiceCatalogDigest: practiceGuidance.catalogDigest,
      topPracticeIds: practiceGuidance.matches.map((match) => match.practiceId)
    } as Record<string, Json>,
    requiredCheckpoints: unique(["before-task-complete", ...practiceGuidance.requiredCheckpoints]),
    resources: [...resources, ...practiceGuidance.resources],
    practiceGuidance
  };
  const byteLength = Buffer.byteLength(JSON.stringify(context), "utf8");
  if (byteLength > input.budget.maxBytes) {
    const trimmedPracticeGuidance = trimPracticeGuidance(practiceGuidance, Math.max(1, Math.floor(input.budget.maxItems / 2)));
    context = {
      ...context,
      relevantNodes: context.relevantNodes.slice(0, Math.max(1, Math.floor(input.budget.maxItems / 2))),
      constraints: trimmedPracticeGuidance.constraints,
      decisions: trimmedPracticeGuidance.decisions,
      realConstraints: trimmedPracticeGuidance.realConstraints,
      unknowns: trimmedPracticeGuidance.unknowns,
      requiredCheckpoints: unique(["before-task-complete", ...trimmedPracticeGuidance.requiredCheckpoints]),
      resources: [...resources.slice(0, 1), ...trimmedPracticeGuidance.resources],
      practiceGuidance: trimmedPracticeGuidance
    };
  }
  return finalizeContext(context, {
    codeFactsDigest: codeFacts.schemaDigest,
    modelDigest: model.modelDigest,
    codeContextDigest: codeContext.digest,
    catalogDigest: practiceGuidance.catalogDigest,
    practiceGuidanceDigest: digestJson(practiceGuidance as unknown as Json),
    pressureSignals: pressure.signals,
    maxBytes: input.budget.maxBytes
  });
}

export async function compileLandscapeTaskContext(input: {
  landscape: Landscape;
  relations: CrossRepoRelation[];
  workspaces: WorkspaceRef[];
  task: string;
  codeFacts: LandscapeCodeFactsPort;
  modelStore: ModelStorePort;
  budget: ContextBudget;
}): Promise<CompiledTaskContext> {
  const active = activeRepositoriesForTask(input.landscape, input.task);
  const activeRepositoryIds = active.map((repo) => repo.repositoryId);
  const workspaceByRepository = new Map(input.workspaces.map((workspace) => [workspace.repositoryId, workspace]));
  const selectedWorkspaces = activeRepositoryIds
    .map((repositoryId) => workspaceByRepository.get(repositoryId))
    .filter((workspace): workspace is WorkspaceRef => Boolean(workspace));
  await input.codeFacts.syncRepositories(selectedWorkspaces);
  const model = await input.modelStore.validateModel(selectedWorkspaces[0] ?? input.workspaces[0]);
  const codeContext = await input.codeFacts.buildLandscapeTaskContext({
    task: input.task,
    workspaces: selectedWorkspaces,
    maxSymbols: input.budget.maxItems,
    includeSource: false,
    activeRepositoryIds
  });
  const pressure = detectArchitecturePressure({
    task: input.task,
    symbols: codeContext.symbols.map((symbol) => `${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`),
    files: [...new Set(codeContext.symbols.map((symbol) => symbol.path))],
    edges: codeContext.edges,
    observedEvidence: codeContext.evidence
  });
  const confidence = computeRefactorConfidence({
    callerCoverage: codeContext.symbols.length > 0 ? 1 : 0,
    testsAvailable: codeContext.evidence.some((evidence) => evidence.confidence === "verified"),
    rollbackAvailable: true
  });
  const posture = decidePosture(pressure, confidence);
  const landscapeHash = landscapeDigest(input.landscape, input.relations);
  const resources = [
    { type: "landscape", uri: `archcontext://landscape/${landscapeHash}`, digest: landscapeHash },
    { type: "code-context", uri: `archcontext://code-context/${codeContext.digest}`, digest: codeContext.digest },
    { type: "model", uri: `archcontext://model/${model.modelDigest}`, digest: model.modelDigest }
  ];
  const catalogRoot = (selectedWorkspaces[0] ?? input.workspaces[0]).root;
  const catalog = loadPracticeCatalog({ root: catalogRoot });
  const practiceGuidance = matchPracticesForTask({
    task: input.task,
    catalog,
    codeContext,
    pressure,
    maxMatches: Math.min(5, Math.max(3, input.budget.maxItems))
  });
  let context: Omit<CompiledTaskContext, "extensions"> = {
    schemaVersion: "archcontext.task-context/v1",
    task: input.task,
    posture,
    architecturePressure: {
      level: pressure.level,
      score: pressure.score,
      signals: pressure.signals.map((signal) => signal.type)
    },
    refactorConfidence: {
      level: confidence.level,
      score: confidence.score,
      coverage: confidence.coverage
    },
    relevantNodes: codeContext.symbols.map((symbol) => symbol.id).slice(0, input.budget.maxItems),
    constraints: practiceGuidance.constraints,
    decisions: practiceGuidance.decisions,
    realConstraints: unique(["cross-repo-content-local-only", "git-worktree-is-collaboration-boundary", ...practiceGuidance.realConstraints]),
    unknowns: [],
    recommendedTargetState: {
      activeRepositories: activeRepositoryIds,
      practiceCatalogDigest: practiceGuidance.catalogDigest,
      topPracticeIds: practiceGuidance.matches.map((match) => match.practiceId)
    } as Record<string, Json>,
    requiredCheckpoints: unique(["before-task-complete", "landscape-scope-review", ...practiceGuidance.requiredCheckpoints]),
    resources: [...resources, ...practiceGuidance.resources],
    practiceGuidance
  };
  const byteLength = Buffer.byteLength(JSON.stringify(context), "utf8");
  if (byteLength > input.budget.maxBytes) {
    const trimmedPracticeGuidance = trimPracticeGuidance(practiceGuidance, Math.max(1, Math.floor(input.budget.maxItems / 2)));
    context = {
      ...context,
      relevantNodes: context.relevantNodes.slice(0, Math.max(1, Math.floor(input.budget.maxItems / 2))),
      constraints: trimmedPracticeGuidance.constraints,
      decisions: trimmedPracticeGuidance.decisions,
      realConstraints: unique(["cross-repo-content-local-only", "git-worktree-is-collaboration-boundary", ...trimmedPracticeGuidance.realConstraints]),
      requiredCheckpoints: unique(["before-task-complete", "landscape-scope-review", ...trimmedPracticeGuidance.requiredCheckpoints]),
      resources: [...resources.slice(0, 2), ...trimmedPracticeGuidance.resources],
      practiceGuidance: trimmedPracticeGuidance
    };
  }
  return finalizeContext(context, {
    codeFactsDigest: digestJson({
      repositories: activeRepositoryIds,
      codeContextDigest: codeContext.digest
    }),
    modelDigest: model.modelDigest,
    codeContextDigest: codeContext.digest,
    catalogDigest: practiceGuidance.catalogDigest,
    practiceGuidanceDigest: digestJson(practiceGuidance as unknown as Json),
    pressureSignals: pressure.signals,
    landscapeDigest: landscapeHash,
    activeRepositories: activeRepositoryIds,
    crossRepoRelations: input.relations.map((relation) => relation.id),
    maxBytes: input.budget.maxBytes
  });
}

function finalizeContext(
  context: Omit<CompiledTaskContext, "extensions">,
  digests: {
    codeFactsDigest: string;
    modelDigest: string;
    codeContextDigest: string;
    catalogDigest: string;
    practiceGuidanceDigest: string;
    pressureSignals: PressureSignal[];
    landscapeDigest?: string;
    activeRepositories?: string[];
    crossRepoRelations?: string[];
    maxBytes: number;
  }
): CompiledTaskContext {
  const byteLength = Buffer.byteLength(JSON.stringify(context), "utf8");
  const withMetadata = {
    ...context,
    extensions: {
      codeFactsDigest: digests.codeFactsDigest,
      modelDigest: digests.modelDigest,
      codeContextDigest: digests.codeContextDigest,
      catalogDigest: digests.catalogDigest,
      practiceGuidanceDigest: digests.practiceGuidanceDigest,
      pressureSignals: digests.pressureSignals,
      landscapeDigest: digests.landscapeDigest,
      activeRepositories: digests.activeRepositories,
      crossRepoRelations: digests.crossRepoRelations,
      byteLength,
      budgetExceeded: byteLength > digests.maxBytes
    }
  };
  return {
    ...withMetadata,
    extensions: {
      ...withMetadata.extensions,
      digest: digestJson(withMetadata as unknown as Json)
    }
  };
}

function trimPracticeGuidance(guidance: PracticeGuidanceResultV1, maxMatches: number): PracticeGuidanceResultV1 {
  const matches = guidance.matches.slice(0, maxMatches);
  return {
    ...guidance,
    matches,
    constraints: guidance.constraints.slice(0, maxMatches),
    decisions: guidance.decisions.slice(0, maxMatches),
    realConstraints: guidance.realConstraints.slice(0, maxMatches * 2),
    unknowns: guidance.unknowns.slice(0, maxMatches),
    requiredCheckpoints: guidance.requiredCheckpoints.filter((checkpoint) => matches.some((match) => checkpoint.includes(match.practiceId))),
    resources: guidance.resources.filter((resource) => matches.some((match) => resource.uri.includes(match.practiceId)))
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
