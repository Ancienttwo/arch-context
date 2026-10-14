import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Json } from "../src/schema";
import { validateJsonSchema } from "../src/validator";
import {
  PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES,
  PROJECTION_TARGET_CHANGE_CLASSIFICATIONS,
  PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS,
  PROJECTION_TARGET_CHANGE_REASON_CODES,
  projectionResultInvariantIssues,
  projectionResultReceiptDigest,
  projectionResultRequestModeIssues,
  projectionTargetChangeClassification,
  projectionTargetChangesIssues,
  type ProjectionResultV2,
  type ProjectionTargetChangeV1
} from "../src/projection";

/**
 * #327 finding 2: per-target change classification on `projection run` `check` and `plan`
 * results. The contract derives `classification` from the comparison flags and reason codes by
 * one precedence rule, binds `plannedAction` to the result's `files[]`, and binds blocked targets
 * to `coverage`.
 */

const root = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(`${root}${path}`, "utf8")) as Json;
const RESULT_SCHEMA = readJson("schemas/runtime/projection-result.schema.json") as any;
const digest = (fill: string) => `sha256:${fill.repeat(64)}` as const;

const INDEX = "docs/architecture/index.md";
const CATALOG = "docs/architecture/modules/flows/catalog.md";
const RENDERER = "docs/architecture/modules/flows/renderer.md";
const MANIFEST = "docs/architecture/.projection-manifest.json";

function change(path: string, fields: Partial<ProjectionTargetChangeV1>): ProjectionTargetChangeV1 {
  const base: Omit<ProjectionTargetChangeV1, "classification"> = {
    targetId: `projection_target.${path.replace(/[^a-z]+/g, "_")}`,
    path,
    affectedCapabilityIds: [],
    stampChanged: false,
    outputChanged: false,
    semanticChanged: false,
    proofChanged: false,
    plannedAction: "none",
    reasonCodes: []
  };
  const merged = { ...base, ...fields };
  return { ...merged, classification: fields.classification ?? projectionTargetChangeClassification(merged) };
}

function signed(result: Omit<ProjectionResultV2, "receiptDigest"> & { receiptDigest?: unknown }): ProjectionResultV2 {
  const { receiptDigest: _receiptDigest, ...payload } = result;
  return { ...payload, receiptDigest: projectionResultReceiptDigest(payload) } as ProjectionResultV2;
}

const fixture = readJson("packages/contracts/fixtures/valid/projection-result.json") as unknown as ProjectionResultV2;
const files: ProjectionResultV2["files"] = [
  { path: MANIFEST, action: "update", preimageDigest: digest("1"), outputDigest: digest("2") },
  { path: CATALOG, action: "update", preimageDigest: digest("3"), outputDigest: digest("4") }
];
const changes: ProjectionTargetChangeV1[] = [
  change(INDEX, {}),
  change(CATALOG, {
    affectedCapabilityIds: ["capability.flows.catalog"],
    stampChanged: true,
    outputChanged: true,
    plannedAction: "update",
    reasonCodes: ["rendered-output-changed", "source-stamp-changed"]
  }),
  change(RENDERER, { affectedCapabilityIds: ["capability.flows.renderer"], stampChanged: true, reasonCodes: ["source-stamp-changed"] })
];
const planned = signed({ ...fixture, status: "planned", affectedNodeIds: [], files, changes });

test("a check or plan result carries schema-valid, receipt-bound per-target changes (#327)", () => {
  expect(changes.map((entry) => entry.classification)).toEqual(["unchanged", "output-change", "stamp-only"]);
  expect(projectionResultInvariantIssues(planned)).toEqual([]);
  expect(validateJsonSchema(RESULT_SCHEMA, planned as unknown as Json).issues).toEqual([]);
  const { receiptDigest: _receiptDigest, changes: _changes, ...withoutChanges } = planned;
  expect(projectionResultReceiptDigest({ ...withoutChanges, changes })).not.toBe(projectionResultReceiptDigest(withoutChanges));
  for (const mode of ["check", "plan"] as const) expect(projectionResultRequestModeIssues(planned, mode)).toEqual([]);
  for (const mode of ["apply", "adopt"] as const) {
    expect(projectionResultRequestModeIssues(planned, mode)).toContain(`changes is only allowed on a check or plan result, never when mode=${mode}`);
  }
  // A committed apply (and so a receipt) never carries changes.
  expect(projectionResultInvariantIssues(signed({ ...planned, status: "applied" })))
    .toContain("changes is only allowed on a check or plan result, never on a committed apply");
});

test("classification follows one precedence: blocked > proof (known) > baseline-missing > semantic > output > stamp-only > unchanged (#327)", () => {
  const flags = (fields: Partial<ProjectionTargetChangeV1>) => projectionTargetChangeClassification(change(CATALOG, fields));
  expect(flags({})).toBe("unchanged");
  expect(flags({ stampChanged: true, reasonCodes: ["source-stamp-changed"] })).toBe("stamp-only");
  expect(flags({ stampChanged: true, outputChanged: true, reasonCodes: ["rendered-output-changed", "source-stamp-changed"] })).toBe("output-change");
  expect(flags({ outputChanged: true, semanticChanged: true })).toBe("semantic-change");
  // A semantic delta whose rendered bytes are unchanged is still a semantic change.
  expect(flags({ semanticChanged: true, stampChanged: true })).toBe("semantic-change");
  expect(flags({ proofChanged: true, semanticChanged: true, outputChanged: true, stampChanged: true })).toBe("proof-change");
  // Proof-only: no bytes to write is still a proof change, never stamp-only or unchanged.
  expect(flags({ proofChanged: true })).toBe("proof-change");
  expect(flags({ proofChanged: true, stampChanged: true })).toBe("proof-change");
  // An unknown comparison is never folded into unchanged or stamp-only.
  expect(flags({ stampChanged: null })).toBe("baseline-missing");
  expect(flags({ semanticChanged: null, stampChanged: true })).toBe("baseline-missing");
  expect(flags({ proofChanged: null, outputChanged: true })).toBe("baseline-missing");
  // A known proof change is never hidden by an unknown comparison; baseline-missing still outranks the rest.
  expect(flags({ stampChanged: null, proofChanged: true, reasonCodes: ["flow-proof-changed", "target-row-missing"] })).toBe("proof-change");
  expect(flags({ semanticChanged: null, proofChanged: true })).toBe("proof-change");
  expect(flags({ stampChanged: null, semanticChanged: true, outputChanged: true })).toBe("baseline-missing");
  for (const code of PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES) {
    expect(flags({ reasonCodes: [code] })).toBe("blocked");
    expect(flags({ reasonCodes: [code], stampChanged: null, semanticChanged: null, proofChanged: null })).toBe("blocked");
    expect(flags({ reasonCodes: [code], proofChanged: true, outputChanged: true })).toBe("blocked");
  }
  expect([...PROJECTION_TARGET_CHANGE_CLASSIFICATIONS]).toEqual(["baseline-missing", "blocked", "output-change", "proof-change", "semantic-change", "stamp-only", "unchanged"]);
  expect([...PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS]).toEqual(["create", "delete", "none", "update"]);
  expect([...PROJECTION_TARGET_CHANGE_REASON_CODES]).toEqual([...PROJECTION_TARGET_CHANGE_REASON_CODES].sort());
  for (const code of PROJECTION_TARGET_CHANGE_BLOCKING_REASON_CODES) expect(PROJECTION_TARGET_CHANGE_REASON_CODES).toContain(code);
  const schemaChange = RESULT_SCHEMA.$defs.targetChange;
  expect(schemaChange.properties.classification.enum).toEqual([...PROJECTION_TARGET_CHANGE_CLASSIFICATIONS]);
  expect(schemaChange.properties.plannedAction.enum).toEqual([...PROJECTION_TARGET_CHANGE_PLANNED_ACTIONS]);
  expect(schemaChange.properties.reasonCodes.items.enum).toEqual([...PROJECTION_TARGET_CHANGE_REASON_CODES]);
});

test("the change invariants refuse inconsistent entries (#327)", () => {
  const issues = (entries: ProjectionTargetChangeV1[], resultFiles = files) => projectionTargetChangesIssues(entries, resultFiles);
  expect(issues(changes)).toEqual([]);
  expect(issues([...changes].reverse())).toContain("changes.path must be sorted and unique");
  // The classification is derived, never chosen.
  expect(issues([changes[0]!, { ...changes[1]!, classification: "stamp-only" }, changes[2]!]))
    .toContain("changes[1].classification must be output-change for its comparisons and reason codes");
  // Each comparison is backed by its reason code, and the reverse.
  expect(issues([changes[0]!, changes[1]!, { ...changes[2]!, reasonCodes: [] }]))
    .toContain("changes[2].stampChanged must be true exactly when source-stamp-changed is reported");
  expect(issues([{ ...changes[0]!, reasonCodes: ["semantic-fingerprint-changed"], classification: "unchanged" }, changes[1]!, changes[2]!]))
    .toContain("changes[0].semanticChanged must be true exactly when semantic-fingerprint-changed or model-digest-changed is reported");
  // A global target's model-digest change is a semantic change on its own.
  const modelMoved = change(INDEX, { semanticChanged: true, reasonCodes: ["model-digest-changed"] });
  expect(modelMoved.classification).toBe("semantic-change");
  expect(issues([modelMoved, changes[1]!, changes[2]!].sort((left, right) => left.path < right.path ? -1 : 1))).toEqual([]);
  expect(issues([{ ...changes[0]!, reasonCodes: ["model-digest-changed"], classification: "unchanged" }, changes[1]!, changes[2]!]))
    .toContain("changes[0].semanticChanged must be true exactly when semantic-fingerprint-changed or model-digest-changed is reported");
  expect(issues([{ ...changes[0]!, stampChanged: null, classification: "baseline-missing" }, changes[1]!, changes[2]!]))
    .toContain("changes[0] must report baseline-missing or target-row-missing exactly when a comparison is unknown");
  expect(issues([{ ...changes[0]!, reasonCodes: ["mystery" as never] }, changes[1]!, changes[2]!]))
    .toContain("changes[0].reasonCodes contains an unsupported code: mystery");
  // plannedAction is the result's own write decision for that path.
  expect(issues([changes[0]!, { ...changes[1]!, plannedAction: "none" }, changes[2]!]))
    .toContain(`changes[1].plannedAction must be update, the files[] action for ${CATALOG}`);
  expect(issues([changes[0]!, changes[1]!, { ...changes[2]!, plannedAction: "update", outputChanged: true, reasonCodes: ["file-bytes-changed", "source-stamp-changed"], classification: "output-change" }]))
    .toContain(`changes[2].plannedAction must be none, the files[] action for ${RENDERER}`);
  expect(issues([changes[0]!, changes[1]!, { ...changes[2]!, plannedAction: "update", classification: "stamp-only" }]))
    .toContain("changes[2] writes its file, so outputChanged must be true");
  // A blocked target is never written.
  const blocked = change(RENDERER, { reasonCodes: ["orphan-review-required", "target-removed"], outputChanged: true, plannedAction: "delete" });
  expect(blocked.classification).toBe("blocked");
  expect(issues([changes[0]!, changes[1]!, blocked], [...files, { path: RENDERER, action: "delete", preimageDigest: digest("5"), outputDigest: null }]))
    .toContain("changes[2] is blocked, so plannedAction must be none");
  // A file entry rejected for adoption or ownership repair is reported in files[] but never written.
  const rejected = change(CATALOG, { reasonCodes: ["adoption-required"] });
  expect(issues([changes[0]!, rejected, changes[2]!])).toEqual([]);
  const unexplained = change(CATALOG, { stampChanged: true, reasonCodes: ["source-stamp-changed"] });
  expect(issues([changes[0]!, unexplained, changes[2]!]))
    .toContain(`changes[1].plannedAction must be update, the files[] action for ${CATALOG}`);
  const unchangedWithReasons = { ...changes[0]!, affectedCapabilityIds: ["capability.flows.catalog"] };
  expect(issues([unchangedWithReasons, changes[1]!, changes[2]!])).toContain("changes[0] is unchanged, so affectedCapabilityIds must be empty");
});

test("a partial result binds every carried-forward target to a blocked change (#327)", () => {
  const coverage = {
    complete: false as const,
    blockedCapabilityIds: ["capability.flows.renderer"],
    blockedTargets: [{ targetId: changes[2]!.targetId, path: RENDERER, capabilityIds: ["capability.flows.renderer"], reasonCodes: ["unprovable-required-flow" as const, "verified-flow-proof-changed" as const] }],
    appliedTargetIds: [changes[0]!.targetId, changes[1]!.targetId]
  };
  const blockedRenderer = change(RENDERER, {
    affectedCapabilityIds: ["capability.flows.renderer"],
    stampChanged: true,
    outputChanged: true,
    proofChanged: true,
    reasonCodes: ["flow-proof-changed", "rendered-output-changed", "source-stamp-changed", "unprovable-required-flow", "verified-flow-proof-changed"]
  });
  expect(blockedRenderer.classification).toBe("blocked");
  const partial = signed({ ...planned, status: "planned-partial", coverage, changes: [changes[0]!, changes[1]!, blockedRenderer] });
  expect(projectionResultInvariantIssues(partial)).toEqual([]);
  expect(validateJsonSchema(RESULT_SCHEMA, partial as unknown as Json).issues).toEqual([]);
  const unbound = signed({ ...partial, changes });
  expect(projectionResultInvariantIssues(unbound))
    .toContain(`changes must classify the carried-forward target ${RENDERER} as blocked with its coverage reason codes`);
});

test("the result schema refuses a malformed change (#327)", () => {
  const withChange = (entry: Record<string, unknown>) => ({ ...planned, changes: [changes[0]!, entry, changes[2]!] }) as unknown as Json;
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, classification: "stale" })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, plannedAction: "write" })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, outputChanged: null })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, extra: true })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, reasonCodes: ["stale"] })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, path: "../escape.md" })).valid).toBe(false);
  // Shape-level couplings: blocked and stamp-only never write, unchanged reports no reason.
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, classification: "blocked", plannedAction: "update" })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, classification: "stamp-only", plannedAction: "update" })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[0]!, path: CATALOG, reasonCodes: ["source-stamp-changed"] })).valid).toBe(false);
  expect(validateJsonSchema(RESULT_SCHEMA, withChange({ ...changes[1]!, stampChanged: null, classification: "baseline-missing", reasonCodes: ["baseline-missing", "rendered-output-changed"] })).valid).toBe(true);
});
