# Plan: #328 D5 per-call debt and anchor read inputs

> **Status**: Executing
> **Owner**: D5 sole writer, current delegated Codex thread
> **Baseline**: a697adad7bf686f309405d7a9feef8173d8140a5
> **Worktree**: /private/tmp/worktrees/arch-context-328-d5-read-snapshot
> **Created**: 2026-10-14

## Goal and scope

Eliminate repeated model/Git-visible file discovery between runtime architecture-debt and
docs-anchors during one invocation. Reuse the canonical U4 document scanner through the existing
prose-anchor producer. Preserve ownership, citations, report/digest, coverage and evidence;
keep fresh per-call reads and no persistent cache. Leave required before/after CodeGraph evidence
checks intact. No D6/D7, #351, scanner/parser rewrite, other repository implementation, merge or release.

Root cause trace: readArchitectureDebtEvidence loads the native model and Git-visible files,
then runDocsAnchorsCommand independently loads both again. Sharing the already-read inputs
within that invocation removes the duplicate producer work without changing the evaluator.

## Frozen performance protocol (coordinator approved N=5)

The RFC names a less-than-three-second edit-time result, but fixes no repository SHA or
sample count. Reuse the research's representative consumer subject:
repo-harness@90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49, with the same five paths under
assets/templates/helpers/: acceptance-receipt.ts, capability-config.ts, capability-resolver.ts,
change-assessment.ts and check-skill-version.ts. Measure a frozen Git fixture derived read-only
from that commit; do not change the actual consumer checkout. Retain a complete ready CodeGraph
index for normal symbol coverage; record any unavailable/unchecked coverage without disguising it.

Approved sample count: five independent cold CLI processes before and five after, sequential,
including the first. No warmup, discarded samples, coverage narrowing or rounding a failure down.
Every final representative edit-time sample must be strictly below3000ms, including process startup. Bind every
sample to engine SHA/product-source digest, subject SHA/Git-tree fingerprint, literal paths,
Bun/Node/runtime/OS/arch, coverage and report digest. Publish raw elapsed nanoseconds/milliseconds,
all exits and every report digest, not only a median.

Use arch-context@a697adad as a separate control with the five historical source paths:
CLI main.ts; runtime practice-checkpoint.ts and architecture-debt.ts; review-engine
architecture-debt.ts; contracts architecture-debt.ts. Five cold processes before and after.

Full repository debt is a separate workload: three cold processes before and after per subject,
explicitly labelled with coverage, including practice unavailability if no practice evidence is
supplied. Do not advertise full debt as satisfying the edit-time budget. Frozen inputs, index
preparation and file/runtime byte snapshots happen before timing and are recorded.

The coordinator approved this subject/count protocol before any sample. Fresh processes do not
imply flushed OS file caches: index preparation, preflight reads and byte hashing can warm them.
The timer includes direct spawn through exit/output drain, Bun/CLI/native initialization and
producer child processes, but excludes manager startup, fixture/index preparation and metadata
hashing/report parsing. Record preflight coverage and every raw sample under the unchanged inputs.

## Task Breakdown

- [x] Read issue328, repository rules, original evidence and existing writer/claims.
- [x] Verify latest origin/main and create an isolated D5 branch/worktree; preserve U4/main.
- [x] Trace duplicate discovery; provide the fixed workload/sample proposal.
- [x] Resolve/freeze representative workload and sample counts before any timing.
- [ ] Capture unmodified producer outputs and independent cold-process baseline samples (blocked
      before timing by the frozen consumer's v2 manifest against the existing v3 reader floor).
- [x] Introduce narrowly scoped per-call read-input reuse; no cache across invocations.
- [ ] Verify exact report/digest/coverage parity, additions/deletions/model edits/citation repair,
      canonical scanner behavior and unavailable indexes; prove read operations write no state.
- [ ] Measure every agreed after sample on frozen inputs and report the first result immediately.
- [ ] Run exact-HEAD checks, ordinary push and PR; hand off hosted CI/performance limits.

## Verification and rollback

Use the canonical task contract for affected checks. Keep original3016ms evidence intact.
Performance is a separate gated experiment, never a functional pass or a universal latency claim.
Rollback the internal input-sharing change and its tests; no model/runtime/schema migration.

