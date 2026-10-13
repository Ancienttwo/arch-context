# Issue #328: architecture debt

Status: D1/D2 in Draft PR #337; S2 read-only evidence implemented; S3 integration gates remain
Base: `ade6255d13cec021226b3b116cd7624e83fe524b`
Reconciled base (2026-10-14): `f5b31d8794d89bde2ea90c8991e226e907028614`, including S2 and S5.
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
- [ ] After #327 S3 merges, rebase and append `architecture-debt-v1` to the feature list,
      capabilities fixture and schema as the final advertisement commit.
- [ ] D3: after #327 S3 lands, integrate complete findings/actionsRequired on its actual base.

## Coordination and remaining gates

S2 and S5 have merged; Claude handed off codegraph-adapter for the bounded read-only change.
Claude still owns #327 S3/S6/S7. Do not edit projection-service.ts, contracts/src/projection.ts,
projection renderer/manifest, generated docs or duplicate CodeGraph status authority. CLI additions stay
localized. D3 waits for S3 integration; renderer/protocol floors wait for S6. This plan does not
authorize release, merge, downstream writes or closing the umbrella RFC before all its gates pass.

S3 hands over the capability feature trio after merge; S5 rebases on the debt advertisement
if it lands later. `docs/spec.md` belongs to this slice. Draft PR text must say
"blocked on #327 S3 merge for feature advertisement" and use `Refs #328`, without closing it.
The 3,016 ms cold edit-time sample remains an unresolved strict three-second budget result;
passing functional checks does not convert it to a performance pass.
