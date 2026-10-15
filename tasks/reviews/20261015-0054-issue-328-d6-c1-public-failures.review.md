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

## Prior 35-file consumer verification

835 pass / 0 fail / 10464 assertions across 35 complete files. CLI:112; deps:6; MCP:20;
RPC argument codec:153; runtime:85. No name filtering or timeout/platform changes. Typecheck,
package boundaries, original production audit and packaged smoke all passed. Source/test/audit
hashes were unchanged. The seven semantic repairs span the six original CI failed test cases;
existing failure/no-write/recovery assertions remain. Parent incremental review and new-head
hosted acceptance are separate pending gates, not inferred from local results.

## Current declaration-scoped DE1/DE3 audit correction

The coordinator independently identified a stale source witness, not a new production behavior
regression, and specified the minimum correction. The two audit files now require the fixed
throw message and all observed/unavailable/unclassified facts within buildExplorerProjectionV2.
Each missing witness and a fact moved outside that declaration is rejected. Existing bounded
read, no-empty-observed and graph authority checks remain. No product source or heuristic changes.
The complete wiring file passes 40 / fails 0 / 86 assertions; type, boundaries and production audit
also pass. This is a narrow consumer correction within the existing review cycle; no additional
independent semantic sign-off is invented.

The requested single complete root bun test was executed with its normal 60000ms budget and
without filters or added skips. It completed in 700.57s: 266 files, 2861 pass, 75 fail, 3 existing
skips, 22339 assertions. Current default execution denies loopback bind (EPERM), browser startup
and npm cache writes. Full failure evidence remains available, including startup/assertion
failures without a direct captured cause; no full green or blanket regression clearance is
claimed. Packaged native smoke passes, while packaged CLI daemon startup is similarly blocked.
Input hashes remain unchanged. Full hosted acceptance remains required.

Current hosted collection also found a separate Windows codegraph-init exit5 after stdout Done
and empty stderr in the #261 fixture. It is not addressed by weakening tests or changing C1.
Wait for the remaining current full job and terminal inventory before delivery; no C1/B mixing,
PR merge, issue closure, retry/cancel or #358 resolution is claimed.

### Approved execution contrast

Normal Git staging approval succeeded after the default index.lock denial. The nine original
unknown failures reproduce in independent default-permission selected runs and all pass with
approved loopback execution using identical commands (96 assertions), while the direct socket
probe changes from EPERM to OK. All package source/test/audit hashes are unchanged. The single
browser failure also passes under approved headless execution (2 assertions), and approved
packaged native/CLI smoke passes. Preserve the original non-green full-root evidence and npm
cache EPERM; do not certify the unrerun full suite as green. Windows CodeGraph init exit5 remains
a separately evidenced hosted fixture failure, not an assumed UV_HANDLE_CLOSING recurrence.
No product revision or new semantic review cycle accompanies this diagnostic contrast.

## Accepted main 670b7474 integration verification

Only one source conflict occurred, in FAILURE_STAGES. Its resolution retains both reviewed
sets: C1 public-operation/native-export and B docs-anchors/flows-check, under the same authority.
Every other byte of the C1 failure policy/schema module is unchanged. Both scoped adapters are
byte-identical to their reviewed owners. All 9 B-only files and 48 C1-only non-workflow files are
byte-identical; the three other shared files retain the exact B added/deleted patch lines.
B's reviewed ca35871d tree equals accepted main 670b7474, so no accepted B behavior was replaced.

Current joint verification passed with no name filters or added skips at the existing 60000ms
budget: 15 complete boundary/consumer files, 383 pass/0 fail/4750 assertions (72.48s); complete
CLI plus identity/RPC version files, 119 pass/0 fail/2191 assertions (208.49s). Total 502 pass/
0 fail/6941 assertions across 18 full files. Typecheck/five-workspace boundary audit (0.76s),
production reachability audit (0.26s), packaged native-context/CLI smoke (15.25s) all pass.
All recorded package/script/test/CI input hashes remain unchanged. No full-root suite was
repeated. Earlier non-green full-root and separate CodeGraph exit5 evidence remain historical.

Evidence lives in the delegated workspace c1-main670-integration/: baseline-manifest.json,
merge-preservation-proof.json, verification-final.json and command logs. Contract plan hash:
sha256:c7e9787e0f869ef45f6c4e3ca2b615962cb1a32b6ea892e3cd6d579fa01cf884.
The merge commit is local only while b824 Verify 38694500518 runs. Terminal provider readback
precedes the single final integration push. D6/C2+D7 now has separate user authorization for
an independent tree; no such implementation is included in this C1 integration.
