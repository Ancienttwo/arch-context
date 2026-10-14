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
