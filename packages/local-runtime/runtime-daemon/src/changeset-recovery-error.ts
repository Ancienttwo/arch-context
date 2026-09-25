import { type UnresolvedChangeSetJournal } from "@archcontext/local-runtime/local-store-sqlite";

/** Thrown by `withWriter` while startup recovery left ChangeSet journals unresolved (#172). */
export class ChangeSetRecoveryUnresolvedError extends Error {
  constructor(readonly unresolvedJournals: UnresolvedChangeSetJournal[]) {
    super(`changeset-recovery-unresolved: ${unresolvedChangeSetJournalSummary(unresolvedJournals)}; fix the cause and restart archctxd to retry recovery`);
    this.name = "ChangeSetRecoveryUnresolvedError";
  }
}

function unresolvedChangeSetJournalSummary(journals: UnresolvedChangeSetJournal[]): string {
  return `${journals.length} ChangeSet journal(s) left pending by startup recovery (${journals
    .map((journal) => `${journal.journalId} [${journal.changeSetId}] at ${journal.root}: ${journal.reason}`)
    .join("; ")})`;
}
