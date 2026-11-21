import { nativeByteCompare } from "@archcontext/contracts";

/** Existing ADR-0043 lexical specificity; brackets, braces and ! remain literal. */
export function globLiteralPrefixLength(pattern: string): number {
  const index = pattern.search(/[*?]/);
  return index === -1 ? pattern.length : index;
}

/** Display/discovery anchors only. Never infer file ownership or inspect the filesystem. */
export function sourceIncludeAnchors(patterns: readonly string[]): string[] {
  const anchors = patterns.flatMap(pattern => {
    const literal = globLiteralPrefixLength(pattern);
    if (literal === pattern.length) return [pattern];
    const prefix = pattern.slice(0, literal);
    const slash = prefix.lastIndexOf("/");
    return slash > 0 ? [prefix.slice(0, slash)] : [];
  });
  return [...new Set(anchors)].sort(nativeByteCompare);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

/**
 * Compiled globs by pattern, so each distinct pattern is compiled once per process instead of once
 * per (node, file, pattern) match: recompiling dominated a projection build (#324). The regexes have
 * no `g`/`y` flag, so `test` keeps no state and one instance is safe to share. Patterns come from
 * repository models (`source.include`/`exclude`) and the paths derived from them, which a
 * long-lived daemon re-reads as they change, so the cache drops its oldest entry past a fixed size
 * instead of growing with every pattern it has ever seen.
 */
const GLOB_REGEXP_CACHE_LIMIT = 4096;
const globRegExpCache = new Map<string, RegExp>();
let globRegExpCompilations = 0;

/** Test seam: how many globs this process has compiled (cache misses), never a cache hit. */
export function globRegExpCompilationCount(): number {
  return globRegExpCompilations;
}

export function globToRegExp(pattern: string): RegExp {
  const cached = globRegExpCache.get(pattern);
  if (cached !== undefined) return cached;
  const compiled = compileGlob(pattern);
  globRegExpCompilations += 1;
  if (globRegExpCache.size >= GLOB_REGEXP_CACHE_LIMIT) globRegExpCache.delete(globRegExpCache.keys().next().value!);
  globRegExpCache.set(pattern, compiled);
  return compiled;
}

function compileGlob(pattern: string): RegExp {
  let out = "";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      out += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      out += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index];
    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(char);
    }
    index += 1;
  }
  return new RegExp(`^${out}$`);
}
