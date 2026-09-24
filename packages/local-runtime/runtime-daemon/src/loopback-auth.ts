import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function matchesLoopbackAuthority(request: IncomingMessage, expectedUrl: string): boolean {
  const expected = new URL(expectedUrl);
  return request.headers.host === expected.host
    && (request.headers.origin === undefined || request.headers.origin === expected.origin);
}

export function matchesSecret(value: unknown, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actualBytes = Buffer.from(value, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
