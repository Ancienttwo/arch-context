# Lessons Learned (Self-Improvement Loop)

> Capture correction-derived prevention rules here.
> Promote repeated patterns into durable project rules during spa day.

## Template
- Date:
- Triggered by correction:
- Mistake pattern:
- Prevention rule:
- Where to apply next time:

## 2026-09-02 — Contract template gaps stall the completion gate at the last mile
- Date: 2026-09-02
- Triggered by correction: audit-issue-batch-108-117 archive gate failed twice after all delivered work was already merged and green on main.
- Mistake pattern: the contract declared its five test files under `exit_criteria.tests_pass`, and omitted a `## Change Assessment` block. `tests_pass` resolution walks up from the test file to the nearest `package.json` and stops there; in this repo that is a workspace grouping manifest (`packages/core`, `packages/local-runtime`, `packages/surfaces`) with no `scripts` at all, so all five criteria failed as "scripts.test is missing" even though the tests pass. The missing Change Assessment block then failed the gate a second time, and `checks/latest.json` reported only `change_assessment: fail` with a message pointing back at its own path — the real reason ("contract Change Assessment JSON block is missing") appears only after running `change-assessment prepare --contract <contract>`.
- Prevention rule: express test files as `commands_succeed: bun test <paths>` rather than `tests_pass`, and declare a `## Change Assessment` oracles block before `## Acceptance Policy`, when the contract is authored. Commit the contract before running `verify-sprint --prepare-acceptance`: evidence cannot bind to a dirty or untracked authority. When a gate component reports a bare `fail` whose message is its own artifact path, run that component's own `prepare` mode to surface the real cause instead of reading the summary file.
- Where to apply next time: `tasks/contracts/*.contract.md` at authoring time, and the contract template that seeds them.
