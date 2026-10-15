import { FailureError, changeSetRecoveryDetails } from "@archcontext/contracts";
import { type UnresolvedChangeSetJournal } from "@archcontext/local-runtime/local-store-sqlite";
/** Thrown by withWriter while startup recovery or an in-process rollback left journals unresolved. Original authority stays intact. */
export class ChangeSetRecoveryUnresolvedError extends FailureError<"AC_PRECONDITION_FAILED"> {
  constructor(readonly unresolvedJournals: UnresolvedChangeSetJournal[]) {
    super("AC_PRECONDITION_FAILED", "changeset-recovery-unresolved", changeSetRecoveryDetails(unresolvedJournals));
    this.name = "ChangeSetRecoveryUnresolvedError";
  }
}
