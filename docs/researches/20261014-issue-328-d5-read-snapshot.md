# Issue #328 D5: call-local architecture debt discovery

The original `readArchitectureDebtEvidence` loaded the native model and Git-visible file
list, then `runDocsAnchorsCommand` loaded both again. The two-file change passes the existing
inputs to the anchor producer for that invocation. Standalone anchors retain their discovery
and error path. There is no cache across calls, scanner/parser change, ownership/citation
rule change or shortcut around the before/after CodeGraph evidence checks. Reusing discovery
is not an atomic snapshot and does not fix concurrent edits during an invocation.

## Functional evidence

On the unchanged producer the discovery guard observed two model loads and two Git
discoveries; after the change it observes one each. A frozen original seven-state oracle
compares the complete report, digest and coverage for missing index, added unowned file,
deleted citation target, ownership model change, citation repair, model prose change and
corrupt/unavailable index. Subsequent edits remain visible and reads preserve fixture bytes.
Existing debt CLI plus the new regression passed 11 tests; real-index/no-index anchors and
the canonical U4 prose scanner passed 21 tests. Exact-HEAD check
`vx-6c016a43436543d184c2` passed at implementation commit
`dabf86ab93cfea3566df0a994754086d5104e4a6` (typecheck, package boundaries and affected suites).
Later benchmark/documentation commits retain these same product-source bytes.

## Frozen experiment and fixture amendment

The coordinator approved five independent edit-time CLI processes per subject/phase and
three separate full-debt processes per subject/phase before timing. The representative
source is repo-harness `90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49`; the five changed paths are:

- `assets/templates/helpers/acceptance-receipt.ts`
- `assets/templates/helpers/capability-config.ts`
- `assets/templates/helpers/capability-resolver.ts`
- `assets/templates/helpers/change-assessment.ts`
- `assets/templates/helpers/check-skill-version.ts`

The original source has a v2 projection manifest and was refused by the existing v3 reader
before any timed process (zero samples). The refusal is preserved. With explicit coordinator
approval, only the isolated temporary fixture was migrated by supported
`docs apply --approved --profile repo-harness/v1`. An initial ambiguous ownership refusal
for three old generated whole-file diagrams is also preserved. Their v2 ownership rows were
audited as generated; the supported generated-only remove/recreate procedure then succeeded.

The resulting identity is **90cd97fb + audited supported v3 migration**, not unmodified
90cd97fb. The complete binary patch changes 44 generated doc/manifest paths; source, model,
helpers, native nodes/relations/flows/profiles/contracts and the human byte complements of
40 mixed documents are unchanged. The migration reports acceptance-review P1 proven and
P2 unprovable with no changed semantic facets; the old v2 proof baseline was null. This
existing unprovable condition is retained. No coverage or manifest floor was weakened.
Measured migration replay took 4276.393959 ms total (apply process 4261.8855 ms), outside
latency samples; its output patch is byte-identical to the first successful migration.

Frozen input fingerprints, over the canonical visible paths and every file's SHA-256:

| Subject | Input fingerprint |
|---|---|
| Migrated representative | `sha256:86304321c404fc321f4fd0c8a86401c917660eab07f19d30a126d32309f8da17` |
| Unmodified arch-context control @a697adad | `sha256:4cf037a4d8ba68867c154b380f218ae95d88710a1821ced5109870bbf34c5aa5` |

Migration patch SHA-256 is
`05b76f8d58ab096ce47c5c5425eb8bb0d2bef60dc9aa06f09d9ebf583c7fc44f`.
The local handoff preserves the complete migrated worktree/index archive (Git metadata and
volatile SHM excluded from the archive), base Git identity, binary patch, migration audit,
cost, refusal and all original raw benchmark JSON/logs. The real consumer and BYOK checkouts
were untouched. Complete CodeGraph 1.6.1 indexes were prepared: representative 1445 files,
32120 nodes, 113395 edges; control 679 files, 19716 nodes, 68590 edges.

## Raw measurements

Before engine: `a697adad7bf686f309405d7a9feef8173d8140a5`.
After engine: `dabf86ab93cfea3566df0a994754086d5104e4a6`.
Both used the exact same frozen migrated fixture, harness and witness hashes. Runtime was
Bun 1.4.3, Node v24.18.0, macOS 26.5 build 25F71, darwin arm64. Every first sample is retained.

| Workload | Before, ms in order | After, ms in order |
|---|---|---|
| Representative edit, N=5 | 2443.1385, 666.072167, 669.114792, 677.669542, 691.211458 | 644.328041, 657.905, 629.909667, 626.057875, 607.513208 |
| Representative full debt, N=3 | 2592.896792, 2494.512792, 2483.884416 | 2400.331541, 2371.452542, 2410.442916 |
| Control edit, N=5 | 230.118708, 196.747291, 195.489375, 203.511916, 192.9835 | 169.040042, 175.156834, 168.141333, 176.549, 175.31 |
| Control full debt, N=3 | 1265.37575, 1246.525791, 1256.087208 | 1199.620584, 1171.868625, 1172.992084 |

All five final representative edit-time values are strictly below 3000 ms. The representative
edit median moved from 677.669542 to 629.909667 ms (7.05%); the larger first-sample difference
is not an isolated causal estimate. The original historical 3016/1745/1676 ms observations
remain historical live-workspace evidence, not this frozen baseline. This experiment does
not establish a universal latency bound or claim that the original v2 fixture was readable.

All 32 samples exited zero, passed the report validator, matched complete preflight reports,
and preserved fixture/runtime logical content. Before/after whole reports, digests and
coverage also compare equal. Coverage remains **partial**; full-debt practice evidence is
not enabled/evaluated. Full debt is a separate workload and does not stand in for edit-time.

Independent direct-spawn processes include Bun/CLI/native loading, Git/CodeGraph child work
and stdout/stderr drain. Manager startup, fixture/index prep, byte hashing, preflight and
manager parsing are excluded. OS caches were **not flushed** and these preparation reads can
warm them. Results therefore describe process-cold runs on this environment with unflushed
file caches. No warmups, sample discards, selective retries or rounded threshold passes.

The no-write witness freshly enumerates all fixture paths, including Git metadata,
ignored/untracked paths and empty directories, and all nested runtime state before/after
each sample. It compares file bytes/modes and symlink targets. Only CodeGraph SQLite SHM
lock/read-mark contents are excluded; its path/type/mode remain checked. Timestamps are
not logical-content evidence. Two tests detect new repository paths/empty directories,
existing nested state changes and new nested state paths. The output resides outside both
roots. This checks final logical content, not a claim to detect transient writes restored
before the witness or concurrent edits.

The machine-readable evidence preserves every elapsed nanosecond and millisecond, exit,
path, input/engine/harness fingerprint, coverage, report digest and raw-record hashes. Equal
reports are stored once with references to avoid duplicating them for each sample:
[`issue-328-d5-read-snapshot-benchmark.json`](../verification/issue-328-d5-read-snapshot-benchmark.json).
Operational ownership and exact commands live in
[`architecture-debt-read-benchmark.md`](../runbooks/architecture-debt-read-benchmark.md),
which fixes the hosted governance failure without changing its assertions or exemptions.
