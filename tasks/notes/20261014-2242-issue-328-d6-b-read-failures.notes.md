# D6-B implementation notes

Frozen baseline: 550ae58b2376b35548e332066932dfe782f517b7. Worktree:
/private/tmp/worktrees/arch-context-328-d6-b-read-failures; branch:
codex/issue-328-d6-b-read-failures. This section records the original local preparation; the accepted-main delivery below supersedes
its uncommitted/awaiting-A status. The original exact 15-path contract preceded implementation; the coordinator's
single-boundary amendment also preceded this bounded source revision. A checkout remains clean.

## Current design and intended semantic changes

Use one runDocsAnchorsCommand entrypoint and one selectedProducerFailure adapter for both
standalone and nested debt callers. No readArchitectureDebtAnchors, private boundary mode or
reader-specific legacy adapter remains. architecture-debt uses its original call with {model,files}.
The global writer projectionFailureEnvelope remains byte-identical to 550ae58b.

| Case | Current contract |
| --- | --- |
| Unknown anchors producer exception, including nested debt | Neutral W1, failure-unclassified, inspect-diagnostics/error/retryable false, details.stage docs-anchors. Old nested failure-metadata/debt attribution is intentionally superseded, not claimed byte-identical. |
| Five registered existing producer cases: Git, three projection preconditions, index-missing | Preserve code/action/reason/severity/retryability; explicit golden assertions cover both readers and nested debt. |
| Valid FailureError | Preserve its producer fields and custom attributes through all callers; no legacy downgrade solely for compatibility. |
| Invalid/accessor/boxed metadata | Fixed failure-metadata W1, no getters/conversion hooks. |
| Successful read plus close error | Safe W1 at producer docs-anchors for standalone and nested debt. |
| Producer refusal plus close error | Keep the primary refusal and its attributes; still attempt close exactly once per invocation. |
| Surface request IDs | docs.anchors for direct anchors; debt and existing outer labels remain owned by those surfaces. |

Added only two fixed FailureStage values: docs-anchors and flows-check. The existing 17 policy
pairs, FailureError family, authoritative messages/defaults, validator and budgets are unchanged.
The extracted helper retains original architecture-debt exports and all existing-stage behavior;
B stages use empty Git facts instead of debt-specific ownership/anchors checks. Root refusals are
classified at the actual locator catch. CLI selects docs anchors and flows check/input refusals;
other docs passthrough, successful help and imported runCli rejection behavior remain intact.

The successful anchors evaluation body is byte-identical to the frozen source; public signatures,
report/digest/coverage semantics and D5 call-local model/files discovery remain unchanged. Existing
flow CodeGraph sync/index behavior is retained; no zero-CodeGraph-filesystem-write claim is made.
No RPC wire/client/registry, global MCP, D7, upgrade, package/lock, workflows or budgets changed.

## Design convergence and regression evidence

The original frozen requirement asked for A stage preservation. Review identified that the initial
B shared entrypoint instead exposed docs-anchors to nested debt. A temporary internal legacy path
was implemented and verified against that requirement. Read-only A/B probes established this was
a B-induced compatibility change, not evidence of an A P1/P2 blocker.

The coordinator then explicitly authorized actual producer-stage attribution for safe unknown
failures and rejected a lasting debt-only legacy branch. The plan/contract were amended first.
Two replacement regressions reproduced red on the compatibility revision (0 pass / 2 fail,
27 assertions), then passed after that path was removed. The old compatibility solution and its
byte-preservation assertions are superseded, not silently retained.

Current nested regression injects ten unknown/typed/registered failures through direct anchors,
debt command and both raw debt readers. It asserts full producer metadata, explicit known action/
severity/retryability, equal strict failures across callers, zero conversion hooks and no sentinel
leakage. Cleanup regression checks six invocations individually: each closes exactly once; typed
and registered precondition refusals survive simultaneous close failure through both surfaces.

Initial B red baseline before any product edits was 1 pass / 8 fail / 16 assertions, with the other
docs passthrough control already passing. That remains historical evidence, not a current result.

## Preparation verification (before accepted-main integration)

Bun 1.4.3 / Node 24.18.0; DO_NOT_TRACK=1 and CODEGRAPH_NO_DOWNLOAD=1. Dependencies were installed
offline with frozen lockfile and scripts disabled. package/lock are unchanged.

| Check | Current revision result |
| --- | --- |
| Direct reader test file | 6 pass / 0 fail / 257 assertions |
| bun run typecheck | pass |
| node scripts/package-boundary-audit.mjs | pass, five workspaces |
| Contract d6-b-affected, seven files | 62 pass / 0 fail / 1732 assertions |
| Contract d6-b-flow-success, real CodeGraph + existing CLI cases | 3 pass / 0 fail / 134 assertions |
| node scripts/packaged-cli-smoke.mjs | pass; native-context Node bundle and CLI smoke |
| verification-plan validate / git diff --check | pass; unchanged check-plan hash sha256:9cf1568256ffcbab35512c46373119e9bc3da88389f068ae649ba5cd021917c7 |

The affected suite includes D5 discovery-count/report/digest/coverage baselines; A raw, CLI, MCP,
hook, complete and real health-process regressions; old anchors success/unchecked behavior; and
new reader failure/cleanup/privacy/input tests. No full local governance run was made.

## Review and preservation

Three read-only reviewer lanes were used under the strict contract's cap of three in one semantic
review cycle. Original security/adversarial lanes found no concrete B-only finding. The original
architecture stage-preservation finding is now superseded by the explicit coordinator amendment.
The same reviewer confirmed this bounded revision: no residual debt-only path, known attributes
preserved, cleanup once, primary refusal retained. Two focused tests / 123 assertions / zero
failures. This is a bounded delta confirmation, not three fresh full reviews or broad D6 sign-off.

Scope remains 13 changed paths: six source, three tests and four workflow artifacts, all allowed.
Eleven excluded/protected files match frozen 550ae58b, including writer projection-service,
daemon index/checkpoint, four RPC modules, global MCP entrypoint, package/lock and verify workflow.
contracts/failure.ts differs only by two fixed stages. The extracted helper body differs only by
B-stage Git fact selection. Successful anchors evaluation and D5 shared input call are unchanged.
A checkout remains clean and unchanged.

SHA-256 of the sorted nine-file product/test manifest (file SHA-256, two spaces, relative path, LF):
043c2a32e1855fade64d98d5cb32dce966d9a16733f42c6c4c2a2b0cd23ce842.
The earlier 1186f31d... manifest belongs to the superseded compatibility revision.

## Historical preparation delivery gate

No B commit, push, PR, merge or issue closure. A CI/merge and the coordinator's accepted-main
integration baseline remain separate gates; this revision did not query or mutate A's hosted state.
After coordination, deliver incremental B-only changes with the agreed checks. This slice does
not complete D6/#328 or authorize any global RPC/MCP migration.

## Accepted-main integration

The coordinator confirmed A merged at 71d8b65b6efe0be2daee26608cc37c02baeba6d5 and authorized
B-only commit/rebase, affected checks, independent review, normal push and Draft PR. All 13 original
files were archived first with all-file manifest 037225b3f6c04ab7d5b0ea03372ccb564b29d6f150d93bf33e0d2a1f0c15369f.
The B-only commit rebased without conflicts to 99a980a547ebaefba42377bb4db44fbeade6ceee; source/test
manifest remains 043c2a32e1855fade64d98d5cb32dce966d9a16733f42c6c4c2a2b0cd23ce842. No old A commits
were replayed and no source/test bytes changed during integration.

Current accepted-main checks all pass: typecheck; five-workspace package-boundary audit; seven-file
affected suite 62 pass / 0 fail / 1732 assertions; three flow/CLI cases 3 pass / 0 fail /
134 assertions; packaged native Node and CLI smoke; verification-plan validation with unchanged
plan hash sha256:9cf1568256ffcbab35512c46373119e9bc3da88389f068ae649ba5cd021917c7; git diff --check.
Real CLI readback confirms fixed safe JSON errors, exit 1, empty stderr, successful help exit 0
and no runtime state for the empty non-Git fixture. No full local governance was run.

The accepted-main product patch is byte-identical to the original B patch. The anchors success
body is byte-identical to main. Exact scope remains 13 paths, including only four dirty evidence
files after verification. Writers, all RPC modules, MCP, CI workflows and package/lock are unchanged.
A remains clean at cbbc31819139464c8b2bb18544fa5159f47eb2d8; BYOK main checkout remains clean at
e23ed5dafd492c79e2217f6793eacd9b66187bab. Hosted B CI is not yet started.

All three fresh independent integration lanes completed without a concrete new finding at
confidence >=0.60: security/abuse, architecture/composition, assumptions/cascade/adversarial.
Their scopes and exact focused evidence are recorded in the review file. No source/test bytes
changed after independent review. The follow-up evidence commit changes only the same four
workflow artifacts and does not require repeating unchanged product checks. Normal push and
Draft PR are authorized; hosted Verify is still pending, self-merge/#328 closure remain excluded.

## Coordinator-authorized accepted-main 31bbc3bb integration

Original B: 63f6a26369b774d8192f42b00defcfb7040394ca, clean. Normal merge commit
0b56e067ee84b4c4db3fc6b52ce79a3712bfb646 has exactly two parents: original B and accepted
31bbc3bbd5714a84776ec1c419c44e2d5db79603. No conflict or manual product edit was needed.
The accepted commit supplies the already reviewed identity fix and CI configuration. Relative
to that accepted base, B still has exactly its original 13 changed paths.

Preservation proof: all added/deleted product/test patch lines are identical to the original B
patch after omitting Git blob/hunk-position metadata; SHA-256
e7abd7486263468c8af62fa0e66cda4c4c83a3b135f989b82ccf7c16153cf31d. Eight nonshared product/test
blobs are byte-identical to original B; the shared CLI file contains only the accepted-main
changes plus the unchanged B patch. C1 frozen commit 1aad65d19614ca7a173d5083eeadd5472e05aab6
is not an ancestor, and no C1 product delta is included. Evidence is retained in the delegated
workspace b-integration-verification/merge-preservation-proof.json and original-b-manifest.json.

Current verification covers the seven original affected files, full CLI test file, both accepted
identity/version test files, type/boundaries and packaged smoke. No name filter, raised timeout,
platform skip, new writer, new product change or CI edit is introduced. #358 did not reproduce
the native assertion but has collection limitations and remains under investigation; it is not
a fix or substitute for this new B candidate's complete hosted CI.

### Final local integration results

All checks exited zero. Affected/type/boundary command: 47.30 s, including 62 tests across seven
files / 1732 assertions / zero failures. Whole CLI/identity/version files: 210.53 s, 119 tests
across three files / 2188 assertions / zero failures. Packaged native-context/CLI smoke: 15.25 s.
The runner confirmed INPUTS_UNCHANGED true for every recorded product/test/accepted-main input.
Total test evidence is 181 passed / zero failed / 3920 assertions across ten complete files.
No timeout increase, test-name filtering or product edit followed verification.

Raw results and per-command logs are in the delegated workspace b-integration-verification/.
Contract validation is valid, plan hash sha256:c8a688a7da446ae67bb8b31fd3d1b81d2072594a0e9bb80f787a8a338afc1548.
The final evidence commit changes only the four original B task artifacts. Final ordinary-push
HEAD and new hosted run are read back from GitHub after this commit; full hosted CI is pending.
C1 remains frozen at 1aad65d19614ca7a173d5083eeadd5472e05aab6 in its separate worktree.
