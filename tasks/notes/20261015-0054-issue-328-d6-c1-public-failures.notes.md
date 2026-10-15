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

The initial delivered delta was 48 owned files: 22 source, 21 tests and five task documents.
The coordinator subsequently admitted one existing audit consumer script, making 49 total files;
no path is outside the expanded explicit inventory. The held lifecycle/writer methods and legacy shared projection envelope
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

## Authorized hosted-consumer correction

Hosted run 38683388347 (HEAD 17fc6724b39a77e2fda56cf8bef3dbb25166cb34) ended completed/failure.
Sampled Governance, Linux Node24 and macOS Node24 logs stopped at the same production audit
assertion. `scripts/production-mock-reachability-audit.mjs:229` still required the injected key
in error.message. C1 intentionally uses the fixed production-injections-refused message, so the
actual injection was refused but the consumer rethrew it as an audit failure.

The coordinator explicitly admitted this existing consumer into C1. The bounded patch imports
FailureError and checks its type, AC_SCHEMA_INVALID, production-injections-refused and issueCount=1.
All six injection keys, real composition/adapter checks, graph traversal and bundle scan remain.
No production source/test, CI workflow/budget, dependency, entrypoint, reason or C2 change is made.
The applied original audit passed: 5 workspaces, 54 production exports, 145 graph files, one
2868123-byte production bundle and all six forbidden injection keys. Four temporary negative
witnesses (accepted injection, raw message-only error, wrong registered reason, wrong issueCount)
all failed as required. Product/test and audit hashes were unchanged throughout verification.
Evidence: delegated workspace c1-verification/production-audit-applied-result.json and
audit-repair-input-manifest.json. Contract validation passed with plan hash
sha256:0f1af51d6f83f0e5ce9720e5694af9e2baa2dd6a05a771eafc5ffdfd7a747cfd.
One ordinary push follows the old run's terminal failure; final provider readback supplies the
follow-up HEAD and new hosted CI state. No still-running hosted run is cancelled.

## Hosted complete-consumer correction (current)

The pre-consumer 484-test evidence above is historical. Run 38684264483 on cf8ec989 exposed six
independent consumer failures; Governance and all three Linux full runs agree with the macOS
shard union. These are not treated as cosmetic expectation changes:

1. Snapshot mismatch lost its known compared field. The typed producer now carries a closed field enum.
2. Docs network refusal lost the --allow-network remedy. The fixed registered message restores it.
3. Deps lost unknown-node versus invalid-limit/missing-value context. Producer and CLI adapter now
   retain closed field/issue enums, with no echo of arbitrary caller node IDs.
4. Jobs claim lost its known missing workerId. Its branch now carries that closed field.
5. C1 converts known Git errors to FailureError; the old MCP catch recognized only the original
   class and falsely emitted retryable AC_RUNTIME_UNAVAILABLE. The existing MCP adapter now
   validates/preserves FailureError; the real non-Git MCP code/reason assertion remains and adds
   action/severity/retryability checks. No assertion accepts runtime unavailable.
6. Explorer lost the proven observed-input absence. Source metadata now carries observed/unavailable
   and explicitly unclassified cause. The old CodeGraph message heuristic is removed from this
   catch; no provider string or guessed index cause becomes trusted metadata.

The coordinator explicitly authorized these current C1 repairs. No new entrypoint or reason,
C2/D7 change, CI workflow/budget/platform change or timeout increase is included. Three narrow
consumer source paths and three test files were admitted, totaling 27 allowed source files and
55 actual changed files (25 source, 24 tests, five task docs and one audit consumer).

Typecheck, five-workspace boundary audit and diff check passed after the repairs. The final
verification now runs 35 complete files, including full cli.test.ts, deps.test.ts, mcp-local.test.ts,
rpc-argument-codec.test.ts and local-runtime.test.ts. The superseded name-pattern commands were
removed from the contract because these full files subsume them. Final results and the remaining
Windows failures/old-run terminal state will be recorded before a single ordinary push.

The first complete consumer run finished 833 pass / 2 fail / 10459 assertions across 35 files
(440.24 seconds); production audit and packaged smoke passed. All six initially exposed behaviors
were repaired, and the run reached a later projection assertion that the earlier snapshot failure
had masked. Its fixed registered message now retains sorting/uniqueness remediation, with the
original remedy assertion plus explicit code/reason checks. The other failure was an overstrict
new missing-value assertion: the existing global CLI preflight correctly retains its schema error
and --from instruction. That original gate is preserved and explicitly asserted; it is not rewritten
under C1. No false all-green result is claimed for this first complete run.

Final verification repeats all 35 complete files at the same existing CI timeout, with the full
CLI file and the other 34 files in independent processes. Seven semantic corrections span the
six original failed tests; no newly observed provider cause is guessed.

## Prior 35-file consumer evidence

All final checks passed on unchanged source/test/audit hashes:

- Whole CLI contract file: 112 pass / 0 fail / 2130 assertions (220.27 seconds).
- Other 34 whole files: 723 pass / 0 fail / 8334 assertions (209.02 seconds).
- Combined: 835 pass / 0 fail / 10464 assertions across all 35 files, with no name filtering.
- Full deps file: 6 cases; full MCP file: 20; full RPC argument codec: 153; full runtime file: 85.
- Typecheck and five-workspace package audit passed (0.68 seconds).
- Original production reachability audit passed (0.22 seconds); graph/bundle/six injection gates remain.
- Packaged native and CLI smoke passed (14.84 seconds).

Evidence in the delegated workspace: consumer-final-results.json, consumer-final-input-manifest.json
and consumer-final-file-summary.json under c1-verification/. Contract validation passed with
plan hash sha256:25f1504b8696b8d285484f852a3f26bbde8743cc744203de332a418f10b5f809.
The six original CI failed test cases span seven restored semantics (snapshot field and later
projection input remedy are separate branches in one case). Full old-run Windows collection and
terminal readback remain prerequisites for the single ordinary follow-up push. No source or test
will change after this evidence unless an additional real failure requires a bounded correction.

## DE1/DE3 static wiring consumer correction

The coordinator independently confirmed that the stale audit still required the old interpolated
throw source string. Only scripts/data-engine-source-invariants.ts and its test change. The audit
retains declaration-scoped refusal witnesses and now requires the current fixed observed absence
message plus inputDomain=observed, availability=unavailable and cause=unclassified. Removing the
throw or any fact independently fails; placing the missing observed fact in an unrelated function
also fails. No-empty-observed fallback, bounded indexed reads and explicit graph authority checks
are unchanged. No provider-message heuristic or production logic is restored. The unchanged audit
reproduced 34 pass / 2 fail; the corrected complete file passes 40 / 0 with 86 assertions.

The coordinator's full-root command was run exactly once after the final audit/test correction:
bun test --timeout 60000, with no file list, name filter or skip option. It ended with exit1
after 700.57 seconds, not a budget timeout: 2939 cases across 266 files, 2861 pass / 75 fail /
3 existing platform/fixture skips / 22339 assertions. This is not a full green result. The default
execution plane refuses a direct Node loopback bind with EPERM. Captured failures include Bun
EADDRINUSE/listener refusal, daemon/peer startup, headless Chromium startup, and npm pack cache
EPERM. The raw log and all 75 failed cases are retained. Ten fixture/assertion failures initially
lack a direct error cause in their captured block and are not silently certified as repaired.
No elevated execution, altered timeout or platform change was attempted.

The following checks ran after the complete root command: wiring audit 40 pass / 86 assertions
(0.05s), typecheck (0.67s), five-workspace boundary audit (0.14s), production reachability audit
(0.25s), all exit0. Packaged smoke (3.45s) passes its native-context phase but exits1 at daemon
start, reporting Failed to start server / port0, under the same execution restriction. All
recorded source/test/audit input hashes remain unchanged. Verification plan validation passes
with hash sha256:838b7c02a44ed6775fd642c858880c5d25863871b27693cb3aa6dee8c84b6b52.

Evidence directory in the delegated workspace: c1-verification/wiring-followup/ contains
verification-final.json, full-failure-inventory.json, full-bun.log and each post-check log.
Current hosted run 38688782994 is still nonterminal at this note. All ten completed failed jobs
have raw logs; nine expose the same two static audit cases, and Windows Node22 shard2 separately
fails projection apply accepts the major change it observes (#261) during fixture codegraph init.
That process exits 5 after stdout Done, empty stderr; no native assertion text was observed in
that job. Its full context is windows-codegraph-init-failure.json. Do not infer a #358 fix or
broaden C1 for it. Wait for the remaining Windows Node24 full job, all aggregate failures and
terminal provider readback before one delivery. B is unchanged and clean at ca35871d.

## Normal approval and bounded failure classification

The coordinator explicitly reaffirmed C1 commit/push authorization and required the original
exec tool's normal require_escalated approval path. The exact seven-file git add succeeded
(exit0); no chmod, lock deletion, bypass or alternative writer was used. The initial default
index.lock denial remains evidence of that execution boundary.

The retained 75-case full-root inventory distinguishes direct evidence from inference:

- 64 cases contain server/listen refusal evidence, including EADDRINUSE, Failed to listen,
  listen EPERM, or daemon logTail Failed to start server. This category does not assert that
  each original log independently identified the OS-level cause.
- One Mermaid case captures Chromium sandbox_parameters_mac.mm:87 FATAL Input/output error5.
  This is browser-start evidence, not an EPERM assertion. A normally approved single-case
  headless-browser recheck passes with 2 assertions (0.94s).
- One contracts packaging case reports npm cache EPERM. Its generic root-owned-cache hint is
  not assumed correct, and no cache ownership/permission repair or repeat full suite was made.
- Nine cases have only startup timeout or assertion failure in their original blocks. The
  exact same selected commands were run in independent processes under default execution and
  approved loopback execution. Default: 0 pass / 9 fail, probe EPERM. Approved: 9 pass / 0 fail /
  96 assertions, probe OK. This removes whole-suite order as the sole explanation for the
  failure and supports an execution-permission dependency, without rewriting the full result.

The nine are: frozen-v1 RPC peer startup; CLI audit-list spawn, concurrent cold starts, deleted
worktree idle-exit, deleted-worktree daemon list/stop; and all four existing #351 identity cases.
Per-case names, identical commands, timings and both raw logs are in classification-and-recheck.json,
default-unknown-results.json and approved-loopback-unknown-results.json. Default grouped timings:
RPC 15.27s, CLI 16.99s, identity 46.12s. Approved timings:RPC 0.43s, CLI 10.34s, identity 2.31s.
Approved packaged native-context and CLI smoke both pass in 14.61s. Package source/test/audit
hashes remain unchanged in both phases. Type, boundaries, production audit and wiring results
from the unchanged candidate remain valid; they were not repeated for status.

The original full command remains 2861 pass/75 fail/3 existing skips over 266 files, with no
second full execution or full green claim. Windows Node22 shard2 codegraph init exit5 is separately
retained with its #261 test name, Done stdout and empty stderr; no common root with
UV_HANDLE_CLOSING is presumed. At verification-commit time the old Win24 full is still active;
terminal provider inventory and exact final delivery HEAD/CI are supplied separately after it ends.
