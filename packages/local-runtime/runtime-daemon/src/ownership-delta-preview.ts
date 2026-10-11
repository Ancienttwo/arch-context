import { CHANGESET_OWNERSHIP_DELTA_SCHEMA_VERSION, type ChangeSetOwnershipDeltaV1 } from "@archcontext/contracts";
import type { ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { ownershipDelta } from "@archcontext/core/module-statistics";
import { loadNativeModelFromModelFiles } from "@archcontext/core/projection-engine";
import { readTrackedTreeEntries } from "@archcontext/local-runtime/git-adapter";
import { listModelFiles } from "@archcontext/local-runtime/model-store-yaml";

const NODE_DIRECTORY = ".archcontext/model/nodes/";
const NODE_FILE_OPERATIONS = new Set(["create_entity", "update_entity_fields", "delete_entity"]);

/**
 * The ownership effect of a planned ChangeSet, for its preview. `undefined` when no operation
 * writes a node file, so a plan that cannot move ownership keeps its preview unchanged.
 *
 * Read-only. The current node files and the planned bodies are parsed in memory, and ownership is
 * resolved over the files the `HEAD` tree carries, like `refactor scan`. A planned body that does
 * not parse, or a tree that cannot be read, gives `status: unavailable` with the reason; it never
 * fails the plan, because the preview findings and apply validation own those errors.
 */
export function planOwnershipDelta(root: string, draft: ChangeSetDraft): ChangeSetOwnershipDeltaV1 | undefined {
  const nodeOperations = draft.operations.filter((operation) =>
    NODE_FILE_OPERATIONS.has(operation.op) && operation.path !== undefined && isNodeFile(operation.path));
  if (nodeOperations.length === 0) return undefined;
  try {
    const current = new Map(listModelFiles(root)
      .filter((file) => isNodeFile(file.path))
      .map((file) => [file.path, file.body] as const));
    const planned = new Map(current);
    for (const operation of nodeOperations) {
      if (operation.op === "delete_entity") planned.delete(operation.path!);
      else planned.set(operation.path!, operation.body ?? "");
    }
    const paths = readTrackedTreeEntries(root).filter((entry) => entry.type === "blob").map((entry) => entry.path);
    return ownershipDelta(loadNativeModelFromModelFiles(current).nodes, loadNativeModelFromModelFiles(planned).nodes, paths);
  } catch (error) {
    return {
      schemaVersion: CHANGESET_OWNERSHIP_DELTA_SCHEMA_VERSION,
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/** A direct YAML child of the node directory: the only files the model loader reads as nodes. */
function isNodeFile(path: string): boolean {
  if (!path.startsWith(NODE_DIRECTORY)) return false;
  const name = path.slice(NODE_DIRECTORY.length);
  return !name.includes("/") && /\.ya?ml$/.test(name);
}
