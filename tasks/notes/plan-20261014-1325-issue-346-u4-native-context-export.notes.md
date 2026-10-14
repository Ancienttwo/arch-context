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
