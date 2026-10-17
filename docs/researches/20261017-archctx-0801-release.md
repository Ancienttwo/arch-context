# archctx / archctx-contracts 0.8.1

## Changes

Model reading and native export:

- #372: model files can be YAML 1.2 flow collections, such as the output of `Bun.YAML.stringify`. When a `{` or `[` text is not strict JSON, the shared parser reads it as one flow collection with the core schema. Strict JSON results do not change. Anchors, aliases, explicit tags, non-scalar keys, multiple documents and non-finite numbers are refused. A duplicate key still returns `native-context-input-ambiguous`, now with branch `yaml-flow`.
- #373: native export schema and reference issues carry `path`, the repository-relative file that holds the record. The path comes from the parsed input, not from the entity id, so duplicate and invalid ids keep their own files. When all reported issues share one file, the failure also sets `details.path`.
- #370: `resolve` and `validate` reject the invalid models that native export rejects. ChangeSet can repair a schema-invalid node through the approved write path (#371).

Runtime and diagnostics:

- #374: `complete`, `prepare` and the checkpoints refuse an unusable CodeGraph index with `AC_CODE_FACTS_NOT_READY`. The details copy the `doctor.codeFacts.issues` pairs. The action is `install-compatible-codegraph` or `codegraph-index`. Pending source changes alone do not block a task. `doctor.codeFacts.reindexRecommended` now agrees with its issues. The `AC_UNCLASSIFIED_FAILURE` message names `archctx doctor --json`.
- #367: a failed or timed-out Windows native ACL child reports `phase`, the last progress step it reached (#368). No stderr text, path or input is kept.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together, at the same version.

The `archctx-contracts` changes are additive: the optional `NativeModelIssue.path` field, an optional third argument to `nativeContextModelIssues`, the error code `AC_CODE_FACTS_NOT_READY`, the reason `code-facts-not-ready`, the optional `CodeFactsPort.assertCanSync` hook, and the public schema `schemas/runtime/native-model-issue.schema.json`. Old callers keep three-field issues.

With the default binary, CodeGraph sync now runs the package-local CodeGraph 1.6.2, the same binary that `doctor` reads. A custom binary keeps its existing resolution. A repository whose index was built with another CodeGraph version now gets `AC_CODE_FACTS_NOT_READY` from task commands. Rebuild the index once, as `docs/runbooks/code-facts-readiness.md` describes.

Inputs that failed to parse before can now parse: flow collections with plain scalars and YAML 1.2 core scalars such as `0x10` and `~`. Block YAML still does not decode single-quoted scalars, and its comment handling is incomplete.

The runtime RPC stays v2. The committed projection format does not change. CodeGraph stays pinned to `@colbymchenry/codegraph` 1.6.2, Bun at 1.4.3 and Node at `>=22.22 <26`. No runtime dependency is added.

## Verification

Run in the release-prep worktree on `main@86c8bbe1` (after #368, #369, #375, #376 and #377) plus the release commit, with Bun 1.4.3. Hosted CI passed on that main commit.

- `bun install --frozen-lockfile` passes after the version sweep. The sweep changed only the five workspace version lines in `bun.lock`.
- The practice catalog digest was regenerated with `loadPracticeCatalog`. Two generations are byte-identical to the committed `catalog.yaml`. Only `productVersion` and `catalogDigest` changed.
- The version-bound deterministic records (fg4, fg6) were regenerated with `readback:fg4:deterministic-conclusion` and `readback:fg6:no-provider-deterministic`. `modelDigest` and `generatedAt` changed, and both report no failures. A second run changed only `generatedAt`, so that run was not kept.
- `bun scripts/fg6-npm-release-dry-run.ts run --json` reports `ok: true`, status `verified`, no failures, for `archctx@0.8.1` and `archctx-contracts@0.8.1`.
- `bun run verify` passed every step before `bun test`. In `bun test`, 3388 tests passed, 4 were skipped and 4 failed. All 4 failures were in `packages/surfaces/cli/test/projection-protocol-lifecycle.test.ts`. They timed out after 9 to 18 minutes while the host load average was about 22. An isolated rerun of that file passed 21 of 21 in 4 minutes. The remaining `verify` steps, from `verify:explorer` to `evals/run.ts --check`, were run separately and all exit 0.

Not run in this commit: `readback:fg6:local-product-tarball`, the npm preflights and the clean-room install. The hosted CI matrix runs on the release-prep pull request. The npm publish, tag `v0.8.1` and the GitHub Release are not done yet.

Publish both npm packages after the release-prep CI passes and the pull request merges. Rebuild the tarballs from the merged main commit. Create tag `v0.8.1` and the GitHub Release only after both npm publishes succeed.
