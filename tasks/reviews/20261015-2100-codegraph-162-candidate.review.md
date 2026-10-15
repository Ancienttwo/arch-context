# Review: CodeGraph 1.6.2 candidate

## Independent scope and finding

One existing read-only reviewer checked40frozen source/test/lock inputs, the unchanged CRLF file boundary, protected historical versions and the3necessary generated artifacts. No review fleet, shared writer or independent test rerun was introduced. The v2 pass found one confirmedP2 in default DNT propagation for the docs producer's new native init on fresh checkouts. Root fixed only that call site through existing disableCodeGraphTelemetryByDefault(env); v3 differs in that one producer only. A bounded no-parent-DNT observation probe rejected before native init with the fix removed and completed the actual temp fixture with the fix present. The same reviewer completed the bounded one-file follow-up: P2 closed; v3 all40source/test/lock hashes and3necessary generated artifacts LGTM, no remainingP1/P2. The reviewer inspected actual v3 type/apply/drift/record/readback evidence and the DNT red/green boundary probe.

## Local evidence and limits

21complete affected files528/0; unchanged whole CRLF file4/0; completeCLI once111/1 followed by exact diagnosed builtin case1/0; AL9two complete files4/0, both actual producer/readback paths verified, official fresh init/changed-file-sync0 with empty stderr, Node selector integration, source-bound types, packaged/native CLI smoke and architecture verification pass. All intermediate red results remain in task operations evidence. Current manifest comes from supported docs apply and clean drift; two JSON evidence packets come from real existing record commands; Markdown outputs stayed byte-identical;13historical/frozen paths remain untouched.

Candidate acceptance remains limited to the independent Draft PR stage. Original Windows UV exit9 root cause remains unproven; actual hosted Windows/matrix evidence and final exact-head acceptance are required before any eventual merge. #358 remains open. No runtime/flag/timeout/exit relaxation, retry, vendor patch, release or other worktree mutation is authorized by this review.
