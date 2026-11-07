# Lessons Learned (Self-Improvement Loop)

> Capture correction-derived prevention rules here.
> Promote repeated patterns into durable project rules during spa day.

## Template
- Date:
- Triggered by correction:
- Mistake pattern:
- Prevention rule:
- Where to apply next time:

## 2026-11-06 — A test deadline close to real cost fails as an assertion, not as a timeout
- Date: 2026-11-06
- Triggered by correction: issue #489 (Windows Verify shard 2) reported `expect(retry.result).toBe("published")` receiving `"failed"` in `projection-writer.test.ts`, on a test whose measured cost was about 20 s against a 30 s budget.
- Mistake pattern: a marginal budget is read as a performance guard, but Bun reports the deadline as a timeout and lets the abandoned test body keep running. On Windows the writer test costs about 26 s (two fixtures, ~50 git spawns per publish run at ~85 ms each versus ~11 ms on macOS), so the deadline fired between the failed publish and the retry. The still-held writer lock then made the retry genuinely report `AC_PRECONDITION_FAILED`/`projection-writer-git-failed`, surfacing as an assertion failure at line 748 instead of a timeout, which sent the investigation toward a writer defect that did not exist.
- Prevention rule: treat a test timeout as a failure deadline, not a performance assertion. Budget several times the platform-measured cost (measure on the slowest platform in CI), never marginally above it. Split a test that runs several fixtures instead of raising one combined budget, and assert with the failing envelope serialized so a red build carries its own diagnosis.
- Where to apply next time: slow Git-fixture tests under `packages/local-runtime/**/test/`, any test budget within 2x of its measured Windows duration; `bun test --timeout` is a default that a per-test third argument overrides, so check for an explicit budget before blaming the runner.
## 2026-09-09 — Explicit projection write sets exclude generic generated rebuilds
- Date: 2026-09-09
- Triggered by correction: repo-harness rejected archctx 0.5.8 after docs apply created `.archcontext/generated/ARCHITECTURE.md` outside the projection result's declared files.
- Mistake pattern: ChangeSet apply appended a generic generated rebuild after a projection-only draft with explicit file bodies; preview and receipt omitted the additional create/delete operations.
- Prevention rule: when every operation is a projection with a non-empty explicit file list, apply only those files. Model/policy and mixed drafts retain generated rebuilds. Keep the provider and consumer input-digest fences unchanged; never repair undeclared writes by widening their ignore lists.
- Where to apply next time: `packages/core/changeset-engine/src/index.ts`; engine missing/drifted-state regressions and CLI first-apply fixed-point tests with the generated file absent.

## 2026-09-02 — Contract template gaps stall the completion gate at the last mile
- Date: 2026-09-02
- Triggered by correction: audit-issue-batch-108-117 archive gate failed twice after all delivered work was already merged and green on main.
- Mistake pattern: the contract declared its five test files under `exit_criteria.tests_pass`, and omitted a `## Change Assessment` block. `tests_pass` resolution walks up from the test file to the nearest `package.json` and stops there; in this repo that is a workspace grouping manifest (`packages/core`, `packages/local-runtime`, `packages/surfaces`) with no `scripts` at all, so all five criteria failed as "scripts.test is missing" even though the tests pass. The missing Change Assessment block then failed the gate a second time, and `checks/latest.json` reported only `change_assessment: fail` with a message pointing back at its own path — the real reason ("contract Change Assessment JSON block is missing") appears only after running `change-assessment prepare --contract <contract>`.
- Prevention rule: express test files as `commands_succeed: bun test <paths>` rather than `tests_pass`, and declare a `## Change Assessment` oracles block before `## Acceptance Policy`, when the contract is authored. Commit the contract before running `verify-sprint --prepare-acceptance`: evidence cannot bind to a dirty or untracked authority. When a gate component reports a bare `fail` whose message is its own artifact path, run that component's own `prepare` mode to surface the real cause instead of reading the summary file.
- Where to apply next time: `tasks/contracts/*.contract.md` at authoring time, and the contract template that seeds them.
