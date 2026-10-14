# Issue #328: architecture debt

Status: D1/D2/S2/D3 implemented and locally verified; Draft PR #337 awaits hosted CI and Dot acceptance
Base: `ade6255d13cec021226b3b116cd7624e83fe524b`
Reconciled base (2026-10-14): `afeb0c38fa41e50bd90950d4c64f1d77f0914af0`, including S2/S3/S5/S6/S7; merged without rewriting #337 history.
Owner: Codex, `/tmp/worktrees/arch-context-328`
Planning: Claude in Herdr `w8:p1`, proposal `/tmp/worktrees/328-claude-proposal.md`.

## Scope and invariants

Implement the debt reader and attach its measured result to the existing practice checkpoint.
The reader is in process, does not sync CodeGraph, and never writes runtime or model state.
Missing or stale evidence is a coverage gap, not an empty successful debt check. Source byte
stamps are not debt. Use the existing ownership, citation, dependency and flow producers;
consumers must not derive those facts again. Keep projection dependency debt byte-compatible
as a deterministic projection of the shared measurement.

P1: contracts owns public payloads; core owns deterministic classification; runtime adapters
read Git/model/CodeGraph; CLI is a trigger. Projection/ChangeSet remains the write authority.
`resolve`, `docs anchors`, `flows check`, `deps` already avoid the runtime client. Checkpoint
currently writes a practice baseline and complete reads that baseline.

P2: CLI checkpoint -> RuntimeDaemon.checkpoint -> PracticeCheckpointService.checkpoint ->
checkpointTask -> compileTaskContext -> savePracticeCheckpointBaseline (SQLite). The new
debt reader must not cross that write boundary. Projection dependency debt currently consumes
the run's existing import population -> measureCapabilityDependencies -> undeclared cells.

P3: preserve the baseline and writer boundary while making an independent read contract
available. At 10x size, CodeGraph queries and repository-wide citation/file enumeration dominate;
measure before claiming the RFC's three-second edit-time budget. No semantic fallback or local
import parser. A change to checkpoint's published stateful semantics is a separate explicit
cutover decision, not a hidden CLI state writer.

## Task Breakdown

- [x] D0: measure existing read producers on arch-context and repo-harness, without index sync.
- [x] D1: public debt schema, deterministic evaluator, in-process `debt` reader and CLI.
- [x] D1: dependency projection parity, scoped findings, coverage and no-write tests.
- [x] D2: checkpoint consumes the same debt reader without changing baseline ownership.
- [x] Verify types, affected tests, package boundary and packaged CLI.
- [x] Record exact evidence and RFC gaps; commit the bounded implementation.
- [x] After S2 merge, add read-only selector/import evidence for the future completion consumer;
      reuse S2 readiness and enforce no-download on every shim invocation in this path.
- [x] After #327 S3 merges, merge main and append `architecture-debt-v1` to the feature list,
      capabilities fixture and schema as the final advertisement commit.
- [x] D3: integrate complete findings/actionsRequired beside the unchanged S3 freshness gate.

## Coordination and remaining gates

S2/S3/S5/S6/S7 have merged. Claude handed off completeTask and the feature trio; this PR's
last commit adds only the alphabetically ordered flag, fixture and schema entry. S4 will take
contracts/src/projection.ts afterward. Projection service, renderer/manifest, generated docs
and the single S3 freshness evaluator are unchanged by D3. Use plain push, keep Draft, no merge.

P2 completion trace: RuntimeDaemon.completeTask -> existing model validation / daemon practice
baseline and evaluation -> projection drift / shared freshness -> readCompleteTaskArchitectureDebt
-> shared ownership/anchor evidence + S2 read-only code facts + existing practice evaluation
-> pure evaluator -> completeTaskGate findings/actions -> saved review and data.debt.

P3 decision (Claude w8:p1, 2026-10-14): measured debt blocks with the item's action; practice
regressions reuse the existing practice finding. Actual coverage gaps produce one warning,
not a new blocking optional-CodeGraph policy. Intentional not-enabled/model-not-adopted states
remain explicit coverage without warning. Existing model validation still blocks missing or
invalid adoption; stale task HEAD suppresses downstream debt judgment. At 10x size, the full
completion read still pays repository enumeration and CodeGraph query cost; edit time remains
ownership/anchors per D0. No shadow status reader or semantic fallback is introduced.

The 3,016 ms cold edit-time sample remains an unresolved strict three-second budget result;
passing functional checks does not convert it to a performance pass. Renderer/protocol floors
and broader typed action normalization remain outside this bounded D3 work. This plan does not
authorize release, merge, downstream writes or closing the umbrella RFC.
