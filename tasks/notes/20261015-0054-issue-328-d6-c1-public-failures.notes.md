# C1 implementation and verification notes

Current base is accepted main `31bbc3bbd5714a84776ec1c419c44e2d5db79603` (#354).
Original freeze base was `71d8b65b6efe0be2daee26608cc37c02baeba6d5`; no unmerged B is included.
Fast-forward had zero overlap and retained every dirty C1 file byte-for-byte. Main/BYOK and A/B
worktrees are not edited. No CI, test-budget controller, shared RPC wire, SQLite, writer/recovery,
receipt/readback implementation or repo-harness changes are part of C1.

The inventory stays at 59 canonical public boundaries and 24 allowed source files. Initial schema
reconciliation recorded 84 then 88 local reasons; existing failure repairs add two explicit request
identity reasons and two reason-less typed RefactorScanError code fallbacks: 92 local schemas and
21 native reasons now frozen. No further entrypoint, reason or recovery architecture is added.
Every local schema has current producerReferences in the scope JSON. These are static source
witnesses, not exhaustive behavioral coverage. The inherited authority-event-missing upstream
message-prefix heuristic is explicitly recorded as a provenance residual, not a new inference.

C1 preserves original success results, mutation algorithms, typed producer code/action/severity/
retryability, and raw throw versus returned-envelope shape. Registered failures use own-data facts;
unknown causes become safe W1. Required identity/digest facts are complete and never truncated.
Only full source-generated confirmation/command composites have a 1024-byte field allowance;
other string facts retain 256 bytes. Details and actual compact/rendered envelopes remain <=8KiB.
Native diagnostic overflow omits whole items with counts. Constructor identities remain compatible.
Ten named C2 boundaries and six lifecycle symbols remain held; returned legacy C2 failures and
unresolved journal objects are not swallowed by the C1 result adapter.

## Regression history

- Unchanged main: 0 pass / 6 fail / 7 assertions. Witnessed native accessor execution, a 24624-byte
  native failure, missing resource reason, raw unknown escape, absent consent facts and native
  unknown misclassified as input-unreadable.
- First complete affected run: 361 pass / 73 fail / 4430 assertions across 29 files. Failures exposed
  C2 normalization, lost confirmation/command facts, missing typed mappings and legacy text checks.
- Repair run: 439 pass / 13 fail / 6551 assertions across 30 files. Ten failures were localhost
  fixtures blocked by the default sandbox; Node probe returned EPERM there and succeeded with
  approved local test permissions. Three remaining product/assertion failures were repaired.
- Before #354 integration: 451 pass / 1 fail across 30 files; selected CLI 15 pass / 2 fail;
  lifecycle/production 9 pass / 0 fail / 92 assertions; packaged native/CLI smoke passed.
  Last three failures were fixed in the existing delta adapter and CLI fact assertions, retaining
  all no-write, publisher-call, rollback and recovery assertions.

## Final verification and review

The accepted-main run before independent review was green (452 affected, 17 selected CLI and
9 selected runtime tests). Review then identified five bounded P2 groups. All are fixed and the
original three reviewers confirmed closure in the same review cycle: hostile Proxy inspection,
five existing native enum values, own schema lookup, projection throw shape and Context7 own
retryability. No new entrypoint or reason was introduced. The review file records findings,
confirmations and limits.

Final post-review run on unchanged source/test hashes:

- Complete affected: 458 pass / 0 fail / 6838 assertions across 30 files (202.83 seconds).
- Selected CLI: 17 pass / 0 fail / 381 assertions (95 filtered, 8.41 seconds).
- Selected lifecycle/production: 9 pass / 0 fail / 92 assertions (76 filtered, 3.79 seconds).
- Packaged native and CLI smoke: passed (17.94 seconds).
- Typecheck and five-workspace boundary audit: passed after the last source edits.
- Focused review repair witnesses: 16 pass / 0 fail / 92 assertions across three files.

The complete and selected suites total 484 tests and 7311 assertions. Evidence is retained in the
delegated workspace `c1-verification/reviewed-results.json`, associated reviewed logs and
`reviewed-input-manifest.json`. Earlier failing or pre-review runs remain historical only.
Dependencies were installed offline with frozen lock and lifecycle scripts disabled.

The actual delta is 48 owned files: 22 source, 21 tests and five task documents; no path is outside
the allowed inventory. The held lifecycle/writer methods and legacy shared projection envelope
were checked byte-for-byte against accepted main. Final delivery is an ordinary commit and push
plus Draft PR; provider readback supplies the final HEAD and hosted CI state. No merge/release or
#328 closure is authorized.

## Draft delivery

Draft PR: https://github.com/Ancienttwo/arch-context/pull/359
Branch: `codex/issue-328-d6-c1-public-failures`.
Product/test commit: `de2ec7b74651be867eb3bbea7b06d2a0e177fc14`.
Base: `31bbc3bbd5714a84776ec1c419c44e2d5db79603`.
A documentation-only follow-up records this delivery; the final provider readback is authoritative
for the branch HEAD and hosted check state. Source/test hashes remain those of the reviewed run.
The Draft PR is attached to this delegated task. Coordinator owns hosted acceptance and merging.
