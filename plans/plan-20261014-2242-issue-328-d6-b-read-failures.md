# Plan: #328 D6-B standalone reader failure exits

> **Status**: Accepted-main 31bbc3bb locally verified; hosted CI pending
> **Owner**: delegated Codex D6-B sole implementation writer
> **Preparation baseline**: 550ae58b2376b35548e332066932dfe782f517b7
> **First accepted integration base**: 71d8b65b6efe0be2daee26608cc37c02baeba6d5 (#356 squash merged)
> **Current accepted integration base**: 31bbc3bbd5714a84776ec1c419c44e2d5db79603
> **Worktree**: /private/tmp/worktrees/arch-context-328-d6-b-read-failures
> **Branch**: codex/issue-328-d6-b-read-failures
> **Task Contract**: tasks/contracts/20261014-2242-issue-328-d6-b-read-failures.contract.md
> **Task Review**: tasks/reviews/20261014-2242-issue-328-d6-b-read-failures.review.md
> **Implementation Notes**: tasks/notes/20261014-2242-issue-328-d6-b-read-failures.notes.md

## Authority and delivery boundary

The coordinator authorized preparing this slice from frozen 550ae58b, then explicitly
confirmed #356 squash-merged at 71d8b65b6efe0be2daee26608cc37c02baeba6d5 and authorized
incremental B delivery: preserve the local delta, rebase only B onto accepted main, run the
agreed affected checks and independent review, ordinary push and create an independent Draft PR.
The original 13 files were archived with per-file SHA-256 before any commit/rebase. Only B's
single preparation commit was replayed; no old A commit was duplicated. A/BYOK checkouts stay
unchanged. No merge, release, #328 closure, C/D implementation or repo-harness edit is authorized.
B is not all of D6. No second implementation writer.

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
- [x] After A merge and explicit coordination, verify incremental B delivery without duplicate A.

## Local review outcome

The first review identified nested anchors stage drift against the original frozen requirement.
An internal legacy compatibility branch was initially verified, but the coordinator explicitly
superseded that requirement with the unified producer-stage contract above. The current bounded
revision removes the compatibility path, preserves known metadata and primary-failure cleanup,
and updates semantic regressions. Current approved checks pass: 62 affected tests / 1732 assertions,
three flow/CLI tests / 134 assertions, typecheck, boundary audit and packaged smoke. The original
reviewer confirmed this bounded delta with two focused tests / 123 assertions / zero failures.
Those are historical preparation results. B is now rebased as 99a980a547ebaefba42377bb4db44fbeade6ceee on accepted main; current integration checks/review and hosted CI are separate evidence below.

## Coordinator-directed design convergence

- [x] Explain the initial B-only stage regression; read-only A/B probes establish no A blocker from it.
- [x] Amend this contract before source changes: permit safe producer-stage attribution for unknown
  nested failures and require one anchors entrypoint, known metadata and primary-error cleanup.
- [x] Replace compatibility assertions, reproduce the revised contract red, then remove the branch.
- [x] Run bounded affected checks and original-reviewer delta confirmation; update final evidence.

## Accepted-main delivery

- [x] Archive all 13 original files and prove the nine source/test files remain byte-identical after rebase.
- [x] Replay only B onto accepted main 71d8b65b6efe0be2daee26608cc37c02baeba6d5.
- [x] Re-run the contract checks and bounded independent integration review.
- [x] Record final local delivery evidence; ordinary push/Draft PR and hosted CI readback follow this docs-only commit.

Source/test manifest SHA-256 remains 043c2a32e1855fade64d98d5cb32dce966d9a16733f42c6c4c2a2b0cd23ce842.

Accepted-main verification passed with the same 62 affected tests / 1732 assertions and three
flow/CLI tests / 134 assertions, typecheck, boundary audit and packaged smoke. Three fresh read-only
integration lanes (security/abuse, architecture/composition, assumptions/cascade/adversarial)
returned no concrete new finding at confidence >=0.60. Hosted CI remains the final integration gate.

## Accepted-main 31bbc3bb integration

The coordinator authorized one integration owner in the original B worktree. Merge only accepted
31bbc3bbd5714a84776ec1c419c44e2d5db79603 into the existing B branch; do not include unmerged C1.
This is a branch integration merge, not authorization to merge the GitHub PR or close #328.

- [x] Confirm original B is clean at 63f6a26369b774d8192f42b00defcfb7040394ca.
- [x] Normal merge accepted main; shared CLI file merges automatically without conflicts.
- [x] Prove original B product patch unchanged; eight unshared source/test blobs identical; C1 absent.
- [x] Run affected/type/boundary, whole CLI plus identity/version files, and packaged smoke.
- [ ] Normal push and exact HEAD/CI handoff; hosted B CI remains required.

Merge candidate: 0b56e067ee84b4c4db3fc6b52ce79a3712bfb646. The previous 62-test/3-filtered-case
results are historical for the earlier base. The current integration uses complete CLI/identity
files and does not infer Windows native-runtime safety from the separate #358 investigation.

Final local evidence on merge candidate 0b56e067ee84b4c4db3fc6b52ce79a3712bfb646:
typecheck and five-workspace boundary audit passed; seven affected files passed 62 tests /
1732 assertions; complete CLI plus identity/version files passed 119 tests / 2188 assertions.
All 181 tests passed without filtering. Packaged native-context/CLI smoke passed. All recorded
source/test/accepted-main input hashes remained unchanged. Verification plan validates with hash
sha256:c8a688a7da446ae67bb8b31fd3d1b81d2072594a0e9bb80f787a8a338afc1548.
The four task artifacts are the only post-verification edits. Ordinary push and exact final HEAD/CI
provider readback follow this docs-only commit; no hosted success or PR merge is claimed here.
