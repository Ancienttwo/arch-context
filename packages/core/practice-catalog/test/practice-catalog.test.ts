import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadPracticeCatalog, practiceAssetDigest, practiceCatalogEnvelope } from "../src/index";
import type { PracticeAssetV1, PracticeSourceRecordV1 } from "@archcontext/contracts";

describe("@archcontext/core/practice-catalog", () => {
  test("loads the built-in catalog with deterministic digests", () => {
    const catalog = loadPracticeCatalog({ includeRepoOverlay: false });
    const staticManifest = JSON.parse(readFileSync(resolve(process.cwd(), "packages/core/practice-catalog/assets/catalog.yaml"), "utf8"));
    expect(catalog.errors).toEqual([]);
    expect(catalog.catalogVersion).toBe("2026.06.0");
    expect(catalog.catalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(catalog.overlayDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(catalog.effectiveAssets).toHaveLength(12);
    expect(catalog.manifest.entries.map((entry) => entry.id)).toEqual(catalog.manifest.entries.map((entry) => entry.id).sort());
    expect(catalog.effectiveAssets.every((asset) => asset.asset.enforcement.default === "advisory")).toBe(true);
    expect(catalog.effectiveAssets.map((asset) => asset.asset.id)).toContain("compatibility.single-owner");
    expect(catalog.manifest).toEqual(staticManifest);
  });

  test("validates source records and rejects unsupported checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-practices-invalid-"));
    try {
      writeSource(dir, sourceRecord("archcontext.spec"));
      writePractice(dir, {
        ...practice("compatibility.invalid-check"),
        checks: [{ checkId: "not-a-real-check", mode: "deterministic", parameters: {} }]
      });
      const catalog = loadPracticeCatalog({ builtInAssetsDir: dir, includeRepoOverlay: false });
      expect(catalog.errors.map((issue) => issue.code)).toContain("practice-check-unsupported");
      expect(practiceCatalogEnvelope(dir, { action: "validate", strict: true }).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects invalid globs and blocked built-in source license levels", () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-practices-invalid-glob-"));
    try {
      writeSource(dir, {
        ...sourceRecord("blocked.source"),
        licenseLevel: "C",
        usagePolicy: "builtin-with-attribution"
      });
      writePractice(dir, {
        ...practice("compatibility.invalid-glob"),
        appliesTo: {
          ...practice("compatibility.invalid-glob").appliesTo,
          pathGlobs: ["../escape/**"]
        },
        provenance: {
          ...practice("compatibility.invalid-glob").provenance,
          sourceRefs: [{ sourceId: "blocked.source" }]
        }
      });
      const catalog = loadPracticeCatalog({ builtInAssetsDir: dir, includeRepoOverlay: false });
      expect(catalog.errors.map((issue) => issue.code)).toContain("practice-glob-invalid");
      expect(catalog.errors.map((issue) => issue.code)).toContain("practice-source-license-blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repo overlay can add, replace, and disable only with explicit mode", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-practices-overlay-"));
    try {
      writeRepoPractice(root, {
        ...practice("compatibility.single-owner"),
        revision: 2,
        title: "Repository-owned compatibility paths need a named accountable owner",
        overlay: { mode: "replace", extends: "compatibility.single-owner" }
      });
      writeRepoPractice(root, {
        ...practice("repo.custom-practice"),
        title: "Repo custom practice"
      });
      writeRepoPractice(root, {
        ...practice("security.least-privilege"),
        status: "disabled",
        lifecycle: {
          introducedAt: "2026-06-23",
          reviewAfter: "2026-07-23",
          supersedes: [],
          disabledWithReason: "covered by stricter internal security policy"
        },
        overlay: { mode: "disable" }
      });

      const catalog = loadPracticeCatalog({ root });
      expect(catalog.errors).toEqual([]);
      expect(catalog.effectiveAssets.find((asset) => asset.asset.id === "compatibility.single-owner")?.asset.revision).toBe(2);
      expect(catalog.effectiveAssets.map((asset) => asset.asset.id)).toContain("repo.custom-practice");
      expect(catalog.effectiveAssets.map((asset) => asset.asset.id)).not.toContain("security.least-privilege");
      expect(catalog.overlayDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo overlay rejects silent duplicate IDs", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-practices-duplicate-"));
    try {
      writeRepoPractice(root, practice("compatibility.single-owner"));
      const catalog = loadPracticeCatalog({ root });
      expect(catalog.errors.map((issue) => issue.code)).toContain("practice-silent-duplicate-id");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo overlay rejects symlinked catalog files", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-practices-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "archctx-practices-outside-"));
    try {
      const overlayDir = join(root, ".archcontext/practices");
      mkdirSync(overlayDir, { recursive: true });
      const target = join(outside, "target.yaml");
      writeFileSync(target, JSON.stringify(practice("repo.symlinked-practice")), "utf8");
      try {
        symlinkSync(target, join(overlayDir, "link.yaml"));
      } catch {
        return;
      }
      const catalog = loadPracticeCatalog({ root });
      expect(catalog.errors.map((issue) => issue.code)).toContain("practice-file-symlink-denied");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("asset digest is key-order stable", () => {
    const a = practice("repo.digest-stability");
    const b: PracticeAssetV1 = {
      lifecycle: a.lifecycle,
      provenance: a.provenance,
      enforcement: a.enforcement,
      checks: a.checks,
      guidance: a.guidance,
      evidencePolicy: a.evidencePolicy,
      triggers: a.triggers,
      appliesTo: a.appliesTo,
      tags: a.tags,
      category: a.category,
      summary: a.summary,
      title: a.title,
      status: a.status,
      revision: a.revision,
      id: a.id,
      schemaVersion: a.schemaVersion
    };
    expect(practiceAssetDigest(a)).toBe(practiceAssetDigest(b));
  });
});

function writePractice(root: string, asset: PracticeAssetV1): void {
  const dir = join(root, "practices");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${asset.id}.yaml`), JSON.stringify(asset, null, 2), "utf8");
}

function writeRepoPractice(root: string, asset: PracticeAssetV1): void {
  const dir = join(root, ".archcontext/practices");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${asset.id}.yaml`), JSON.stringify(asset, null, 2), "utf8");
}

function writeSource(root: string, source: PracticeSourceRecordV1): void {
  const dir = join(root, "sources");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${source.id}.yaml`), JSON.stringify(source, null, 2), "utf8");
}

function sourceRecord(id: string): PracticeSourceRecordV1 {
  return {
    schemaVersion: "archcontext.practice-source/v1",
    id,
    name: id,
    sourceType: "archcontext",
    uri: "docs/spec.md",
    revision: "2026-06-23",
    licenseSpdx: "LicenseRef-ArchContext-Repo",
    licenseLevel: "A",
    usagePolicy: "repo-authored",
    retrievedAt: "2026-06-23T00:00:00Z",
    contentDigest: `sha256:${"a".repeat(64)}`,
    attribution: "ArchContext maintainers",
    review: {
      status: "approved",
      reviewer: "archcontext-maintainers",
      reviewedAt: "2026-06-23"
    }
  };
}

function practice(id: string): PracticeAssetV1 {
  return {
    schemaVersion: "archcontext.practice/v1",
    id,
    revision: 1,
    status: "active",
    title: id,
    summary: "Test practice.",
    category: id.split(".")[0],
    tags: ["test"],
    appliesTo: {
      repositoryKinds: ["application"],
      languages: [],
      frameworks: [],
      pathGlobs: ["**/*"],
      nodeKinds: ["module"]
    },
    triggers: {
      candidateTerms: ["test"],
      pressureSignals: ["test-signal"],
      structuralPredicates: ["test-predicate"]
    },
    evidencePolicy: {
      minimumStrengthForRecommendation: "heuristic",
      minimumStrengthForCheckpoint: "observed",
      minimumStrengthForEnforcement: "observed",
      requiredKindsForEnforcement: ["diff"],
      maxEnforcementWhenOnlyHeuristic: "advisory"
    },
    guidance: {
      questions: ["What is being tested?"],
      preferred: ["Keep it deterministic."],
      avoid: ["Do not depend on prose."]
    },
    checks: [
      {
        checkId: "compatibility-contract-required",
        mode: "deterministic",
        parameters: {}
      }
    ],
    enforcement: {
      default: "advisory",
      promotableTo: "checkpoint",
      repoOptInRequired: true
    },
    provenance: {
      sourceKind: "archcontext-native",
      sourceRefs: [{ sourceId: "archcontext.spec" }],
      curator: "archcontext-maintainers",
      reviewedAt: "2026-06-23"
    },
    lifecycle: {
      introducedAt: "2026-06-23",
      reviewAfter: "2027-06-23",
      supersedes: []
    }
  };
}
