import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHITECTURE_DOCS_LANGUAGES,
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  loadArchitectureDocumentationInputs,
  loadArchitectureDocumentationLanguage,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocsLanguage,
  type ArchitectureDocumentationProjectionPlan,
  type NativeModel
} from "../src/index";
import type { ProjectionTargetV1 } from "@archcontext/contracts";

/** The region markers of a target that owns a marked region; every entity summary does. */
function regionMarkers(target: ProjectionTargetV1): { startMarker: string; endMarker: string } {
  if (target.ownership !== "mixed") throw new Error(`${target.targetId} owns its whole file, not a marked region`);
  return target.generatedRegion;
}

const sourceDigest = `sha256:${"3".repeat(64)}`;
const provenance = architectureDocumentationProjectionProvenance({
  sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
  layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.2" }
});
const model: NativeModel = {
  nodes: [
    { id: "module.payment", kind: "module", name: "Payment" },
    { id: "module.billing", kind: "module", name: "Billing" }
  ],
  relations: []
};

function render(overrides: Partial<Parameters<typeof renderArchitectureDocumentationProjection>[0]> = {}): ArchitectureDocumentationProjectionPlan {
  return renderArchitectureDocumentationProjection({
    model,
    provenance,
    sourceDigest,
    sourceFootprints: [],
    sourceScaleSignals: [],
    importGraphs: [],
    selectorEvidence: [],
    ...overrides
  });
}

function entity(plan: ArchitectureDocumentationProjectionPlan, nodeId: string) {
  const file = plan.files.find((entry) => entry.target.type === "entity-summary" && entry.target.scope.id === nodeId);
  if (!file) throw new Error(`entity-summary file missing for ${nodeId}`);
  return file;
}

/** The text before the generated region and the text after it. */
function outside(file: ReturnType<typeof entity>): { before: string; after: string } {
  const start = file.body.indexOf(regionMarkers(file.target).startMarker);
  const end = file.body.indexOf(regionMarkers(file.target).endMarker) + regionMarkers(file.target).endMarker.length + 1;
  return { before: file.body.slice(0, start), after: file.body.slice(end) };
}

const LEGACY_SKELETON = {
  before: "# module/payment 架構文檔\n\n",
  after: "\n## 3. P3:設計決策與不變量\n\n## 4. 歷史決策記錄(append-only)\n\n## Optimization Backlog\n"
};

const EXPECTED_SKELETONS: Record<ArchitectureDocsLanguage, { before: string; after: string }> = {
  "zh-Hant": {
    before: "# module/payment 架構文檔\n\n",
    after: "\n## 3. P3：設計決策與不變量\n\n## 4. 歷史決策記錄（append-only）\n\n## Optimization Backlog\n"
  },
  "zh-Hans": {
    before: "# module/payment 架构文档\n\n",
    after: "\n## 3. P3：设计决策与不变量\n\n## 4. 历史决策记录（append-only）\n\n## Optimization Backlog\n"
  },
  en: {
    before: "# module/payment Architecture\n\n",
    after: "\n## 3. P3: Design Decisions and Invariants\n\n## 4. Decision History (append-only)\n\n## Optimization Backlog\n"
  }
};

describe("module document skeleton language (#302)", () => {
  test("without docs.language a new document keeps the legacy skeleton byte for byte", () => {
    expect(outside(entity(render(), "module.payment"))).toEqual(LEGACY_SKELETON);
  });

  test("the supported languages are exactly zh-Hant, zh-Hans and en", () => {
    expect([...ARCHITECTURE_DOCS_LANGUAGES] as string[]).toEqual(Object.keys(EXPECTED_SKELETONS));
  });

  for (const language of ARCHITECTURE_DOCS_LANGUAGES) {
    test(`a new document gets the ${language} skeleton; the generated region does not change`, () => {
      const legacy = entity(render(), "module.payment");
      const localized = entity(render({ docsLanguage: language }), "module.payment");
      expect(outside(localized)).toEqual(EXPECTED_SKELETONS[language]);
      expect(localized.generatedBodyDigest).toBe(legacy.generatedBodyDigest);
      expect(localized.target).toEqual(legacy.target);
    });
  }

  test("a re-render never rewrites the headings of an existing document, whatever docs.language says", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const payment = entity(first, "module.payment");
    const withHumanText = payment.body.replace("## 3. P3:設計決策與不變量\n", "## 3. P3:設計決策與不變量\n\n- Payments are idempotent.\n");
    const seeded = existingFiles.map((file) => file.path === payment.path ? { ...file, body: withHumanText } : file);
    for (const language of ARCHITECTURE_DOCS_LANGUAGES) {
      const again = render({ docsLanguage: language, existingFiles: seeded });
      expect(entity(again, "module.payment").body).toBe(withHumanText);
      expect(entity(again, "module.billing").body).toBe(entity(first, "module.billing").body);
      expect(again.drift.diffs.filter((diff) => diff.path !== first.manifest.path)).toEqual([]);
    }
  });

  test("only the new document of a mixed tree gets the configured headings", () => {
    const first = render({ model: { ...model, nodes: [model.nodes[0]!] } });
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const second = render({ docsLanguage: "en", existingFiles });
    expect(outside(entity(second, "module.payment"))).toEqual(LEGACY_SKELETON);
    expect(outside(entity(second, "module.billing")).before).toBe("# module/billing Architecture\n\n");
    expect(outside(entity(second, "module.billing")).after).toBe(EXPECTED_SKELETONS.en.after);
  });

  test("an unsupported docs.language fails closed", () => {
    expect(() => render({ docsLanguage: "fr" as ArchitectureDocsLanguage })).toThrow("architecture-docs-language-invalid");
  });

  test("an untouched orphan is deletable whichever language its skeleton was written in", () => {
    for (const language of [undefined, ...ARCHITECTURE_DOCS_LANGUAGES]) {
      const written = render({ ...(language ? { docsLanguage: language } : {}) });
      const existing = [...written.files.map(({ path, body }) => ({ path, body })), written.manifest];
      const billing = entity(written, "module.billing");
      // The current setting differs from the one that wrote the orphan; deletion still applies.
      const afterRemoval = render({ model: { ...model, nodes: [model.nodes[0]!] }, docsLanguage: "zh-Hans", existingFiles: existing });
      expect(afterRemoval.orphans.map((orphan) => [orphan.path, orphan.disposition])).toEqual([[billing.path, "delete"]]);
    }
  });
});

describe("loadArchitectureDocumentationLanguage (#302)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function repo(manifest: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), "archctx-docs-language-"));
    roots.push(root);
    mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
    if (manifest !== undefined) writeFileSync(join(root, ".archcontext/manifest.yaml"), manifest, "utf8");
    return root;
  }

  test("reads docs.language from .archcontext/manifest.yaml", () => {
    const root = repo('schemaVersion: "archcontext.manifest/v1"\ndocs:\n  language: "zh-Hans"\n');
    expect(loadArchitectureDocumentationLanguage(root)).toBe("zh-Hans");
    expect(loadArchitectureDocumentationInputs(root).docsLanguage).toBe("zh-Hans");
  });

  test("a manifest without docs.language, or no manifest, declares no language", () => {
    expect(loadArchitectureDocumentationLanguage(repo('schemaVersion: "archcontext.manifest/v1"\n'))).toBeUndefined();
    expect(loadArchitectureDocumentationLanguage(repo(undefined))).toBeUndefined();
    expect(loadArchitectureDocumentationInputs(repo(undefined)).docsLanguage).toBeUndefined();
  });

  test("an unsupported docs.language value fails closed", () => {
    const root = repo('schemaVersion: "archcontext.manifest/v1"\ndocs:\n  language: "zh-CN"\n');
    expect(() => loadArchitectureDocumentationLanguage(root)).toThrow("architecture-docs-language-invalid");
  });
});
