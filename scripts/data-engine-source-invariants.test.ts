import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectDataEngineIndexedBacklinks, inspectDataEngineRequiredDomains, inspectDataEngineAuthorityBinding } from "./data-engine-source-invariants";

const root = resolve(import.meta.dir, "..");
const daemon = readFileSync(resolve(root, "packages/local-runtime/runtime-daemon/src/index.ts"), "utf8");
const compiler = readFileSync(resolve(root, "packages/local-runtime/runtime-daemon/src/explorer-projection.ts"), "utf8");
const store = readFileSync(resolve(root, "packages/local-runtime/local-store-sqlite/src/index.ts"), "utf8");
function remove(source: string, witness: string): string {
  expect(source).toContain(witness);
  return source.replaceAll(witness, "REMOVED_READBACK_WITNESS");
}

describe("DE1/DE3 current source wiring", () => {
  test("accepts the current bounded read and explicit authority contracts", () => {
    expect(inspectDataEngineIndexedBacklinks(daemon, store)).toBe(true);
    expect(inspectDataEngineRequiredDomains(compiler, daemon)).toBe(true);
    expect(inspectDataEngineAuthorityBinding(compiler, daemon)).toBe(true);
  });

  for (const witness of [
    "this.localStore.readExplorerProjectionInputs({ ...scope, query, plan: readPlan, authorityCursor })",
    "this.localStore.readExplorerProjectionMetadata({",
    "eventBacklinks = planned.eventBacklinks;",
    "eventBacklinks = ledgerMetadata.eventBacklinks;"
  ]) test(`DE1 rejects disconnected daemon backlink wiring: ${witness}`, () => {
    expect(inspectDataEngineIndexedBacklinks(remove(daemon, witness), store)).toBe(false);
  });

  for (const witness of [
    "readExplorerProjectionInputsFromDb(db, input)", "readExplorerProjectionMetadataFromDb(db, input)",
    "readExplorerProjectionBacklinksFromDb(db, input, selectedSubjectIds)",
    "readExplorerProjectionBacklinksFromDb(db, input, subjectIds)",
    "FROM architecture_event_subjects JOIN architecture_change_feed",
    "architecture_event_subjects.storage_repository_id = ?", "architecture_event_subjects.storage_workspace_id = ?",
    "architecture_event_subjects.subject_id IN (${placeholders})", "LIMIT ?",
    ".all(...params, input.plan.limits.maxBacklinks)", "record.eventHash !== event.eventHash"
  ]) test(`DE1 rejects missing bounded indexed authority witness: ${witness}`, () => {
    expect(inspectDataEngineIndexedBacklinks(daemon, remove(store, witness))).toBe(false);
  });

  for (const witness of [
    "assertProjectionReadContract(input, actualGraphDigest)",
    "const actualGraphDigest = architectureLedgerStateDigest(input.graph)",
    "input.readSet.selectedGraphDigest !== selectedGraphDigest",
    "digestJson(readSetWithoutDigest as unknown as Json) !== readSetDigest",
    "digestJson(input.readPlan as unknown as Json) !== digestJson(canonicalPlan as unknown as Json)",
    'requirement === "required"', 'projectionInputDomain("bindings", requirements.bindings, bindingsDigest)',
    'input.observedAvailability?.status === "unavailable"'
  ]) test(`DE3 rejects missing required-domain guard: ${witness}`, () => {
    expect(inspectDataEngineRequiredDomains(remove(compiler, witness), daemon)).toBe(false);
  });

  for (const witness of [
    "assertAuthorityBinding(input)", "input.authorityCursor !== null",
    "cursor === null || input.evidenceAuthorityCursor === null",
    "cursor.graphDigest !== input.graphDigest", "cursor.evidenceStateDigest !== input.evidenceStateDigest",
    "evidenceCursor.evidenceStateDigest !== input.evidenceStateDigest",
    "digestJson(cursor.repository as unknown as Json) !== digestJson(input.repository as unknown as Json)",
    "digestJson(cursor.worktree as unknown as Json) !== digestJson(input.worktree as unknown as Json)",
    "digestJson(cursor as unknown as Json) !== digestJson(input.evidenceAuthorityCursor as unknown as Json)"
  ]) test(`DE3 rejects missing authority guard: ${witness}`, () => {
    expect(inspectDataEngineAuthorityBinding(remove(compiler, witness), daemon)).toBe(false);
  });

  test("DE3 rejects a missing daemon observed failure or inferred graph authority", () => {
    expect(inspectDataEngineRequiredDomains(compiler, remove(daemon, "required-input-unavailable:observed:${reasonCode}"))).toBe(false);
    expect(inspectDataEngineAuthorityBinding(compiler, remove(daemon, "ledgerMatchesGit && ledgerMatchesGitScope"))).toBe(false);
    expect(inspectDataEngineAuthorityBinding(compiler, remove(daemon, "compileProjectionInputManifest(projectionInput)"))).toBe(false);
  });

  test("unrelated functions cannot supply missing guard witnesses", () => {
    const witness = "input.readSet.selectedGraphDigest !== selectedGraphDigest";
    const moved = `${remove(compiler, witness)}\nfunction unrelated() { return ${witness}; }\n`;
    expect(inspectDataEngineRequiredDomains(moved, daemon)).toBe(false);
  });

  test("missing or ambiguous declaration fails closed", () => {
    expect(inspectDataEngineRequiredDomains("", daemon)).toBe(false);
    expect(inspectDataEngineAuthorityBinding(`${compiler}\nfunction assertAuthorityBinding() {}\n`, daemon)).toBe(false);
    expect(inspectDataEngineIndexedBacklinks("", store)).toBe(false);
  });
});
