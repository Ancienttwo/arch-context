# Agent job service extraction — issue #164

Baseline: external documentation service `fd61feb1`. Full verification and CI are tracked in the PR.

## P1 — ownership

`agent-jobs.ts` owns all seven Git hook/queue commands, their public input DTOs, scoped lookup and dedicated metadata/staleness helpers. It also owns the single job ID, risk/uncertainty and advisory proposal validator implementations used by both jobs and Audit. The facade re-exports the public DTOs and retains existing method signatures.

## P2 — trace

Enqueue resolves the repository session and ledger scope through existing callbacks, reads Git metadata, computes the same fingerprint/context and calls the same transactional queue store ports. Claim, retry, cancellation and completion retain repository/worktree scope. Successful completion keeps the terminal-state, stale-policy and proposal-integrity guards before store mutation. Cross-repository and unknown IDs remain indistinguishable at the API boundary.

Audit still receives `jobsComplete: (root, input) => this.jobsComplete(root, input)` plus the same pure validation/ID functions, now imported from the job module. This preserves completion timing, failure-envelope handling and terminal transitions. The shared worktree digest helper remains with ChangeSet orchestration.

## P3 — constraints

The new service has no independent writer, scheduler, queue or ledger authority. Store methods remain the persistence boundary, and daemon session/scope callbacks remain the identity boundary. At 10x queue volume, existing queue queries and limits still govern cost; no throughput change is claimed.

## Verification

Normalized parity holds for all seven methods, defaults, DTOs, private/shared helpers and ten unchanged moved tests. Queue, Audit, RPC wire and release-packaging checks pass: 146 tests, 705 assertions. Typecheck and package boundaries pass; all 34 public runtime exports are unchanged. Component, facade exclusion and relations were applied through ChangeSet with valid model readback. The script scan found no old-file source predicate for the moved job methods; existing readbacks call the preserved daemon/RPC methods.
