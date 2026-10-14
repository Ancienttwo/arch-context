# U4 implementation notes

- Baseline: 5e144af06c56a9d564d8a06356b732ded7f7fb22; S4 #347 and D4 #348 merged.
- CLI write-seat release confirmed by integration coordinator; RPC schema/version work remains separate.
- Frozen corpus baseline: repo-harness@902c4ed7866f2b7359b1553a8cd64934496ea3c7; 454 manifest/model files. The unmodified shared helper matches Bun.YAML.parse consumer values for all 454.
- Feature trio awaits overlap coordination.

## Phase 1 evidence

- Isolated ArchContext prepare succeeded with normal posture. Meaningful-change debt checkpoint succeeded with zero observed items and partial coverage; this is not a zero-debt claim.
- Contracts, checked Git OID/blob codec, selected-input source adapters, canonical native graph validation, shared lossless document scanner/glob helper and thin native CLI are implemented in progress.
- Existing shared regressions: 38 pass / 0 fail. Development typecheck passes. Primitives/parser/CLI: 148 pass / 0 fail. Reader matrix is under final rerun after correcting unavailable-selected-blob classification.
- Real source: ArchContext baseline ref and worktree agree on inputDigest and expose 50 nodes / 45 relations / 1 flow.
- Frozen parser corpus: 454/454 before-and-after/consumer value parity; canonical native graph validates 102 nodes / 299 relations / 52 flows.
- Consumer coverage remains unconfirmed: all 40 selected repo-harness@902c4ed mixed Markdown documents retain historical v5/sourceDigest marker metadata and fail the current strict marker contract. Exact public paths/diagnostics are frozen in test/fixtures/native-context/downstream-corpus/document-coverage.json. Canonical projection refresh or separately reviewed historical-marker compatibility is required before downstream reader removal can be claimed. This work does not rewrite downstream files or silently fall back.
- Latest main has RPC v2 fix #350 at 0ec298699aa714362757df5cf69d81ff65c1c931; integration follows the local phase checkpoint, retaining its metadata and fixture values.

## Final integration progress

- The integration coordinator authorized the bounded historical v5 read grammar under #349 section 7. The former strict-v6-only rejection was an implementation restriction, not a corpus incompatibility. Its original document-coverage.json remains unchanged as history; documents-v5.json adds 40 exact public source documents and independent human-byte complements.
- Both known renderer grammars retain pairing, duplicate/nesting, target and output checksum guards. The historical sourceDigest is syntax-checked metadata only. Current v6 producer/freshness behavior is unchanged.
- The fixed repo-harness corpus export succeeds with 102 nodes, 299 relations, 52 flows, 37 capability profiles, 10 contracts and 40 documents. Its inputDigest is sha256:6d03b7e581bd78bdfff655caf9eb214b47b63c2b03ddfa66a6cc6e02340f1d24; all 454 parser inputs retain consumer values and all 40 documents retain exact human bytes.
- Isolated Node bundle smoke succeeds for fixed-ref/worktree, dirty-source isolation, exact human bytes and absence of CodeGraph, Bun, development compiler, index mutation or runtime state. It found eager CodeGraph SDK loading; the adapter now resolves that installed dependency only when an SDK operation needs it. No dependency/version bump was introduced.
- Final capability feature trio, CLI examples, spec exception and runbook are added after the packaged proof. RPC v2 and renderer v6 metadata remain as merged.
- Six independent read-only review passes found seven distinct reproducible boundaries. Corrections disable Git replace objects; reject filesystem aliases at existing ancestors; preserve confirmed multiline/indented Markdown code and escaped/unpaired backticks; keep legacy generated-body delimiter policy; parse headings without polynomial regex backtracking; and bound diagnostics plus the rendered failure envelope. Regression checks cover each correction.
- Aggregate verify attempt 1 stopped at two cross-package relative imports, now corrected to the core package entrypoint. Attempt 2 was interrupted by the outer repo-harness helper's 120-second process timeout before it could record an aggregate result. Neither attempt is passing evidence. The final run uses the same canonical verification-plan executor directly with its explicit long timeout.
- Workflow artifacts use the harness's timestamp stem, without the plan- prefix; the three owned old paths are migrated. The resolver now recognizes the task contract and owner, with no edit blockers. Coordinator acceptance, hosted matrix, issue closure, release and merge remain separate.

## Aggregate verification correction

The frozen aggregate run reached 3091 passing tests and three platform skips, with two failures:
the invalid-fixture schemaVersion lookup lacked the new native protocol entry, and npm pack could
not write to the machine's configured cache. The lookup is registered alongside the existing
fixture/schema inventory. Verification declares npm_config_cache and uses an isolated writable
cache for this invocation; no global npm settings or cache are changed. The remaining aggregate
steps and final rerun must be reported truthfully in the Draft PR.

## Passing baseline and bounded BOM delta

The aggregate verify passed with exit 0 at 4f68c76a774fd74c5691c1a0745a0dfe0e5054aa,
execution vx-2212fb60798d4045856b, retaining its immutable run record. A final small follow-up
normalizes the BOM only for the existing Markdown block predicates, matching the scanner's
existing heading/fence behavior. Original bytes and ranges remain untouched. It adds the BOM
case to the existing ATX/checksum regression. The Verification Plan retains the passing
aggregate as baseline_with_delta and binds current scanner/reader/CLI/typecheck/Node bundle
evidence instead of repeating the unchanged full suite.

## Hosted Windows native smoke repair

At ae1f84ec, all three Windows Node lanes completed 3092 passing tests / five skips / zero
test failures, then failed before native export handling: the isolated Node bundle could not
resolve @node-rs/jieba. The smoke assumed packages/core/node_modules/@node-rs existed and
silently omitted it when absent. The precise hosted install layout is not captured in those
logs; the portable fix removes that layout assumption.

The smoke resolves declared dependencies from the owning core package and resolves each
current-platform native binding from its parent dependency. It copies these package files
into the temporary stage, excluding nested node_modules, and clears only the child Node's
ambient NODE_PATH/NODE_OPTIONS. Missing dependencies/bindings fail explicitly. No repository
module link, CodeGraph, Bun or development compiler is available to the staged Node entry.
The fixed-ref/worktree, original-byte, index and empty-state assertions are retained. Local
Node native smoke passes; hosted Windows Node 22/24/25 confirmation remains required.

The original Mac Node 22 lane was cancelled by its 20-minute job budget. Its logs continued
through existing heavy tests without a failing assertion. Baseline duration comparison does
not prove a purely infrastructure cause. No workflow timeout or assertion is changed here.
