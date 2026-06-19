import {
  digestJson,
  type Json,
  type RetrievalConfig,
  type RetrievalDecisionRecord,
  type RetrievalDecisionThresholds,
  type RetrievalEvalQuery,
  type RetrievalEvalSet,
  type RetrievalScore
} from "../../contracts/src/index";

export interface RetrievalDocument {
  id: string;
  text: string;
  constraintIds?: string[];
}

export interface RetrievalHit {
  id: string;
  score: number;
}

export interface RetrievalEvalReport {
  schemaVersion: "archcontext.retrieval-eval-report/v1";
  mode: "fts5" | "embedding";
  evalSetId: string;
  seed: number;
  score: RetrievalScore;
  queryResults: {
    queryId: string;
    hits: RetrievalHit[];
    expectedContextIds: string[];
    expectedConstraintIds: string[];
    prohibitedContextIds: string[];
  }[];
  digest: string;
}

export interface Retriever {
  readonly mode: "fts5" | "embedding";
  search(query: string, documents: RetrievalDocument[], limit: number): RetrievalHit[];
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  schemaVersion: "archcontext.retrieval-config/v1",
  defaultMode: "fts5",
  fts5: { enabled: true },
  embedding: {
    enabled: false,
    provider: "local-deterministic",
    dimensions: 64,
    egress: "forbidden"
  },
  decisionGate: {
    minContextRecallLift: 0.08,
    minConstraintRecallLift: 0.05,
    maxIrrelevantRatio: 0.25,
    maxToolCallIncrease: 0
  }
};

export const REPRESENTATIVE_RETRIEVAL_DOCUMENTS: RetrievalDocument[] = [
  {
    id: "adr.0032",
    text: "Browser Architecture Explorer local loopback read-only token no SaaS source upload",
    constraintIds: ["constraint.zero-egress", "constraint.read-only-explorer"]
  },
  {
    id: "guardrail.local-loopback",
    text: "Explorer binds 127.0.0.1 and rejects non GET methods after token expiry or revocation",
    constraintIds: ["constraint.zero-egress"]
  },
  {
    id: "adr.0033",
    text: "Semantic retrieval embeddings are eval gated default off local vector index only",
    constraintIds: ["constraint.embedding-default-off"]
  },
  {
    id: "saas.source-upload",
    text: "Forbidden anti-pattern upload repository private content patches symbols or architecture bodies to SaaS",
    constraintIds: ["constraint.zero-egress"]
  },
  {
    id: "sprint.production-ga",
    text: "Production GA readback remains pending and cannot be inherited from repo-local deterministic tests",
    constraintIds: ["constraint.production-debt"]
  }
];

export function createRepresentativeRetrievalEvalSet(): RetrievalEvalSet {
  return {
    schemaVersion: "archcontext.retrieval-eval/v1",
    id: "eval.archctx-s4.context-recall.v1",
    seed: 42,
    queries: [
      {
        id: "q.explorer-loopback",
        text: "local browser explorer loopback token read only",
        expectedContextIds: ["adr.0032", "guardrail.local-loopback"],
        expectedConstraintIds: ["constraint.zero-egress", "constraint.read-only-explorer"],
        prohibitedContextIds: ["saas.source-upload"]
      },
      {
        id: "q.embedding-default-off",
        text: "embedding semantic retrieval should stay off until eval wins",
        expectedContextIds: ["adr.0033"],
        expectedConstraintIds: ["constraint.embedding-default-off"],
        prohibitedContextIds: ["saas.source-upload"]
      },
      {
        id: "q.production-debt",
        text: "repo local sprint must not claim production GA complete",
        expectedContextIds: ["sprint.production-ga"],
        expectedConstraintIds: ["constraint.production-debt"],
        prohibitedContextIds: ["saas.source-upload"]
      }
    ]
  };
}

export class Fts5BaselineRetriever implements Retriever {
  readonly mode = "fts5" as const;

  search(query: string, documents: RetrievalDocument[], limit: number): RetrievalHit[] {
    const queryTerms = tokenize(query);
    return documents
      .map((document) => {
        const terms = tokenize(document.text);
        const overlap = queryTerms.filter((term) => terms.includes(term)).length;
        const exactBonus = document.text.toLowerCase().includes(query.toLowerCase()) ? 2 : 0;
        return { id: document.id, score: overlap + exactBonus };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}

export class DeterministicEmbeddingRetriever implements Retriever {
  readonly mode = "embedding" as const;

  constructor(private readonly dimensions = DEFAULT_RETRIEVAL_CONFIG.embedding.dimensions) {}

  search(query: string, documents: RetrievalDocument[], limit: number): RetrievalHit[] {
    const queryVector = vectorize(query, this.dimensions);
    return documents
      .map((document) => ({ id: document.id, score: cosine(queryVector, vectorize(document.text, this.dimensions)) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}

export function runRetrievalEval(input: {
  evalSet: RetrievalEvalSet;
  documents: RetrievalDocument[];
  retriever: Retriever;
  limit?: number;
}): RetrievalEvalReport {
  const limit = input.limit ?? 3;
  const queryResults = input.evalSet.queries.map((query) => ({
    queryId: query.id,
    hits: input.retriever.search(query.text, input.documents, limit),
    expectedContextIds: query.expectedContextIds,
    expectedConstraintIds: query.expectedConstraintIds,
    prohibitedContextIds: query.prohibitedContextIds
  }));
  const score = scoreEval(input.evalSet.queries, queryResults, input.documents);
  const reportWithoutDigest = {
    schemaVersion: "archcontext.retrieval-eval-report/v1" as const,
    mode: input.retriever.mode,
    evalSetId: input.evalSet.id,
    seed: input.evalSet.seed,
    score,
    queryResults
  };
  return {
    ...reportWithoutDigest,
    digest: digestJson(reportWithoutDigest as unknown as Json)
  };
}

export function decideEmbedding(input: {
  baseline: RetrievalEvalReport;
  candidate: RetrievalEvalReport;
  thresholds?: RetrievalDecisionThresholds;
  decidedAt?: string;
}): RetrievalDecisionRecord {
  const thresholds = input.thresholds ?? DEFAULT_RETRIEVAL_CONFIG.decisionGate;
  const contextLift = input.candidate.score.contextRecall - input.baseline.score.contextRecall;
  const constraintLift = input.candidate.score.constraintRecall - input.baseline.score.constraintRecall;
  const toolCallIncrease = input.candidate.score.toolCalls - input.baseline.score.toolCalls;
  const wins =
    contextLift >= thresholds.minContextRecallLift &&
    constraintLift >= thresholds.minConstraintRecallLift &&
    input.candidate.score.irrelevantRatio <= thresholds.maxIrrelevantRatio &&
    toolCallIncrease <= thresholds.maxToolCallIncrease;
  return {
    schemaVersion: "archcontext.retrieval-decision/v1",
    decidedAt: input.decidedAt ?? new Date(0).toISOString(),
    baseline: { mode: "fts5", ...input.baseline.score },
    candidate: { mode: "embedding", ...input.candidate.score },
    thresholds,
    decision: wins ? "enable-embedding" : "keep-fts5",
    evidenceDigest: digestJson({ baseline: input.baseline.digest, candidate: input.candidate.digest, thresholds } as unknown as Json)
  };
}

export function assertEmbeddingConfigIsLocalAndDefaultOff(config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG): void {
  if (config.defaultMode !== "fts5") throw new Error("retrieval default mode must remain fts5");
  if (config.embedding.enabled) throw new Error("embedding must be disabled until the decision gate wins");
  if (config.embedding.egress !== "forbidden") throw new Error("embedding egress must be forbidden");
}

function scoreEval(
  queries: RetrievalEvalQuery[],
  queryResults: RetrievalEvalReport["queryResults"],
  documents: RetrievalDocument[]
): RetrievalScore {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  let expectedContexts = 0;
  let matchedContexts = 0;
  let expectedConstraints = 0;
  let matchedConstraints = 0;
  let prohibitedHits = 0;
  let totalHits = 0;
  for (const query of queries) {
    const result = queryResults.find((item) => item.queryId === query.id);
    const hitIds = new Set(result?.hits.map((hit) => hit.id) ?? []);
    expectedContexts += query.expectedContextIds.length;
    matchedContexts += query.expectedContextIds.filter((id) => hitIds.has(id)).length;
    const hitConstraints = new Set(
      [...hitIds].flatMap((id) => documentById.get(id)?.constraintIds ?? [])
    );
    expectedConstraints += query.expectedConstraintIds.length;
    matchedConstraints += query.expectedConstraintIds.filter((id) => hitConstraints.has(id)).length;
    prohibitedHits += query.prohibitedContextIds.filter((id) => hitIds.has(id)).length;
    totalHits += result?.hits.length ?? 0;
  }
  return {
    contextRecall: ratio(matchedContexts, expectedContexts),
    constraintRecall: ratio(matchedConstraints, expectedConstraints),
    irrelevantRatio: ratio(prohibitedHits, Math.max(1, totalHits)),
    toolCalls: queries.length
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

function vectorize(value: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const term of tokenize(value)) {
    let hash = 0;
    for (const char of term) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % dimensions] += 1;
  }
  return vector;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return Number((numerator / denominator).toFixed(4));
}
