import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict.js";
import { containsChinese, tokenizeEnglish, unique, type SearchTokenizer } from "@archcontext/core/retrieval";

function normalizeJiebaTerm(term: string): string[] {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];
  if (/^[a-z0-9]+$/.test(normalized)) return tokenizeEnglish(normalized);
  if (!containsChinese(normalized)) return [];
  return normalized.length >= 2 ? [normalized] : [];
}

/**
 * Runtime Chinese/English lexical search tokenizer backed by native `@node-rs/jieba`.
 * Lives in `@archcontext/local-runtime` so `@archcontext/core` has zero native addons.
 */
export class JiebaSearchTokenizer implements SearchTokenizer {
  constructor(private readonly segmenter = Jieba.withDict(dict)) {}

  tokenize(value: string): string[] {
    const englishTerms = tokenizeEnglish(value);
    const chineseTerms = containsChinese(value)
      ? this.segmenter.cutForSearch(value, true).flatMap(normalizeJiebaTerm)
      : [];
    return unique([...englishTerms, ...chineseTerms]);
  }
}

let cachedJiebaTokenizer: SearchTokenizer | undefined;

export function defaultJiebaSearchTokenizer(): SearchTokenizer {
  cachedJiebaTokenizer ??= new JiebaSearchTokenizer();
  return cachedJiebaTokenizer;
}
