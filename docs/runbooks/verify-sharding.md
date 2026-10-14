# Verify job sharding

This workflow change ships independently of daemon PID identity PR #354. It does not change product code, existing test assertions, protocol behavior, platform coverage, job timeouts, or repository permissions. The first hosted run measures the budget; the estimates below are not a passing CI claim.

## Execution and ownership

`package.json` keeps the original local `verify` command byte-for-byte. `verify:pre` and `verify:post` are exact projections of the commands before and after its main `bun test --timeout 60000`. `verify:ci` owns `scripts/verify-ci.mjs`; `.github/verify-sharding.json` owns active scheduling weights and the two split targets. The weights are not a test whitelist.

Only the measured timeout legs, macOS15/Node24 and Windows/Node25, receive three whole-file test jobs. The other seven OS/Node combinations retain one complete verifier. Each test job gets its own checkout, Bun process, and real temporary daemon/SQLite fixtures. Tests within a file remain sequential. No shared fixture, concurrent test mode, mocked protocol replacement, or platform skip is introduced.

The split dependency graph is **pre → all test shards → coverage proof → post**. Matrix dependencies may delay a healthy target when the other split target is slow; queue time is not a job timeout or a reduction in billed runner time.

## State and gate order

The pre job preserves Windows ACL regression → platform IPC readback/upload → all original pre-gates, in order. It then builds the native Bun discovery plan. Ubuntu22's network-isolated E2E and upload stay on its unsplit worker. Governance and Linux arm64 checks are unchanged.

The post job waits for every test shard, validates exact file coverage, then executes all original post-gates in order: explorer, full packaged CLI smoke, privacy checks, committed readbacks, acceptance ledgers, sprint status, and evaluations. It does not run the native-only smoke in place of the full smoke.

No test machine state is migrated. The pre CodeGraph Node-selector gate creates and removes its own fixture and bundle under a temporary/cache directory. Test files likewise own their temporary state. The post explorer check reads source and constructs its own benchmark data; the packaged CLI script builds a new native bundle and creates a fresh Git/daemon/SQLite fixture from its local dependency install. Privacy/readback/acceptance/sprint/eval gates read committed inputs. They do not consume test SQLite, runtime connections, JUnit, or bundles produced by another machine. Dependencies and platform bindings are installed again on each post runner. Only the discovery plan and test inventory/JUnit metadata cross jobs.

## Discovery and coverage

The pinned Bun1.4.3 runner performs its real discovery with an impossible test-name pattern, writing a **fresh native timing inventory**. This metadata-only process executes module registration but no test bodies. Its documented-by-fixture no-match exit is accepted only for this inventory operation; import/evaluation failures are rejected. The inventory includes files with no registered tests. It respects Bun's own patterns, exclusions and path handling rather than duplicating them in a glob.

The controller balances all currently discovered paths using the historical cost weights, assigning an explicit default scheduling weight to newly added paths and ignoring weights for deleted paths. Each shard executes unfiltered, exact file arguments through `spawn` argument arrays, so spaces are preserved. Its measured timing inventory starts empty and is never seeded with weights. An empty planned shard writes an explicit zero-file report and never launches an accidental unfiltered full suite.

The coverage gate checks subject (`run ID`, `attempt`, checkout SHA), target, every expected shard including empty ones, zero exit status, assigned versus actually executed paths, pairwise disjointness, and union equality with real Bun discovery. Missing, duplicate, foreign, stale, failed or omitted-file reports fail. Plan/shard artifacts include the attempt in their name.

The nine final required-check names remain `OS / Node version`, as required by the live FG6 reader. IPC artifacts retain `platform-ipc-permission-OS-node-version` and are produced exactly once per target on the actual OS runner. The collector and summaries use `always()`. The collector reads all pages of the current attempt's GitHub job API and checks every expected execution job individually for a unique name, completed/success conclusion, and matching run/attempt/head. A missing, skipped, cancelled, failed, duplicated or cross-subject job fails its target. An API failure fails all summaries. Matrix rollup success alone is never sufficient. Existing workflow permissions remain `contents: read`.

## Runner minutes and first-run measurement

The approved-plan source run is Verify38608334128, analyzed before any retry: eleven jobs consumed **261.63 raw runner minutes**, including cancelled legs; eleven dependency installs consumed **3.15 runner minutes**. That is an incomplete verifier baseline, not evidence that all gates passed. The six #351 cases contributed only 33.81 seconds to Windows25's main test run.

This design has **17 expensive execution jobs** rather than unconditionally tripling all nine targets. Including unchanged Governance/arm64 jobs, there are **19 installs**, eight more than before. The two split targets each incur four extra installs. At the sampled install times (macOS24 13s, Windows25 58s), repeated install overhead alone is about **4.73 raw runner minutes**. Added checkout/setup/download/upload time and twelve lightweight Linux jobs (topology, collector, nine summaries, cost report) are additional cost. The entire workflow has 31 jobs, compared with 11 previously; the hypothetical all-nine split would have multiplied expensive jobs across all platforms.

Expected total for a complete new run is roughly **270–285 raw runner minutes** under the sampled runner speeds. Billing rounds jobs individually and can apply OS-specific pricing/allowances; raw sum, rounded-per-job model, and workflow wall clock are distinct. No billing settings or permissions are queried or changed, and this estimate is not an invoice forecast.

The whole-file model places the longest test shard around 6.7min on macOS24 and 20.2min on Windows25. With ordered pre/post stages and repeated installs, the split path is expected around **8–10min macOS** and **30–33min Windows**, excluding queue delays. All execution jobs retain the existing **20/60min** caps. These are predictions; neither a local fixture pass nor historical weights proves the new hosted budget.

`Verify runner cost` waits for all nine summaries plus Governance and Linux arm64, then publishes `verify-runner-cost-attempt-N/runner-minutes.json` and a job summary containing total completed raw runner minutes, the sum of per-job rounded minutes, OS totals derived from actual runner labels (not summary names), completed dependency-install count/time, and elapsed time at the sample. The reporting job's remaining cleanup/upload time is explicitly unmeasured. `verify-job-evidence-attempt-N` separately records the exact branch head/run/attempt and each target's actual job verdict. The first Draft CI run supplies these measurements before any budget acceptance or serial integration of #354.

## Local verification

`bun test scripts/verify-sharding-workflow.test.ts scripts/governance-verify-workflow.test.ts scripts/platform-ipc-permission-workflow.test.ts scripts/fg6-platform-workflow-matrix-readback.test.ts` exercises real Bun add/delete discovery, spaces, same-basename paths, empty files/shards, stage transfer, failed imports, strict report subjects, individual job failure propagation, runner-cost arithmetic, existing workflow contracts and all unchanged assertions. Run typecheck and actionlint against the workflow as well. The native discovery census on the latest-main-based checkout contains 260 files, including three files absent from the old weight table; one deleted weighted path is ignored. No product suite is skipped by this scheduling census.
