/**
 * RF0 characterization freeze for the capability source footprint and the 1–2–5 scale bucket.
 *
 * RF1 replaces the footprint source (working-tree scan → Git-tracked set) and RF2 adds scale
 * classification. Both ride on `loadCapabilitySourceFootprints` / `loadCapabilitySourceScaleSignals`
 * and on the private `scaleMagnitudeBucketLabel`, which is frozen here through the only surface
 * that reaches it — the rendered `- 規模量級:` line of `renderArchitectureDocumentationProjection`.
 * No `export` was added to make the bucket testable.
 *
 * The synthetic tree is committed data too: `input.tree` is the literal file map both this test
 * and the one-shot capture materialize, so nothing is measured against the real repository and
 * nothing here depends on the machine it runs on.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  loadCapabilitySourceFootprints,
  loadCapabilitySourceScaleSignals,
  renderArchitectureDocumentationProjection,
  type NativeModel
} from "../src/index";

interface BaselineFixture<TInput> {
  id: string;
  description: string;
  input: TInput;
  expected: unknown;
  digest: string;
}

function loadFixtures<TInput>(name: string): BaselineFixture<TInput>[] {
  const path = new URL(`./fixtures/refactor-baseline/${name}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BaselineFixture<TInput>[];
  if (parsed.length === 0) throw new Error(`refactor-baseline fixture is empty: ${name}`);
  return parsed;
}

function expectFrozen(actual: Json, fixture: BaselineFixture<unknown>): void {
  expect(actual).toEqual(fixture.expected as Json);
  expect(digestJson(actual)).toBe(fixture.digest);
}

function seedTree(tree: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-rf0-projection-"));
  for (const [path, content] of Object.entries(tree)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return root;
}

describe("RF0 baseline: declared source footprints and scale signals", () => {
  for (const fixture of loadFixtures<{ tree: Record<string, string>; model: NativeModel }>("capability-source-footprints")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      const root = seedTree(fixture.input.tree);
      try {
        expectFrozen(
          {
            footprints: loadCapabilitySourceFootprints(root, fixture.input.model),
            scaleSignals: loadCapabilitySourceScaleSignals(root, fixture.input.model)
          } as unknown as Json,
          fixture
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

// --- 1–2–5 bucket labels, observed through the renderer ---

const sourceDigest = `sha256:${"1".repeat(64)}`;
const provenance = architectureDocumentationProjectionProvenance({
  baseHeadSha: "a".repeat(40), worktreeDigest: sourceDigest, sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest, codeGraphDigest: sourceDigest, indexedWorktreeDigest: sourceDigest,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.5.0", codeGraphBinaryDigest: sourceDigest, codeGraphStatus: "ready" }
});

const bucketModel: NativeModel = {
  nodes: [{ id: "capability.scale", kind: "capability", name: "Scale", status: "active", summary: "Bucket probe.", source: { include: ["packages/scale/**"] } }],
  relations: []
};

/** Renders one projection and returns the single `- 規模量級:` line the bucket label lives on. */
function renderScaleLine(fileCount: number, lineCount: number): string {
  const plan = renderArchitectureDocumentationProjection({
    model: bucketModel,
    sourceDigest,
    provenance,
    verifiedAgainst: { branch: "main", commit: "7415329", committedAt: "2026-08-08T09:30:00+08:00" },
    sourceChangesSinceStamp: [{ nodeId: "capability.scale", commit: "7415329", status: "unchanged" }],
    sourceScaleSignals: [{ nodeId: "capability.scale", fileCount, lineCount, includePatterns: ["packages/scale/**"], excludePatterns: [] }],
    importGraphs: [],
    selectorEvidence: [],
    generatedAt: "2026-08-08T00:00:00.000Z"
  });
  const entity = plan.files.find((file) => file.target.type === "entity-summary");
  if (!entity) throw new Error("entity-summary file missing");
  const line = entity.body.split("\n").find((entry) => entry.startsWith("- 規模量級:"));
  if (!line) throw new Error("scale line missing");
  return line;
}

const bucketFixtures = loadFixtures<{ fileCount: number; lineCount: number }>("scale-magnitude-buckets");

describe("RF0 baseline: 1-2-5 magnitude bucket labels through the renderer", () => {
  for (const fixture of bucketFixtures) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      const rendered = renderScaleLine(fixture.input.fileCount, fixture.input.lineCount);
      const first = rendered.indexOf("`");
      expectFrozen({ renderedLine: rendered, label: rendered.slice(first + 1, rendered.indexOf("`", first + 1)) } as unknown as Json, fixture);
    });
  }

  test("every frozen bucket is the half-open 1-2-5 rung pair that contains the value", () => {
    const scale = (part: string): number =>
      part.endsWith("M") ? Number(part.slice(0, -1)) * 1_000_000 : part.endsWith("k") ? Number(part.slice(0, -1)) * 1_000 : Number(part);
    // Every rung of the ladder the renderer walks, up to the largest value in the frozen table.
    const ladder: number[] = [];
    for (let magnitude = 1; magnitude <= 10_000_000; magnitude *= 10) for (const mantissa of [1, 2, 5]) ladder.push(mantissa * magnitude);
    expect((bucketFixtures[0].expected as { label: string }).label).toBe("0");
    let previousLower = 0;
    for (const [index, fixture] of bucketFixtures.entries()) {
      const label = (fixture.expected as { label: string }).label;
      if (index === 0) continue;
      const [lower, upper] = label.split("–").map(scale);
      const value = fixture.input.fileCount;
      expect(lower).toBeLessThanOrEqual(value);
      expect(upper).toBeGreaterThan(value);
      // Both ends are adjacent rungs of the 1-2-5 ladder, so buckets tile without gap or overlap.
      expect(ladder).toContain(lower);
      expect(ladder[ladder.indexOf(lower) + 1]).toBe(upper);
      expect(lower).toBeGreaterThanOrEqual(previousLower);
      previousLower = lower;
    }
  });

  test("both ends of a label share one unit", () => {
    for (const fixture of bucketFixtures) {
      const label = (fixture.expected as { label: string }).label;
      if (label === "0") continue;
      const [lower, upper] = label.split("–");
      const unit = (part: string) => (part.endsWith("M") ? "M" : part.endsWith("k") ? "k" : "");
      expect(unit(lower)).toBe(unit(upper));
    }
  });
});

describe("RF0 baseline: the bucket refuses a value that is not a count", () => {
  for (const fixture of loadFixtures<{ fileCount: number; lineCount: number }>("scale-magnitude-rejections")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      let message = "";
      try {
        renderScaleLine(fixture.input.fileCount, fixture.input.lineCount);
        throw new Error("expected a rejection");
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expectFrozen({ message } as unknown as Json, fixture);
    });
  }
});
