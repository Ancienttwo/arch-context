# Plan: #328 D6-C1 local public failures

> **Status**: Draft PR handed off; hosted acceptance pending
> **Owner**: delegated Codex sole C1 writer
> **Base**: 31bbc3bbd5714a84776ec1c419c44e2d5db79603
> **Task Contract**: tasks/contracts/20261015-0054-issue-328-d6-c1-public-failures.contract.md
> **Task Review**: tasks/reviews/20261015-0054-issue-328-d6-c1-public-failures.review.md
> **Implementation Notes**: tasks/notes/20261015-0054-issue-328-d6-c1-public-failures.notes.md

## Goal and scope

Execute the coordinator-approved C1/C2 split. Freeze 59 canonical operation boundaries and
24 allowed source paths before product edits; exact names, code/facts schemas and producer
evidence live in tasks/notes/20261015-0054-issue-328-d6-c1-public-failures.scope.json. This is more than eight files. No new public command/config/service.
Use the single FailureError/policy authority and own-data validation; no English-message cause
inference, raw diagnostics, truncated critical bindings or C2 gateway normalization.

## Data flow

    explicit local producer -> shared strict policy/facts -> selected public operation
    native reader          -> native diagnostic policy   -> export envelope
    C2 writer/recovery     -> preserved original escape  -> C2 gate (no C1 conversion)

Success identity/shapes, existing side effects, cache/pin/session/lifecycle ordering and known
code/action authority remain. Unknown escaping failures become safe fixed W1 only inside C1.
Six lifecycle symbols remain held; nine state guards and approved docs-pin recovery sentinel
are explicit partial C2 exceptions, preserving original exception identity and complete bindings.
No withWriter/recovery class/receipt/store/RPC wire, shared CLI/MCP, #354, repo-harness or B edits.

## Verification and rollback

Use the contract's type/boundary, affected families and packaged smoke. New regression witnesses
run red before source changes; preserve no-write/count/real success assertions in existing tests.
One bounded semantic review cycle in three reused read-only lanes, then one final-head push and
Draft PR. Hosted Verify remains acceptance; no repeated full local governance. Roll back C1 source
and policy changes only; no data migration, merge, release or issue closure is authorized.

## Task Breakdown

- [x] Verify accepted main and create isolated branch without B commits.
- [x] Freeze entrypoint counts, exact facts/source evidence and allowed paths.
- [x] Reproduce meaningful regression witnesses on unchanged product code.
- [x] Implement C1 local producer/public-boundary failures; record C2 stopped paths.
- [x] Run affected checks and independent review; fix confirmed in-scope findings.
- [x] Commit, ordinary push and Draft PR #359; final provider HEAD/base/CI readback accompanies the coordinator handoff.
