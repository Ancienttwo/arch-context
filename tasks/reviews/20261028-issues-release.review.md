# 0.9.4 independent acceptance review

Subject: `226b6bda2dbda60d36c3f449979a5ad7cacd58b3..dc93dcf3308cc80e8dede032a7cbc3ea300801cc`.
Reviewer: independent Claude Opus, Herdr `default`, agent `arch-release-review`, pane `wC:p5`.
Scope: all 49 changed files; issues #409, #414, #415, #417, #421. PR #420 was already accepted and merged separately.

The reviewer inspected architecture/API boundaries, filesystem and SQLite snapshot safety, ref evidence binding, daemon readiness and authenticated shutdown, portable receipt claims, version authorities, test assertions and adversarial composition/scale scenarios. It ran no tests and made no edits, consuming the parent's recorded checks.

Verdict: no code blockers; approve after a documentation clarification. The impact reader summarizes snapshot failures as `ref-code-facts-unavailable`, so its runbook must not imply that each unsupported-layout cause is individually exposed. The parent clarified that behavior and identified `flows check --no-sync` as the surface exposing specific snapshot failure reasons. No runtime change was needed.

The reviewer confirmed the configured-source fixture retained its `[1, 1]` assertion and added original-provider preconditions; the directory correction exercises the provider's actual `includeIgnored` contract. Renamed-selector tests exercise the documented complete provider lookup; ambiguity retains unknown coverage. No assertion was removed to turn a failing implementation green.

Receipt model digests are already validated by the committed-journal reader; the parent did not add a second validator. Unsigned receipts remain explicitly unauthenticated. The positive Node/Bun snapshot fixtures cover the reviewer’s static uncertainty about private-root readiness. Tarball/clean-install checks and full release gates remain separate pending evidence.

An automatic stop-hook ownership warning named historical `.github` paths outside this diff. It was not changed or treated as a candidate defect.

## Verification follow-through

The full run exposed the receipt schema's non-absolute `$id`. Commit `ff81e1d7` changes only that resolver identifier to the repository's HTTPS origin/path convention; the same reviewer checked this narrow delta and reaffirmed approval. A resolver-constructing targeted run passed 278 tests. No receipt schemaVersion or payload shape changed.

The subsequent full inventory completed with 3594 passes, 4 existing/platform skips and 2 failures. Parent fix `06d6927f` preserves detailed local resolve argument messages while retaining the registered recovery policy; the existing `line 2` assertion remains unchanged. The flows help expectation now includes the required `--no-sync` flag and additionally checks both write modes. All five targeted CLI regressions passed, with typecheck exit 0. The prior review is not represented as a new independent whole-diff review of this follow-through; final-head hosted checks remain the merge gate.

## CI Git configuration boundary

Run `40584651324` failed in the shared Node pre-check at the blanket Git configuration guard. An inert Git LFS configuration reproduced that rejection locally. `cb3ccd6f` uses Git-owned effective attributes across tracked paths instead of rejecting all configured filters, including embedded repositories and copied attributes. Provider readiness uses `git status`, so selected filters still fail closed; its `--name-status --no-renames` diff does not invoke patch callbacks.

The independent reviewer found a reserved-name ambiguity: real drivers named `unset` or `unspecified` have the same printed values as Git's sentinels. Two real clean-command fixtures demonstrated original-fixture marker writes before the fix. `c2c941fd` cross-checks configured reserved-name drivers and rejects before execution. Both marker tests now pass, with six snapshot tests / 24 assertions, typecheck and Node bundled smoke passing. The reviewer approved this bounded follow-up; the intermediate guard was never pushed or merged. Earlier affected suites passed 37 tests. Final-head hosted CI remains required.

## Windows resource lifetime

Run `40588721453` exposed EBUSY in Windows cleanup. Temporary diagnostic runs `40593845507` and `40595384814` isolated retained SQLite statements: private snapshot cleanup overrode valid ref facts. The GC experiment failed and was not added to the release branch.

The accepted design boundary keeps query semantics in the pinned public SDK while assigning its handles to the same platform bundle's Node process. The caller receives validated complete query tables, evaluates inside the original-input stability window, and removes the private snapshot after child exit. No PATH fallback, global GC, private SDK mutation, ignored cleanup error, or weakened semantic assertion is used. Fixture setup and live-WAL holders also have explicit process lifetimes.

Local affected suites passed 39 tests; Windows scoped run `40602640776` passed 39 tests / 176 assertions plus bundled Node smoke at `14475e63`, whose product/test files match `b195b249`. The diagnostic workflow is confined to its separate branch. Independent source/transport review and the complete final-head matrix remain separate gates.
