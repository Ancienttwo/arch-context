import { FailureError, STATE_MACHINE_CHECK_SCHEMA_VERSION, okEnvelope, type Json, type JsonEnvelope, type StateMachineCheckReportV1, type StateMachineV1 } from "@archcontext/contracts";
import { loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { checkStateMachines, loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { selectedProducerFailureEnvelope } from "./producer-failure";
import { stateMachineAnchors, type StateMachineAnchorScope } from "./state-machine-anchors";

/**
 * `archctx state-machines check`: the built-in check, the guard protection and the code anchors
 * of every declared state machine. Stateless: no daemon, no local store, no task session and no
 * ChangeSet. The rules read the model only; the anchors read the files that a `source` names and
 * open the CodeGraph index read-only when an anchor names a symbol.
 */
export function runStateMachineCheckCommand(cwd: string, inputs?: StateMachineAnchorScope & { machines: readonly StateMachineV1[] }): JsonEnvelope {
  try {
    let root: string;
    try { root = findRepositoryRoot(cwd); }
    catch { throw new FailureError("AC_REPO_NOT_FOUND", "git-worktree-required"); }
    const loaded = inputs?.machines ?? loadStateMachinesFromArchContext(root, loadNativeModelFromArchContext(root).nodes);
    // The report lists the machines by id. Keep the shared snapshot in its original file order.
    const machines = [...loaded].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const checked = checkStateMachines(machines, { protection: true });
    const anchors = stateMachineAnchors(root, machines, inputs ?? { files: new Set(listGitVisibleFiles(root)) });
    const report: StateMachineCheckReportV1 = {
      schemaVersion: STATE_MACHINE_CHECK_SCHEMA_VERSION,
      machines: checked.map((machine, index) => ({ ...machine, anchors: anchors[index]! }))
    };
    return okEnvelope("state-machines.check", report as unknown as Json);
  } catch (error) {
    return selectedProducerFailureEnvelope("state-machines.check", error, "state-machines-check");
  }
}
