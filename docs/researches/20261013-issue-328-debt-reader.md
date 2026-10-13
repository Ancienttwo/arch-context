# Issue #328 debt reader: boundaries and evidence

Base: `ade6255d13cec021226b3b116cd7624e83fe524b` (2026-10-13).
Claude planning proposal: Herdr `w8:p1`, `/tmp/worktrees/328-claude-proposal.md`.
Implementation scope: D0/D1/D2; #327 S2/S3 are separate concurrent work.

## P1: authority and scope

Contracts owns the debt payload/schema. `core/review-engine/src/architecture-debt.ts` aggregates
measured evidence without I/O or parsing source. `runtime-daemon/src/architecture-debt.ts`
reads the existing model/ownership/anchor producers. CLI and stateful checkpoint share that
reader. Projection keeps its existing public dependency-debt shape, projected from the common
`dependencyDebtFromMeasurement` function; no second relation or import semantics were introduced.

Current `resolve`, `docs anchors`, `flows check` and `deps` already avoid daemon discovery.
`flows check` still calls the adapter's syncing handshake, so it is not used by the debt reader.
CodeGraph adapter and complete freshness changes are owned by #327 S2/S3 until integration.

## P2: concrete path

`debt --changed-path` -> CLI argument validation -> Git root/model/file enumeration -> existing
parent-chain ownership -> existing `docs anchors` -> pure debt evaluator -> typed envelope.
There is no runtime client, local store, render, CodeGraph sync or mutation on that path.

`checkpoint` -> `PracticeCheckpointService` -> the same reader -> existing practice computation
and baseline save. Debt failure returns before a new baseline is saved. Coalescing skips repeat
practice computation, while the independent debt read remains fresh. `debt.digest` prevents a
consumer from confusing a stable practice resultDigest with unchanged citation findings.

## P3: measured choice and remaining decision

Observed D0 in-process probe (live workspaces, one run, no index sync):

| Subject | Model | File list | Owners | Anchors | Digest | Imports | Selectors + evaluation | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| arch-context, `ade6255d` | 12 | 489 | 1 | 62 | 146 | 0 | not measured | 712 ms |
| repo-harness, `90cd97fb` | 57 | 646 | 2 | 1,144 | 636 | 1,546 | 106 | 4,137 ms |

Each scope contained five TypeScript paths. Arch-context had no index, so its value measures an
incomplete path only. Repo-harness had 6,145 indexed import nodes and 220 selectors (195 proven,
25 unproven, 3 used by required flows). Component timings are rounded independently, so their
sum need not equal total overhead. These were observations of live workspaces under concurrent
host load, not an isolated frozen benchmark or a universal worst-case claim.

The repo-harness observation exceeds the RFC's three-second falsifier. The edit-time command
therefore evaluates ownership and anchors and explicitly marks other producers as unmeasured.
At 10x repository size the first bottlenecks are file enumeration and repository-wide citation
reads; no 10x latency claim is made. Full debt remains a PR/complete workload.

Moving checkpoint itself in process is a pending product cutover: it currently writes a SQLite
practice baseline. This slice preserves that write authority and makes the no-write command
available without introducing an alternate baseline store. Complete debt waits for S3; a
read-only selector adapter waits for S2. The umbrella issue is not complete.

## Validation

Checked on the D1/D2 implementation over the pinned base above, Bun 1.4.3. The final source
was frozen before these runs; subsequent edits only record the contract and evidence.

| Check | Result |
| --- | --- |
| `bun test --timeout 180000 packages/contracts/test/contracts.test.ts packages/core/review-engine packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/architecture-debt.test.ts` | 366 passed, 0 failed, 63.25 s |
| `bun test --timeout 180000 packages/local-runtime/runtime-daemon/test/undeclared-dependencies.test.ts` | 4 passed, 0 failed, 29.35 s |
| `bun test --timeout 180000 packages/surfaces/mcp-local/test/mcp-local.test.ts` | 19 passed, 0 failed, 10.28 s |
| `bun test --timeout 300000 tests/` | 4 passed, 0 failed, 48.29 s |
| `bun run typecheck` | Passed |
| `node scripts/package-boundary-audit.mjs` | Passed, 5 workspaces |
| `node scripts/packaged-cli-smoke.mjs` | Passed, CLI bin points at this worktree |
| `git diff --check` | Passed |

These are 393 focused and acceptance tests, not a claim that the entire repository suite ran.
They cover no-write CLI behavior (worktree byte snapshots, isolated state directory and a runtime
client that throws on access), actual projection/dependency parity, checkpoint baseline and
coalescing, published schemas, deleted/cross-capability citations, ambiguous and unowned paths,
logic-only edits, explicit coverage and typed input failures.

An additional cold-process observation invokes this worktree's Bun CLI three times per repository,
including startup. Each invocation checks five changed TypeScript paths. No rerun was used to
discard the slow first sample:

| Repository subject | Samples (ms) | Median | Coverage / item count |
| --- | --- | ---: | --- |
| arch-context, D1/D2 over `ade6255d13cec021226b3b116cd7624e83fe524b` | 581, 496, 626 | 581 ms | partial / 0 |
| repo-harness, `90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49` | 3,016, 1,745, 1,676 | 1,745 ms | partial / 6 |

Arch-context paths: CLI `main.ts`, runtime `practice-checkpoint.ts`, review-engine
`architecture-debt.ts`, contracts `architecture-debt.ts` and runtime `architecture-debt.ts`.
Repo-harness paths, all under `assets/templates/helpers/`: `acceptance-receipt.ts`,
`capability-config.ts`, `capability-resolver.ts`, `change-assessment.ts`, `check-skill-version.ts`.
Each repository's three results had identical debt digests. These live-workspace observations
are not p95 or worst-case evidence. **The first repo-harness sample exceeds 3,000 ms by 16 ms;
strict cold-start budget acceptance is unresolved.** The narrower workload is justified by the
4,137 ms full probe, but the reduced workload is not advertised as a universal latency guarantee.

The Draft PR intentionally omits `architecture-debt-v1`: blocked on #327 S3 merge for feature
advertisement. After that handoff, append the feature list/fixture/schema entries in the final
commit. Complete actions wait for S3; full read-only selectors wait for S2. No merge, release,
downstream delivery or closure of #328 is implied by these local checks.
