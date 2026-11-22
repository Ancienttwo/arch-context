import { describe, expect, test } from "bun:test";
import {
  InMemoryLexicalRetriever,
  REPRESENTATIVE_CHINESE_RETRIEVAL_DOCUMENTS,
  createChineseRetrievalEvalSet,
  runRetrievalEval,
  tokenizeForSearch
} from "@archcontext/core/retrieval";
import { JiebaSearchTokenizer } from "../src/index";

describe("@archcontext/local-runtime/search-tokenizer", () => {
  test("Chinese retrieval uses jieba search tokenization", () => {
    const tokenizer = new JiebaSearchTokenizer();
    const tokens = tokenizeForSearch("中文搜索要用结巴分词", tokenizer);
    expect(tokens).toContain("中文搜索");
    expect(tokens).toContain("分词");

    const report = runRetrievalEval({
      evalSet: createChineseRetrievalEvalSet(),
      documents: REPRESENTATIVE_CHINESE_RETRIEVAL_DOCUMENTS,
      retriever: new InMemoryLexicalRetriever(tokenizer),
      limit: 1
    });
    expect(report.score.contextRecall).toBe(1);
    expect(report.score.constraintRecall).toBe(1);
    expect(report.score.irrelevantRatio).toBe(0);
  });
});
