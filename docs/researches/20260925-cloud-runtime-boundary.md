# Cloud/runtime boundary — issue #166

Baseline: `main@0b82128`.

## Map and trace

Cloud hardening imported the local CodeGraph adapter only for a version constant, and imported the daemon egress implementation to read local environment/configuration. The CLI doctor is the production composition caller. Cloud runner imported local Git functions for checkout root, origin, HEAD/tree, detached state and cleanliness checks; its checkout verifier's current repo callers are integration tests.

The contracts workspace already owns the product manifest's CodeGraph version and the CodeFacts port. Hardening does not need the full CodeFacts API: it consumes a typed `LocalEgressReport` value, produced by the local composition layer. The local CodeGraph adapter and cloud diagnostics now read the same version authority.

Runner checkout verification receives a required `ReviewCheckoutGitPort`. The implementation remains in local-runtime/git-adapter; cloud retains the pure repository/checkout decision logic. Existing real-Git tests inject that adapter and retain their repository, head, tree and dirty-worktree assertions.

## Decision

Remove the forbidden package dependency and production imports. The boundary audit rejects both a manifest dependency and a production import if they return. A disposable-workspace regression exercises both failures.

Delete the unused exported `applyArchitectureUpdate` application wrapper. The ChangeSet engine remains the mutation primitive used by daemon-owned orchestration; CLI/MCP continue to call daemon operations.

Use issue #166's documented alternative for core filesystem I/O: describe the current boundary accurately rather than undertake an unrelated relocation of eight engines. Core contains filesystem-backed model/policy/projection logic; it is not wholly runtime-independent. Its model summary was updated through `scripts/apply-model-proposal.ts` and daemon ChangeSet apply, with proposal digest `sha256:98b3b813a33bf12fcad606e1f300b26314136c3d440bbced158f3e848fb0ce5e`. No generated projection was hand-edited.

At larger repository sizes, the existing synchronous checkout and egress observations retain their existing cost. This change moves ownership boundaries and adds no extra Git calls, caches or fallback implementations.

## Evidence

Before implementation the strengthened audit rejected the cloud manifest and three production imports. After injection it passes. The runner, Git adapter, hardening and core application suites pass 44 tests; typecheck passes. The removed stale-apply test exercised only the unused wrapper; daemon apply freshness remains covered by runtime tests.

The frozen branch passed the full `bun run verify` pipeline under Bun 1.4.0 and Node 24.18.0: 1,859 tests, zero failures, typecheck, package/schema boundaries, packaged CLI smoke, privacy checks and configured eval gates. The eval report still records the existing historical prose-only drift recall gap; passing configured gates does not establish production cloud delivery.
