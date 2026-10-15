# Plan: CodeGraph 1.6.2 upstream shutdown mitigation candidate

> **Status**: Review
> **Owner**: delegated Codex sole writer
> **Base**: be19d8ec1fb8767a2edff4de92188f43557cb958
> **Task Contract**: tasks/contracts/20261015-2100-codegraph-162-candidate.contract.md
> **Task Review**: tasks/reviews/20261015-2100-codegraph-162-candidate.review.md
> **Implementation Notes**: tasks/notes/20261015-2100-codegraph-162-candidate.notes.md

## Approved scope

The user/coordinator approved an independent #358 candidate from latest main, exact-version impact inventory first, then implementation and one Draft PR. This is an upstream shutdown mitigation candidate; the Windows UV_HANDLE_CLOSING exit9 root cause remains unproven. No merge of this candidate, issue auto-close, release, workaround, retry, budget change, vendor patch or replacement embedded runtime is part of this task. Preserve #360/#361, BYOK and all existing changes. Root alone writes; one existing worker inventories and reviews read-only.

## Impact and evidence

Official npm/tag v1.6.2 resolves 6560052a6f856855d3f71eee838fd66ccfa4285d. Exact wrapper and six platform versions move together. Current version identity spans root/local-runtime manifests, product-version and projection contracts, three schemas/four consts, current fake providers/fixtures, release dependency assertions, two AL9 producers and their generated evidence. Handshake fixture digestJson and projection receipt digests must be recomputed through exported helpers. Historical D5 1.6.1 experiments remain historical. The path allowlist is tasks/notes/20261015-2100-codegraph-162-candidate.scope.json.

Upstream release: https://github.com/colbymchenry/codegraph/releases/tag/v1.6.2 . Worker startup/teardown and grammar releases changed alongside broad resolution behavior. Official 1.6.1 embedded Node measured v24.16.0; 1.6.2 source build defaults v24.16.0, actual installed bundle measurement is pending. Upstream Windows access violation3221225477 differs from issue358 UV exit9. Mac evidence cannot prove Windows repair.

## Task Breakdown

- [x] Read routing/rules; isolate clean be19 worktree; inventory exact current versus historical version consumers and upstream release evidence.
- [x] Record official 1.6.1 init/changed-file-sync baseline and bundle identity under DNT.
- [x] Update exact dependency pins and tool-generated lock, current contracts/schemas/fixtures/consumers; install only this worktree's own dependencies.
- [x] Recompute fixture digests through existing exports; run existing AL9 generators and readbacks rather than hand-edit evidence.
- [x] Run unchanged whole CRLF/change-classification file, official1.6.2 changed-file sync, affected whole contract/adapter/projection/runtime/CLI files, selector Node integration, typecheck and packaged CLI smoke with finite execution and no green retries.
- [x] Complete one independent frozen-patch review; repair only bounded confirmed findings.
- [x] Prepare the exact reviewed candidate for ordinary publication as one independent Draft PR; retain provider readback in the operations delivery record, with no closing keyword for #358.
- [ ] Receive hosted Windows/matrix and final exact-head acceptance before any candidate merge; #358 stays open.

## Acceptance boundaries

Preserve exact-version fail-closed, pre-existing older-version negatives plus 1.6.1 rejection, no-success-on-nonzero-exit, existing version/status/sync deadlines, telemetry opt-out, official launcher/runtime flags. Keep by-value and duplicate-selector refusals. If upstream changes selector evidence, retain concrete runtime output and explain before adapting any assertion. Record failures truthfully; no repeat full-root/whole-CLI runs just to seek green. Hosted matrix evidence and independent review remain required before any eventual candidate merge.
