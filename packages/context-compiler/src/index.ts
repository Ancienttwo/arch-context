import { digestJson, type CodeFactsPort, type Json, type ModelStorePort, type WorkspaceRef } from "../../contracts/src/index";
import type { ArchitecturePosture } from "../../architecture-domain/src/index";
import { detectArchitecturePressure } from "../../pressure-engine/src/index";
import { computeRefactorConfidence, decidePosture } from "../../refactor-decision/src/index";

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
  extensions: {
    codeFactsDigest: string;
    modelDigest: string;
    codeContextDigest: string;
    byteLength: number;
    budgetExceeded: boolean;
    digest: string;
  };
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
    symbols: codeContext.symbols.map((symbol) => symbol.id),
    files: [...new Set(codeContext.symbols.map((symbol) => symbol.path))]
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
    constraints: [],
    decisions: [],
    realConstraints: [],
    unknowns: [],
    recommendedTargetState: {},
    requiredCheckpoints: ["before-task-complete"],
    resources
  };
  const byteLength = Buffer.byteLength(JSON.stringify(context), "utf8");
  if (byteLength > input.budget.maxBytes) {
    context = {
      ...context,
      relevantNodes: context.relevantNodes.slice(0, Math.max(1, Math.floor(input.budget.maxItems / 2))),
      resources: resources.slice(0, 1)
    };
  }
  return finalizeContext(context, {
    codeFactsDigest: codeFacts.schemaDigest,
    modelDigest: model.modelDigest,
    codeContextDigest: codeContext.digest,
    maxBytes: input.budget.maxBytes
  });
}

function finalizeContext(
  context: Omit<CompiledTaskContext, "extensions">,
  digests: { codeFactsDigest: string; modelDigest: string; codeContextDigest: string; maxBytes: number }
): CompiledTaskContext {
  const byteLength = Buffer.byteLength(JSON.stringify(context), "utf8");
  const withMetadata = {
    ...context,
    extensions: {
      codeFactsDigest: digests.codeFactsDigest,
      modelDigest: digests.modelDigest,
      codeContextDigest: digests.codeContextDigest,
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
