import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the local-runtime SCC fix (scc.cd1c0fb7a216355a): the daemon facade (`./index`) used to be
 * the only place several RPC argument/result types lived, which made `rpc-methods.ts` and
 * `developer-review-codec.ts` import back from the facade that composes them, closing a cycle.
 * Those types now live in `rpc-types.ts` (and the developer-review types in
 * `developer-review-codec.ts` itself, next to their decoders), so no file needs `./index` for a
 * type, and the six contract files only ever look at contracts, core, git-adapter, or each other.
 */

const SRC_DIR = join(import.meta.dir, "../src");

const CONTRACT_FILES = ["rpc-methods.ts", "rpc-types.ts", "rpc-protocol.ts", "developer-review-codec.ts", "rpc-argument-codec.ts", "rpc-client.ts"];

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /\bfrom\s+["']([^"']+)["']/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) specifiers.push(match[1]);
  return specifiers;
}

function isAllowedContractSpecifier(specifier: string): boolean {
  if (specifier === "@archcontext/contracts") return true;
  if (specifier === "@archcontext/local-runtime/git-adapter") return true;
  if (specifier === "@archcontext/core" || specifier.startsWith("@archcontext/core/")) return true;
  return CONTRACT_FILES.some(file => specifier === `./${file.replace(/\.ts$/, "")}`);
}

describe("runtime-daemon RPC contract boundary (scc.cd1c0fb7a216355a)", () => {
  const sourceFiles = readdirSync(SRC_DIR).filter(name => name.endsWith(".ts"));

  test("no runtime-daemon/src file imports the ./index facade", () => {
    const offenders = sourceFiles.filter(name => importSpecifiers(readFileSync(join(SRC_DIR, name), "utf8")).includes("./index"));
    expect(offenders).toEqual([]);
  });

  test("contract files import only contracts, core, git-adapter, or each other", () => {
    const violations: Array<{ file: string; specifier: string }> = [];
    for (const file of CONTRACT_FILES) {
      const source = readFileSync(join(SRC_DIR, file), "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (!isAllowedContractSpecifier(specifier)) violations.push({ file, specifier });
      }
    }
    expect(violations).toEqual([]);
  });
});
