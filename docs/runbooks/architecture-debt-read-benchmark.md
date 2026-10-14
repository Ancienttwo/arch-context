# Architecture debt read benchmark

Owner: issue #328 D5 runtime read composition. This is an operator-run, local fixture
experiment. Its evidence is
[`issue-328-d5-read-snapshot-benchmark.json`](../verification/issue-328-d5-read-snapshot-benchmark.json);
the interpretation and migration audit are in
[`20261014-issue-328-d5-read-snapshot.md`](../researches/20261014-issue-328-d5-read-snapshot.md).

`scripts/architecture-debt-read-benchmark.ts` runs five independent CLI processes for the
edit-time workload and three separate full-debt processes per subject. It accepts an engine
root so the original engine and candidate read the identical frozen fixture. It refuses to
overwrite an existing result file or continue after input-fingerprint, report, coverage,
index-readiness or no-write failure. Keep failures and every first sample.

Prepare the two isolated fixtures at the paths recorded in the script and fixture lock:
repo-harness source `90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49` and arch-context control
`a697adad7bf686f309405d7a9feef8173d8140a5`. Use matching installed dependencies in each
engine and CodeGraph 1.6.1 with complete indexes. The consumer's v2 manifest requires the
supported `docs apply --approved --profile repo-harness/v1` migration in that temporary
fixture. Follow the supported generated-only diagram recreation procedure if ownership
preflight refuses the three old whole-file diagrams. Audit model/source/helper bytes and
all human document regions, retain the complete binary patch and snapshot, and freeze a
new input fingerprint before either phase. Stop on semantic changes or narrowed coverage.
The recorded fixture is **90cd97fb + audited supported v3 migration**.

With the existing audited fixture lock and prepared engines, run from the D5 worktree:

```sh
DO_NOT_TRACK=1 CODEGRAPH_NO_DOWNLOAD=1 bun scripts/architecture-debt-read-benchmark.ts \
  --phase before --engine-root /private/tmp/archcontext-d5-baseline-engine \
  --fixture-lock /tmp/archcontext-d5-fixture-lock.json \
  --output /tmp/archcontext-d5-benchmark-before-migrated.json
DO_NOT_TRACK=1 CODEGRAPH_NO_DOWNLOAD=1 bun scripts/architecture-debt-read-benchmark.ts \
  --phase after --engine-root /private/tmp/worktrees/arch-context-328-d5-read-snapshot \
  --fixture-lock /tmp/archcontext-d5-fixture-lock.json \
  --output /tmp/archcontext-d5-benchmark-after-migrated.json
```

These output names are historical first-run artifacts. Use new output names for another
explicitly labelled experiment; preserve the originals and do not select faster retries.
When preparing different fixture paths, change and freeze the harness and lock before
either phase and record both new hashes. No external services or hosted evidence are used.

The imported `scripts/architecture-debt-benchmark-inputs.ts` owns the fresh recursive byte
witness for the entire fixture and runtime state. It includes Git metadata, ignored and
untracked paths, empty directories, file bytes/modes and symlink targets. Only SQLite
`.codegraph/codegraph.db-shm` lock/read-mark **contents** are excluded; its path/type/mode
are checked. Timestamps are not logical-content evidence. Test this witness and script
ownership with:

```sh
bun test scripts/architecture-debt-benchmark-inputs.test.ts scripts/governance-verify-workflow.test.ts
```

Process startup through exit/output drain is timed. Manager setup, index preparation,
hashing and preflight reads are excluded and can warm the OS file cache. This is a fresh
process experiment with unflushed OS caches. Every final representative edit-time sample
must be strictly below 3,000,000,000 ns; full-debt samples are a separate workload. Report
partial coverage as partial. Call-local discovery reuse does not create an atomic snapshot
or solve edits made during an invocation.
