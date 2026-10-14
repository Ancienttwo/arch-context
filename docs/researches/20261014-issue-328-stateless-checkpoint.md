# #328 D4: stateless debt checkpoint and explicit practice writer

Base: `adecdd9c6e3f3b95d83a9d065d0aea52225328df` (#337).
Writer: w8:p4 Codex, `codex/issue-328-remaining`, independent worktree.
Plan review and conditional GO: [Dot, 1791955626.966329](https://aiphabee.slack.com/archives/C0C6C6FHHHT/p1791955626966329?thread_ts=1791870900.589399).
Contract freeze accepted: [Dot, 1791955774.559329](https://aiphabee.slack.com/archives/C0C6C6FHHHT/p1791955774559329?thread_ts=1791870900.589399).

## P1: authority map

Contracts owns architecture-debt/v1 and the new hook-debt-checkpoint/v1 schema/types.
The runtime's existing architecture-debt reader composes Git/model, parent-chain ownership,
human anchor evidence and the pure core evaluator. CLI/MCP adapt this reader without a
runtime handle. They do not create a session or access a practice baseline.
The practice service retains the sole baseline producer/store; prepare still seeds it,
and the explicit practice checkpoint writer advances it.
The Git architecture authority, complete judgment, CodeGraph producer, S4 classification and
U4 scanner are unchanged. No live model, generated projection, database or historical
verification artifact is authored by this work-package.

## P2: concrete paths

- CLI checkpoint -> changed-path validation -> runArchitectureDebtCommand -> Git/model,
  ownership and docs anchors -> existing report directly in data.
- MCP archcontext_checkpoint -> its strict input schema -> the same reader. Direct callTool
  validates this contract too; advertising an input schema alone did not reject old fields.
- hook checkpoint -> input validation -> the same reader -> hook report plus redacted log.
  A producer failure carries the original typed error, unknown coverage and failOpen; it
  contains no clean debt report. Invalid flags, positional arguments, event and paths reject.
- practices checkpoint / archcontext_practice_checkpoint -> RPC practiceCheckpoint ->
  PracticeCheckpointService -> previous baseline -> practice computation -> next baseline.
  The old daemon RPC checkpoint method and RuntimeCheckpointInput export are removed.

## P3: decision

Cut the public debt checkpoint to the existing stateless authority instead of maintaining
two semantic interpretations of checkpoint input/output. Older task/session/event/tool/
digest/budget fields reject on the debt reader; CLI --path and --changed reject there too.
Practice consumers invoke the separate writer explicitly, retaining the existing snapshot,
stale, coalescing and failure contracts. Repeated prepare converges on the same snapshot
for the same task/cursor; the operational update timestamp may change.

Edit-time debt remains ownership/anchors only, with dependencies, flows and practices
explicitly deferred. No missing evidence is synthesized. At 10x repository size, Git
enumeration, all-capability footprints and citation reads remain the first costs; D4 makes
no performance guarantee and does not change the shared scanner.

## Consumer cutover

| Consumer | Current authority |
| --- | --- |
| CLI checkpoint; MCP archcontext_checkpoint | In-process architecture-debt/v1, changedPaths only |
| CLI practices checkpoint; MCP archcontext_practice_checkpoint | Explicit daemon practice writer, practice-checkpoint/v1 |
| hook checkpoint / current hook metadata | Read operation with its own inputs and hook-debt-checkpoint/v1 |
| hook enqueue | Explicit queue writer |
| no-cloud E2E | Debt read plus explicit practice writer, then strict complete/review |
| FG6 benchmark; AL10 representative and GA | Explicit practice writer for their existing baseline/freshness metrics |
| AL10 MCP hardening | Explicit practice MCP writer |
| S6 runtime and Context7 hard-gate scan | practiceCheckpoint; current S6 hook readback uses readEntrypoint |
| Develop skill; practice/rollback/ledger runbooks; MCP demo | Debt report versus practice delta made explicit |

Historical evidence JSON and its pinned readback contracts are unchanged. No repo-harness
consumer source is edited. That external consumer must move its baseline calls to the writer
and its edit-time debt calls to the strict reader contract; #690 remains the handoff boundary.

## Verification and limits

Recorded local coverage is 604 distinct cases across full runs plus affected-file/subset
corrections. This is not one entirely green full-repository run.

- Contracts, MCP, debt CLI, transcript, Context7 and S6 docs: 305 cases. Initial failures were
  migrated tool counts, current hook metadata and the direct MCP input guard; their affected
  files passed after correction. The new invalid hook fixture and version mapping passed.
- CLI and RPC codec: 265 cases in the full run (260 pass initially). The one dedicated-help
  expectation and four renamed RPC input fixtures were corrected; focused help/flag checks
  (5 cases) and practice RPC checks (6 cases) passed. The full 312-second batch was not repeated.
- Prepare -> debt read -> practice writer, coalescing and restart: 3 passed.
- Installed product lifecycle / practice edit-revert / hook read: 5 passed.
- FG6/AL10 readback validators and core control-loop invariants: 26 passed.
- Typecheck, package-boundary audit, whitespace and packaged CLI smoke passed.
- Real macOS Seatbelt network-isolated no-cloud E2E passed: debt's exact deferred coverage,
  explicit practice writer, strict complete/review pass, zero errors/warnings and empty debt.
  Subsequent commands metadata includes the explicit writer; the final pinned run is recorded
  separately when the candidate is submitted.

No entire verify pipeline, hosted CI acceptance, release, merge, provider write or consumer
adoption is implied. D5 only permits cost inventory, D6 error-exit inventory, D7 floor design;
their implementations need the next reviewed boundary. The strict 3,000 ms budget is unresolved.

## Task Breakdown

- [x] Freeze CLI/MCP/read hook and explicit writer contracts with Dot.
- [x] Remove the old checkpoint RPC/type and migrate current repo-local consumers.
- [x] Prove baseline separation, unchanged read state and preserved writer invariants.
- [ ] Submit PR, full HEAD and bound CI to Dot; await exact-HEAD acceptance.
- [ ] D5 cost inventory / D6 error exits / D7 minimum-floor design, then obtain the next scope.

