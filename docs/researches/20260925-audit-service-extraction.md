# Audit service extraction — issue #164

Status: targeted verification complete; full verification and hosted CI pending. Baseline: #213 head `24a66ec3c12479cd4775712ffab1a61286f54ecc`.

## P1 — ownership

Audit investigation, run reads and approved issue publishing lived inside the daemon facade. Their feature-only prompt, manifest gate, remote parsing and issue-result helpers move together into `audit.ts`. The existing orchestrator and GitHub executor remain their dependencies. Shared proposal validation, risk/uncertainty validation and job identifiers stay at their current boundary and are supplied as callbacks.

## P2 — trace

`auditRun` checks the manifest and user consent, builds the ledger context, enqueues and claims its exact job, then drives investigation either inline or in the background. The service receives the daemon's original abort-controller map: stop and idle detection observe the same entries. Job completion and ledger append retain their existing daemon callbacks. `auditApprove` retains the writer gate, proposal digest validation, repository visibility/public confirmation, preflight, issuing intent, per-draft append and explicit resume behavior. The investigation path never invokes issue publishing.

The egress status reader also uses the manifest gate, so the facade delegates that read to the same service. No duplicated parser or new permission authority is introduced.

## P3 — move boundary

The facade composes `AuditService` from existing stores, clock, transports, lifecycle map and callbacks, then delegates its four public audit methods. Runtime exports and RPC contracts are unchanged. No write path, state transition, timeout or retry policy changes. At 10x concurrent audits, existing queue limits, subprocess cost and the single writer gate remain the constraints; this extraction makes no throughput claim.

## Verification

Normalized source comparison passes for all four public method bodies, private audit methods, feature-only helpers, constants and public input types. The 29 moved test definitions expand to 40 tests: all pass with 293 assertions. They cover asynchronous completion, stop cancellation, exact job claims, user consent, private/public publishing, tampering, writer serialization, partial failure, explicit resume and deduplication. Existing fixtures move unchanged with those tests. The RPC idle-lifecycle test stays at its original transport boundary.

All 34 public runtime exports are unchanged. Typecheck and the package-boundary audit pass. The component, facade exclusion and relations were applied through daemon ChangeSet; model validation reports no errors. Full verification and hosted matrix evidence will be recorded in the PR once complete.
