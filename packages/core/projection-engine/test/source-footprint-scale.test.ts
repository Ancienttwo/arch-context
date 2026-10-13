import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  digestArchitectureDocumentationSourceTree,
  digestCapabilitySourceFootprints,
  globRegExpCompilationCount,
  loadCapabilitySourceFootprintDigests,
  loadCapabilitySourceFootprints,
  measureCapabilitySourceScaleSignals,
  nativeNodeSource,
  projectionOwnedPaths,
  type NativeModel
} from "../src/index";

const NODE_COUNT = 100;

/**
 * About 100 nodes over about 5,000 Git-visible files (#324): each node declares three include and
 * two exclude globs over its own package, 50 files per node. `tag` keeps every pattern distinct
 * from the ones other tests in this process already compiled.
 */
function scaleFixture(tag: string): { model: NativeModel; sourceFiles: string[] } {
  const nodes = Array.from({ length: NODE_COUNT }, (_, index) => {
    const dir = `${tag}/p${index}`;
    return {
      id: `capability.${tag}.p${index}`,
      kind: "capability",
      name: `p${index}`,
      source: {
        include: [`${dir}/src/**`, `${dir}/*.json`, `${tag}/shared/p${index}-*.ts`],
        exclude: [`${dir}/src/**/*.test.ts`, `${dir}/src/generated/**`]
      }
    };
  });
  const sourceFiles = nodes.flatMap((_, index) => {
    const dir = `${tag}/p${index}`;
    return [
      ...Array.from({ length: 40 }, (_, file) => `${dir}/src/mod${file}.ts`),
      ...Array.from({ length: 5 }, (_, file) => `${dir}/src/mod${file}.test.ts`),
      ...Array.from({ length: 3 }, (_, file) => `${dir}/src/generated/g${file}.ts`),
      `${dir}/package.json`,
      `${tag}/shared/p${index}-util.ts`
    ];
  });
  return { model: { nodes, relations: [] } as NativeModel, sourceFiles };
}

/** Every per-build consumer of the footprints, the way one projection build feeds them. */
function measureBuild(root: string, model: NativeModel, sourceFiles: string[]) {
  const footprints = loadCapabilitySourceFootprints(root, model, sourceFiles);
  return {
    footprints,
    digests: digestCapabilitySourceFootprints(root, model, footprints),
    scaleSignals: measureCapabilitySourceScaleSignals(root, footprints),
    sourceTreeDigest: digestArchitectureDocumentationSourceTree(root, model, footprints)
  };
}

function writeFixtureFiles(root: string, sourceFiles: readonly string[]): void {
  for (const path of sourceFiles) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `export const path = ${JSON.stringify(path)};\n`);
  }
}

describe("source footprints at repository scale (#324)", () => {
  // `tag` keeps every pattern new to this process, so the first build must compile each one.
  const { model, sourceFiles } = scaleFixture(`scale${process.pid}x${Date.now()}`);
  let root = "";
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "archctx-footprint-scale-"));
    writeFixtureFiles(root, sourceFiles);
  }, 600_000);
  afterAll(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true });
  });

  test("one build compiles each distinct glob pattern once, and a second build compiles none", () => {
    const modelPatterns = new Set(model.nodes.flatMap((node) => [...(nativeNodeSource(node)?.include ?? []), ...(nativeNodeSource(node)?.exclude ?? [])]));
    const distinctPatterns = new Set([...modelPatterns, ...projectionOwnedPaths(model)]);

    const beforeFirst = globRegExpCompilationCount();
    const first = measureBuild(root, model, sourceFiles);
    const firstCompilations = globRegExpCompilationCount() - beforeFirst;
    // The tagged model patterns are new to this process, so each compiles exactly once; the shared
    // projection-owned patterns compile at most once (another test may have compiled them already).
    expect(firstCompilations).toBeGreaterThanOrEqual(modelPatterns.size);
    expect(firstCompilations).toBeLessThanOrEqual(distinctPatterns.size);

    const beforeSecond = globRegExpCompilationCount();
    const second = measureBuild(root, model, sourceFiles);
    expect(globRegExpCompilationCount() - beforeSecond).toBe(0);
    expect(second).toEqual(first);

    expect(first.footprints).toHaveLength(NODE_COUNT);
    for (const footprint of first.footprints) expect(footprint.files).toHaveLength(42);
  }, 120_000);

  test("100 nodes over 5,000 files resolve, stamp and measure in bounded time", () => {
    expect(sourceFiles).toHaveLength(5_000);
    const started = performance.now();
    const measured = measureBuild(root, model, sourceFiles);
    // The per-file-list entry points resolve the footprints again each; before #324 a build paid
    // this four times with every glob recompiled per (node, file, pattern) match: about 10 s here.
    const digests = loadCapabilitySourceFootprintDigests(root, model, sourceFiles);
    const elapsedMs = performance.now() - started;
    // Cached, both passes together take well under a second. The bound leaves room for a loaded
    // runner; the compile counter above is the exact guard against recompilation.
    expect(elapsedMs).toBeLessThan(5_000);
    expect(measured.digests).toEqual(digests);
    expect(measured.scaleSignals.reduce((total, signal) => total + signal.fileCount, 0)).toBe(NODE_COUNT * 42);
  }, 120_000);
});
