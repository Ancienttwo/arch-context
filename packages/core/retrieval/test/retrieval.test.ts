import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  DeterministicEmbeddingRetriever,
  InMemoryLexicalRetriever,
  REPRESENTATIVE_CHINESE_RETRIEVAL_DOCUMENTS,
  REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
  assertEmbeddingConfigIsLocalAndDefaultOff,
  createChineseRetrievalEvalSet,
  createRepresentativeRetrievalEvalSet,
  decideEmbedding,
  runRetrievalEval,
  tokenizeForSearch
} from "../src/index";

describe("@archcontext/core/retrieval", () => {
  test("in-memory lexical baseline eval is reproducible for the same seed and corpus", () => {
    const evalSet = createRepresentativeRetrievalEvalSet();
    const first = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new InMemoryLexicalRetriever()
    });
    const second = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new InMemoryLexicalRetriever()
    });
    expect(first).toEqual(second);
    expect(first.score.contextRecall).toBeGreaterThanOrEqual(0.8);
    expect(first.digest).toMatch(/^sha256:/);
  });

  test("embedding candidate does not enable unless it clearly beats the lexical baseline", () => {
    const evalSet = createRepresentativeRetrievalEvalSet();
    const baseline = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new InMemoryLexicalRetriever()
    });
    const candidate = runRetrievalEval({
      evalSet,
      documents: REPRESENTATIVE_RETRIEVAL_DOCUMENTS,
      retriever: new DeterministicEmbeddingRetriever()
    });
    const decision = decideEmbedding({ baseline, candidate, decidedAt: "2026-06-20T00:00:00.000Z" });
    expect(decision.schemaVersion).toBe("archcontext.retrieval-decision/v1");
    expect(decision.decision).toBe("keep-lexical");
    expect(decision.baseline.mode).toBe("lexical");
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

  test("Chinese retrieval uses jieba search tokenization", () => {
    const tokens = tokenizeForSearch("中文搜索要用结巴分词");
    expect(tokens).toContain("中文搜索");
    expect(tokens).toContain("分词");

    const report = runRetrievalEval({
      evalSet: createChineseRetrievalEvalSet(),
      documents: REPRESENTATIVE_CHINESE_RETRIEVAL_DOCUMENTS,
      retriever: new InMemoryLexicalRetriever(),
      limit: 1
    });
    expect(report.score.contextRecall).toBe(1);
    expect(report.score.constraintRecall).toBe(1);
    expect(report.score.irrelevantRatio).toBe(0);
  });
});
