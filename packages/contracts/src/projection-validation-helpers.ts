export const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const UTF8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return UTF8.encode(value).length;
}

export function sortedUniqueIssues(label: string, values: readonly string[]): string[] {
  const expected = [...new Set(values)].sort();
  return expected.length === values.length && expected.every((value, index) => value === values[index])
    ? []
    : [`${label} must be sorted and unique`];
}
