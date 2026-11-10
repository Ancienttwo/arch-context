import { FailureError, okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { checkStateMachines, loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import { selectedProducerFailureEnvelope } from "./producer-failure";

/**
 * `archctx state-machines check`: the built-in check and the guard protection of every declared
 * state machine. Stateless: no daemon, no local store, no task session, no ChangeSet and no
 * CodeGraph. It reads the model only, never the code that a `source` names.
 */
export function runStateMachineCheckCommand(cwd: string): JsonEnvelope {
  try {
    let root: string;
    try { root = findRepositoryRoot(cwd); }
    catch { throw new FailureError("AC_REPO_NOT_FOUND", "git-worktree-required"); }
    const { nodes } = loadNativeModelFromArchContext(root);
    const machines = loadStateMachinesFromArchContext(root, nodes as unknown as Array<Record<string, Json>>);
    return okEnvelope("state-machines.check", checkStateMachines(machines, { protection: true }) as unknown as Json);
  } catch (error) {
    return selectedProducerFailureEnvelope("state-machines.check", error, "state-machines-check");
  }
}
