# Review: Governance CI deduplication

## Result

One independent read-only CI review, then one bounded alias-compatibility follow-up: LGTM, noP1/P2. The reviewer checked the final5implementation/test files against their frozen hashes and independently ran the original2whole CI files23/0,513assertions. The final Bun alias delta preserves the existing FG6 reader; separate bounded probes confirm --ci-inspect and unknown flags reach the same refusal paths without spawning verification/inspection. No new review fleet or shared writer was introduced.

## Acceptance evidence and limits

Root final4whole files35/0,568assertions; typecheck,2Node syntax checks and diff-check pass. Original full+23 command array is byte-identical; prior red12/3 and YAML intermediate19/4 are retained in operations evidence. Strict provider run/attempt/sourceHEAD and actual-checkout binding, unique successful full worker/Verify step, failed/missing/stale/duplicate/pagination cases, local full-first failure propagation, exact23order/ledger skip, manual2job path and29/43/31topology are covered. Permissions and budgets remain unchanged.

This accepts local implementation for an independent Draft PR. Hosted execution on that PR is still required. It does not approve PR360's merge, erase W1/Windows cleanup failures, or authorize CI cancellation/manual rerun, Windows sharding expansion, release work or main integration.

## Accepted main integration composition review

One bounded read-only composition review: LGTM, noP1/P2. Ordinary merge e7928b24 has the expected b387 and accepted-main e18e0428 parents; the5CI implementation/test files are byte-identical to their independently reviewed b387 source. Linux22full single prerequisite, manual2job path,23inspection/localfull+23 arrays, strict provider run/attempt/sourceHEAD/actual-checkout refusals,9target collector, permissions and budgets are unchanged. No363source was integrated. The generated diff is only one tooling source stamp produced by supported docsapply; both AL9 JSON packets remain accepted-main bytes and verified. Reviewer inspected actual35/0,568assertions, types,2syntax, exact1.6.2selector evidence and allowlist. Root alone wrote files; no reviewer test rerun. New exact-head hosted CI and coordinator readback remain required before361merge.
