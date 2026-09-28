import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import type { ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CHANGESET_MODEL_TRANSITION_SCHEMA_VERSION, type ChangeSetModelTransitionV1, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";

/** Exactly the files `loadNativeModelFromArchContext` reads: direct YAML children of these directories. */
const SEMANTIC_MODEL_DIRECTORIES = ["nodes", "relations", "flows"] as const;
const SEMANTIC_MODEL_PATH = /^\.archcontext\/model\/(nodes|relations|flows)\/[^/]+\.ya?ml$/;

export function isSemanticModelPath(path: string): boolean {
  return SEMANTIC_MODEL_PATH.test(path);
}

export interface ModelTransitionBase {
  before: string;
  files: Map<string, string>;
  expectedWrites: Map<string, string>;
}

/**
 * Captured under the writer lock before a ChangeSet touches any file. Returns undefined when the
 * draft writes no semantic model file or the current model cannot be loaded; either way the
 * journal simply carries no transition and can never be accepted later.
 */
export function captureModelTransitionBase(root: string, draft: ChangeSetDraft): ModelTransitionBase | undefined {
  const expectedWrites = new Map<string, string>();
  for (const operation of draft.operations) {
    const writes = [
      ...(operation.path ? [{ path: operation.path, body: operation.body }] : []),
      ...(operation.projectionFiles ?? [])
    ];
    for (const write of writes) {
      if (!isSemanticModelPath(write.path)) continue;
      expectedWrites.set(write.path, operation.op === "delete_entity" ? "missing" : digestJson({ body: write.body ?? "" } as unknown as Json));
    }
  }
  if (expectedWrites.size === 0) return undefined;
  try {
    return { files: semanticModelFileHashes(root), before: digestJson(loadNativeModelFromArchContext(root) as unknown as Json), expectedWrites };
  } catch {
    return undefined;
  }
}

/**
 * Runs inside the pre-commit hook. The transition is recorded only when every semantic file the
 * draft did not write is byte-identical to the captured base and every file it wrote holds exactly
 * the operation body (or is absent for a delete). Evidence failure never alters the apply outcome.
 */
export async function recordModelTransitionEvidence(
  store: Pick<RuntimeLocalStore, "recordChangeSetModelTransition">,
  root: string,
  journalId: string,
  base: ModelTransitionBase
): Promise<boolean> {
  try {
    const files = semanticModelFileHashes(root);
    for (const path of new Set([...base.files.keys(), ...files.keys(), ...base.expectedWrites.keys()])) {
      const expected = base.expectedWrites.get(path) ?? base.files.get(path) ?? "missing";
      if ((files.get(path) ?? "missing") !== expected) return false;
    }
    const transition: ChangeSetModelTransitionV1 = {
      schemaVersion: CHANGESET_MODEL_TRANSITION_SCHEMA_VERSION,
      before: base.before,
      after: digestJson(loadNativeModelFromArchContext(root) as unknown as Json)
    };
    await store.recordChangeSetModelTransition(journalId, transition);
    return true;
  } catch {
    return false;
  }
}

function semanticModelFileHashes(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const directory of SEMANTIC_MODEL_DIRECTORIES) {
    const absolute = resolve(root, ".archcontext/model", directory);
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.filter((name) => /\.ya?ml$/.test(name)).sort()) {
      hashes.set(`.archcontext/model/${directory}/${entry}`, digestJson({ body: readFileSync(resolve(absolute, entry), "utf8") } as unknown as Json));
    }
  }
  return hashes;
}
