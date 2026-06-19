import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  DeterministicEmbeddingRetriever,
  Fts5BaselineRetriever,
  REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
  assertEmbeddingConfigIsLocalAndDefaultOff,
  createRepresentativeRetrievalEvalSet,
  decideEmbedding,
  runRetrievalEval
} from "../src/index";

describe("@archcontext/retrieval", () => {
  test("FTS5 baseline eval is reproducible for the same seed and corpus", () => {
    const evalSet = createRepresentativeRetrievalEvalSet();
    const first = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new Fts5BaselineRetriever()
    });
    const second = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new Fts5BaselineRetriever()
    });
    expect(first).toEqual(second);
    expect(first.score.contextRecall).toBeGreaterThanOrEqual(0.8);
    expect(first.digest).toMatch(/^sha256:/);
  });

  test("embedding candidate does not enable unless it clearly beats FTS5", () => {
    const evalSet = createRepresentativeRetrievalEvalSet();
    const baseline = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new Fts5BaselineRetriever()
    });
    const candidate = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new DeterministicEmbeddingRetriever()
    });
    const decision = decideEmbedding({ baseline, candidate, decidedAt: "2026-06-20T00:00:00.000Z" });
    expect(decision.schemaVersion).toBe("archcontext.retrieval-decision/v1");
    expect(decision.decision).toBe("keep-fts5");
    expect(decision.baseline.mode).toBe("fts5");
    expect(decision.candidate.mode).toBe("embedding");
    expect(decision.evidenceDigest).toMatch(/^sha256:/);
  });

  test("embedding configuration is local and default-off", () => {
    expect(() => assertEmbeddingConfigIsLocalAndDefaultOff(DEFAULT_RETRIEVAL_CONFIG)).not.toThrow();
    expect(() => assertEmbeddingConfigIsLocalAndDefaultOff({
      ...DEFAULT_RETRIEVAL_CONFIG,
      embedding: { ...DEFAULT_RETRIEVAL_CONFIG.embedding, enabled: true }
    })).toThrow("disabled");
  });
});
