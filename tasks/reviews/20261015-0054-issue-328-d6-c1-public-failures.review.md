# C1 bounded review

Status: confirmed hosted consumer fixes verified; coordinator incremental review and hosted acceptance pending. Review subject: the complete tracked and
untracked C1 product/test delta against accepted main
`31bbc3bbd5714a84776ec1c419c44e2d5db79603`, followed by bounded repair confirmation.

## Independent review

One semantic review cycle used three read-only reviewers, covering six grouped perspectives:
security/abuse, architecture/composition, and assumptions/cascade. Each original reviewer confirmed
its own repairs; no second broad review cycle or extra writer was started.

| Confirmed finding | Bounded repair and confirmation |
| --- | --- |
| Revoked Proxy thrown values escaped four outer type checks. | Protected inspection; unknown values become safe W1, genuine typed errors and the C2 recovery sentinel retain identity. Security reviewer confirmed hostile-value probes. |
| Native enums omitted five values already emitted by producers. | Registered `unknown-flag`, `unexpected-positional`, `timeout`, `unavailable`, and `repo-harness/v1`. Assumptions reviewer checked all five native producer files and matching policy/scope. |
| Native schema lookup accepted inherited `constructor`/`__proto__` keys. | Require an own schema key. Security reviewer confirmed both compound-key probes cannot pass validation or mutate the result prototype. |
| Two projection outer catches changed raw throw behavior into returned envelopes. | Preserve rejection shape through `publicOperationFailure`; existing inner return branches stay intact. Architecture reviewer confirmed throw and refusal cases. |
| Context7 own `retryable` was lost. | Carry only own data true/false; accessors normalize safely without execution. Architecture reviewer confirmed retryability and zero getter calls. |

No remaining P1/P2 was reported in this bounded cycle. Repairs added no entrypoint or reason;
59 canonical boundaries, 92 local schemas and 21 native reasons remain the frozen inventory.

## Final verification

Final post-repair source/test input hashes remained unchanged during all checks.

- Typecheck and five-workspace package boundary audit: passed after the final source changes.
- Complete affected suite: 458 pass, 0 fail, 6838 assertions across 30 files.
- Existing selected CLI suite: 17 pass, 0 fail, 381 assertions (95 unrelated cases filtered).
- Existing selected runtime/lifecycle/production suite: 9 pass, 0 fail, 92 assertions
  (76 unrelated cases filtered).
- Packaged native context smoke and packaged CLI smoke: passed.
- Final repair witnesses: 16 pass, 0 fail, 92 assertions across three files, before the complete run.

The contract records reproducible commands. Local logs and hash manifest are in the delegated
workspace `c1-verification/reviewed-results.json` and `reviewed-input-manifest.json`; historical red
or pre-review green runs are not substituted for these final results. Hosted CI is coordinator-owned.

## Limits and handoff

This is scoped C1 acceptance, not complete D6 acceptance. Ten named C2 recovery/return boundaries
and six lifecycle symbols remain held. Legacy C2 journal objects, raw throws and complete recovery
bindings retain their original behavior. The upstream `authority-event-missing` message-prefix
heuristic remains an explicit provenance residual. Static producer references do not establish
exhaustive branch coverage. No merge, release, issue closure, shared writer/readback/RPC/SQLite,
CI/budget, repo-harness or BYOK changes are included.

## Hosted consumer correction

After Draft delivery, hosted CI exposed one existing production-audit consumer still asserting
message.includes(key). The coordinator explicitly admitted this one script to the same C1 branch.
Its assertion now requires FailureError, AC_SCHEMA_INVALID, production-injections-refused and
issueCount=1. Graph/bundle checks and all six forbidden injections are retained. This is a bounded
consumer assertion migration; the independently reviewed product/test code and frozen 59/92/21
inventory are unchanged. Exact applied-script verification and new hosted state accompany delivery.

Applied original-script verification passed: 5 workspaces / 54 exports / 145 graph files / one
production bundle / six injection refusals. All four temporary negative witnesses failed as
required. Product/test hashes match the completed 484-test review run. Contract validation and
git diff --check passed. No new semantic review cycle was opened for this consumer assertion fix.

## Confirmed hosted consumer regressions

Parent-side static reviews of the pre-consumer product delta found no additional P1/P2, but hosted
execution identified six independent consumer groups: snapshot field, docs remedy, deps distinction,
workerId field, MCP known-error classification and Explorer observed absence. The parent confirmed
MCP as a real P2 contract regression, retained its semantic assertion and authorized these narrow
C1 corrections. The other five retain actionable safe facts/remediation rather than merely accepting
generic messages. Explorer cause remains explicitly unknown; no message heuristic is trusted.
The canonical verification now includes 35 complete files with no name filtering. Its final results
and full CI failure inventory accompany the next handoff; prior 484-test evidence is historical.

The first full 35-file run (833 pass / 2 fail) also reached a sorting/uniqueness remediation
assertion masked by the earlier projection failure. Restore the fixed remedy and retain that
assertion. Correct an overstrict newly added missing-value expectation while retaining the actual
CLI preflight refusal and explicit --from guidance. Final verification repeats all complete files.

## Final complete-file verification

835 pass / 0 fail / 10464 assertions across 35 complete files. CLI:112; deps:6; MCP:20;
RPC argument codec:153; runtime:85. No name filtering or timeout/platform changes. Typecheck,
package boundaries, original production audit and packaged smoke all passed. Source/test/audit
hashes were unchanged. The seven semantic repairs span the six original CI failed test cases;
existing failure/no-write/recovery assertions remain. Parent incremental review and new-head
hosted acceptance are separate pending gates, not inferred from local results.
