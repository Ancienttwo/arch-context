# Issue 415: Preserve safe projection failure diagnostics

Status: Review

## Authorization

The user approved the publish/status diagnostic-loss slice on 2026-10-27.
Baseline main: `4fd61c3a`. Preserve producer-owned metadata through publish,
recorded lastRun and status. Deleted-root readiness is a separate remaining
requirement of #415; this slice does not change health or shutdown semantics.

## Task Breakdown

- [x] Reproduce metadata loss with a real filesystem failure through the writer.
- [x] Preserve normalized failure details through error/run/state/status and validate persisted metadata at its read boundary.
- [x] Classify unknown exceptions by a closed built-in error family, without reading custom name/message/stack.
- [x] Cover known structured facts, persistence, schema, tampering and hostile error properties; retain existing writer assertions.
- [ ] Complete independent review and GitHub CI, then merge the exact validated head.

## Constraints

No installed-daemon administration, model/ledger edits, release or deployment.
The failure contract owns metadata safety. The writer transports its deterministic
projection and never parses diagnostic text to infer a cause. Unknown/invalid
metadata fails closed. Resource and privacy budgets remain unchanged.

## Verification

The real-filesystem metadata regression failed before the repair. Writer and
failure-contract checks passed (61 tests / 1569 assertions); final native-family,
direct-producer and read-boundary checks passed (18 tests / 290 assertions).
The existing CLI/MCP stage-only helper now accepts only stage and the closed
errorClass enum; its privacy assertions remain intact and both affected cases
passed. Independent review found an error-family probe outside its catch; a
direct changing-prototype regression proved it, then passed after the probe was
moved inside the existing catch. The second focused review passed. Typecheck,
package boundary audit and whitespace checks passed. Final verification uses
GitHub CI on the frozen candidate.
