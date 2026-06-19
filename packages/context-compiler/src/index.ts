import { digestJson, type CodeFactsPort, type Json, type ModelStorePort, type WorkspaceRef } from "../../contracts/src/index";

export interface ContextBudget {
  maxBytes: number;
  maxItems: number;
}

export interface CompiledTaskContext {
  schemaVersion: "archcontext.task-context/v1";
  task: string;
  codeFactsDigest: string;
  modelDigest: string;
  relevantNodes: string[];
  constraints: string[];
  decisions: string[];
  resources: { type: string; uri: string; digest?: string }[];
  byteLength: number;
  digest: string;
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
  const resources = [
    { type: "code-context", uri: `archcontext://code-context/${codeContext.digest}`, digest: codeContext.digest },
    { type: "model", uri: `archcontext://model/${model.modelDigest}`, digest: model.modelDigest }
  ];
  const context = {
    schemaVersion: "archcontext.task-context/v1" as const,
    task: input.task,
    codeFactsDigest: codeFacts.schemaDigest,
    modelDigest: model.modelDigest,
    relevantNodes: codeContext.symbols.map((symbol) => symbol.id).slice(0, input.budget.maxItems),
    constraints: [],
    decisions: [],
    resources,
    byteLength: 0,
    digest: ""
  };
  const byteLength = Buffer.byteLength(JSON.stringify(context), "utf8");
  const bounded: CompiledTaskContext = {
    ...context,
    byteLength: Math.min(byteLength, input.budget.maxBytes),
    digest: digestJson(context as unknown as Json)
  };
  if (byteLength > input.budget.maxBytes) {
    return {
      ...bounded,
      relevantNodes: bounded.relevantNodes.slice(0, Math.max(1, Math.floor(input.budget.maxItems / 2))),
      resources: resources.slice(0, 1)
    };
  }
  return bounded;
}
