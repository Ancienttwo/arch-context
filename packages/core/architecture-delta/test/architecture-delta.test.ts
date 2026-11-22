import { describe, expect, test } from "bun:test";
import { digestJson, type Json } from "@archcontext/contracts";
import {
  architectureSubjectSelectorId,
  compileArchitectureFactChanges,
  compileEvidenceStateChanges,
  refactorSubjectSelectorId
} from "../src/index";

describe("@archcontext/core/architecture-delta", () => {
  test("separates authoritative graph and evidence state changes", () => {
    const factChanges = compileArchitectureFactChanges(
      { entities: [{ entityId: "module.api", kind: "module", canonicalName: "API" }], relations: [], constraints: [] },
      { entities: [{ entityId: "module.api", kind: "module", canonicalName: "API v2" }, { entityId: "module.db", kind: "module", canonicalName: "DB" }], relations: [], constraints: [] }
    );
    expect(factChanges).toEqual([
      { deltaClass: "architecture-fact", subjectId: "entity:module.api", change: "changed", fields: ["canonicalName"] },
      { deltaClass: "architecture-fact", subjectId: "entity:module.db", change: "added", fields: ["entity"] }
    ]);

    const emptyEvidence = { schemaVersion: "archcontext.evidence-state-at-cursor/v1" as const, evidenceItems: [], evidenceBindings: [], tombstones: [], stateDigest: digestJson([]) };
    const evidence = {
      ...emptyEvidence,
      tombstones: [{ target: "item" as const, id: "evidence.api", previousDigest: digestJson({ old: true } as unknown as Json), reasonCode: "superseded", removedByEventId: "event.2" }]
    };
    expect(compileEvidenceStateChanges(emptyEvidence, evidence)).toEqual([
      { deltaClass: "evidence", subjectId: "evidence-tombstone:item:evidence.api", change: "added", fields: ["evidence-tombstone"] }
    ]);
  });

  test("derives stable non-colliding selector ids for repo and refactor subjects", () => {
    const repoSelector = architectureSubjectSelectorId("path", "repo.checkout", "src/web/page.ts");
    const refactorSelector = refactorSubjectSelectorId("path", "product.archctx", "src/web/page.ts");
    expect(repoSelector).toMatch(/^subject\.path\.[a-f0-9]{16}$/);
    expect(refactorSelector).toMatch(/^subject\.path\.[a-f0-9]{16}$/);
    expect(refactorSelector).not.toBe(repoSelector);
    expect(refactorSubjectSelectorId("path", "product.archctx", "src/web/page.ts")).toBe(refactorSelector);
  });
});
