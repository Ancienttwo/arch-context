# Plan: #328 D6-B standalone reader failure exits

> **Status**: Review
> **Owner**: delegated Codex D6-B sole implementation writer
> **Frozen code baseline**: 550ae58b2376b35548e332066932dfe782f517b7 (#356 D6-A; not yet merged)
> **Worktree**: /private/tmp/worktrees/arch-context-328-d6-b-read-failures
> **Branch**: codex/issue-328-d6-b-read-failures
> **Task Contract**: tasks/contracts/20261014-2242-issue-328-d6-b-read-failures.contract.md
> **Task Review**: tasks/reviews/20261014-2242-issue-328-d6-b-read-failures.review.md
> **Implementation Notes**: tasks/notes/20261014-2242-issue-328-d6-b-read-failures.notes.md

## Authority and delivery boundary

The coordinator explicitly authorized parallel preparation and local implementation of this slice
from frozen 550ae58b while A finishes CI. A's original worktree stays unchanged. No push, PR,
merge, release or issue closure is authorized now. Do not publish a stacked PR or duplicate A.
After A merges, coordinate the accepted main baseline and incremental verification before an
independent Draft PR. If A requires a real product repair, pause B expansion for integration.
B is not all of D6 and does not close #328. No second implementation writer.

## Scope and due diligence

P1: contracts/failure.ts remains the one FailureError/policy/budget/validator authority. Runtime
producer adapters classify registered classes; CLI only adapts selected entrypoints. The legacy
projectionFailureEnvelope also serves writers and must remain byte-identical.
P2: runDocsAnchorsCommand catches via that legacy adapter; its finally reader.close can escape
that catch. runFlowSelectorCheckCommand uses the same legacy adapter. CLI docs anchors/flows
input refusals and escaped exceptions still use raw messages or guessed preconditions.
P3: extract existing selectedProducerFailure implementation into producer-failure.ts, preserving all existing-stage behavior,
retain architecture-debt's existing exports and known producer metadata, and reuse one anchors
entrypoint/adapter for standalone and nested debt callers.
No new Error family, global sanitizer, public input flag or new persistence. D5 model/files/input
reuse and reader discovery counts remain intact. Flow's existing CodeGraph sync/index behavior
is retained; this slice does not claim zero filesystem writes by CodeGraph.

## Frozen failure and compatibility contract

- Keep the existing 17 registered reason/code policies, action/severity/retryability defaults,
  primitive and own-data guards, UTF-8 budgets and critical-binding refusal unchanged.
- Add only fixed stages docs-anchors and flows-check. CLI uses requestId docs.anchors/flows.check
  for these selected paths. Existing surface request IDs stay unchanged. The coordinator explicitly
  authorizes unknown nested anchors failures to carry the actual producer stage docs-anchors,
  replacing legacy failure-metadata/debt stages. This is an expected B behavior change, not byte
  preservation. Use one anchors entrypoint/adapter; no debt-only legacy compatibility branch.
- New reader stages emit Git refusal details as {} rather than debt-specific checks; existing A
  stages retain their current checks. Preserve the three ProjectionPreconditionError reasons and required index-missing
  through both readers. Unknown failures use W1 AC_UNCLASSIFIED_FAILURE/failure-unclassified,
  inspect-diagnostics/error/retryable false with the reader's fixed stage; never inspect messages.
- Classify root-discovery refusal at its actual findRepositoryRoot catch, like the existing A
  debt command; never identify it from error text.
- Preserve known FailureError attributes and revalidate mutated/accessor/boxed metadata using
  existing helper semantics. Unsafe metadata becomes the fixed failure-metadata refusal.
- Docs anchors, including nested debt calls, closes an opened reader exactly once. A prior producer failure remains primary
  if close also fails; close failure after a successful read becomes safe W1. Do not expose raw
  close text or suppress the close attempt.
- Success JsonEnvelope/report identity, findings/digests/coverage, optional-CodeGraph unchecked
  results and flow business-negative proof remain unchanged. Direct value APIs retain signatures.
- CLI docs anchors and the flows command's check/input-refusal route are selected; help stays
  successful. Other docs subcommands, global runCli rejection, native/U4 and MCP remain unchanged.
- No writer projectionFailureEnvelope, projection/apply/state/receipts, RPC wire/client/registry,
  D7 floors/advertisement, #351 upgrade, workflows, package/lock or verification budget edits.

## Verification and rollback

Use the canonical contract's affected/type/boundary checks, the existing real-index flow success
case, real CLI privacy/input cases and packaged smoke. Add red regressions before implementation.
Do not run full local governance; the coordinator explicitly prohibited repeated full runs. Final
main-based CI/independent acceptance is a later delivery gate, not implied by local focused passes.
Rollback only B imports/adapters/stages/tests; no data migration or state transition exists.

## Task Breakdown

- [x] Verify A ownership/clean state and create a separate worktree at exact frozen baseline.
- [x] Freeze this contract, source/test inventory and compatibility decisions before implementation.
- [x] Add and reproduce targeted direct/CLI/cleanup failure regressions on unchanged product code.
- [x] Extract/reuse producer adapter and implement only two reader/CLI failure boundaries.
- [x] Run approved affected verification and one scoped review; address confirmed in-scope issues.
- [x] Report local delta/evidence, preserve A, and wait for accepted-main integration window.
- [ ] After A merge and explicit coordination, verify incremental B delivery without duplicate A.

## Local review outcome

The first review identified nested anchors stage drift against the original frozen requirement.
An internal legacy compatibility branch was initially verified, but the coordinator explicitly
superseded that requirement with the unified producer-stage contract above. The current bounded
revision removes the compatibility path, preserves known metadata and primary-failure cleanup,
and updates semantic regressions. Current approved checks pass: 62 affected tests / 1732 assertions,
three flow/CLI tests / 134 assertions, typecheck, boundary audit and packaged smoke. The original
reviewer confirmed this bounded delta with two focused tests / 123 assertions / zero failures.
The accepted-main/hosted-CI gate remains open. No B commit, push or PR has been created.

## Coordinator-directed design convergence

- [x] Explain the initial B-only stage regression; read-only A/B probes establish no A blocker from it.
- [x] Amend this contract before source changes: permit safe producer-stage attribution for unknown
  nested failures and require one anchors entrypoint, known metadata and primary-error cleanup.
- [x] Replace compatibility assertions, reproduce the revised contract red, then remove the branch.
- [x] Run bounded affected checks and original-reviewer delta confirmation; update final evidence.
