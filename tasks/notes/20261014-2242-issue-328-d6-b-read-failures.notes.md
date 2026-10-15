# D6-B implementation notes

Frozen baseline: 550ae58b2376b35548e332066932dfe782f517b7. Worktree:
/private/tmp/worktrees/arch-context-328-d6-b-read-failures; branch:
codex/issue-328-d6-b-read-failures. HEAD remains the frozen baseline with the local B delta
uncommitted. The original exact 15-path contract preceded implementation; the coordinator's
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

## Current approved verification

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

## Remaining delivery gate

No B commit, push, PR, merge or issue closure. A CI/merge and the coordinator's accepted-main
integration baseline remain separate gates; this revision did not query or mutate A's hosted state.
After coordination, deliver incremental B-only changes with the agreed checks. This slice does
not complete D6/#328 or authorize any global RPC/MCP migration.
