# D6-B scoped review

Status: accepted-main focused checks and three independent integration review lanes complete; hosted CI pending.
Preparation scope: B-only delta from frozen 550ae58b, including the new adapter and direct-reader tests.
One semantic review cycle; initial bounded compatibility repair followed by the coordinator's
explicit design amendment/refinement. No extra implementation writer or broad D6 acceptance.

| Perspective | Result and limits |
| --- | --- |
| Security | Original B-only review found no concrete finding; 12 malformed metadata cases with zero getters and six CLI refusal cases without diagnostic/path/state leakage. No new full review claimed. |
| Architecture | Original finding was stage drift against the original frozen requirement. The temporary legacy path was checked, then superseded by the coordinator's explicit permission for actual producer-stage attribution. Same reviewer confirmed the current single-boundary revision: no debt-only branch, known attributes preserved, close once, primary refusal retained; 2 tests / 123 assertions / 0 fail. |
| Adversarial / abuse / assumptions / cascade | Original B-only review found no concrete finding at confidence >=0.60; reviewed selection/help/formats, cleanup, helper exports and nonselected CLI behavior. No new full review claimed. |

Current semantic acceptance: unknown anchors failures, including nested debt and close-only
failures, carry safe W1 stage docs-anchors. Preserve registered producer code/action/reason/
severity/retryability and typed attributes, successful reports/digests/coverage and D5 discovery.
Primary producer refusals survive cleanup failure for all anchors callers. No legacy writer change.

Current affected verification: typecheck and five-workspace boundary audit pass; seven-file suite
62 pass / 0 fail / 1732 assertions; real-index flow/CLI cases 3 pass / 0 fail / 134 assertions.
Packaged native-context/CLI smoke, final contract validation and git diff --check pass.
Preparation protected-code/success-body and scope audit passed; A was clean at 550ae58b. At that point no full local governance, B hosted CI, commit,
push or PR. Accepted-main integration and remaining D6 scope are still separate delivery gates.

## Accepted-main integration review

Frozen source/test candidate: 99a980a547ebaefba42377bb4db44fbeade6ceee against main
71d8b65b6efe0be2daee26608cc37c02baeba6d5. The source/test manifest is unchanged after rebase.
The coordinator requested fresh independent integration review; three read-only lanes stayed within
the strict contract cap and all completed before push. No source/test changes followed review.

Current accepted-main verification passed: typecheck; five-workspace boundary audit; 62 affected
tests / 1732 assertions; three flow/CLI cases / 134 assertions; packaged Node/CLI smoke; contract
validation and diff whitespace checks. Real CLI JSON/help output and no-state behavior were read
back. This is focused local evidence; final hosted CI remains a separate gate.

| Accepted-main independent lane | Result and evidence |
| --- | --- |
| Security / abuse | No concrete new finding >=0.60. Direct-reader + CLI failure suites: 23 pass / 1269 assertions. Initial sandbox port restriction was setup-only; authorized rerun passed. Additional 26 metadata probes invoked zero getters/conversion hooks; six real CLI cases had no sensitive echo, stderr or state artifacts. |
| Architecture / composition | No concrete new finding >=0.60. Eight focused tests / 200 assertions, five-workspace boundary audit and diff check passed. Verified single anchors entry, original exports, preserved success/D5 behavior, known attributes, close-once and primary refusal. |
| Assumptions / cascade / adversarial | No concrete new finding >=0.60. Ten focused tests / 319 assertions and 16 CLI parameter combinations; zero runtime accesses. Two real human-output processes returned exit 1 with empty stderr. |

All lanes reviewed the accepted-main source/test candidate 99a980a547ebaefba42377bb4db44fbeade6ceee.
No lane edited files or Git; no uncovered delegated scope remains. The final follow-up commit
changes only the four allowed workflow artifacts; product/test bytes and verification-plan hash
remain unchanged. No broad D6, hosted-CI, release or issue-closure acceptance is implied.
