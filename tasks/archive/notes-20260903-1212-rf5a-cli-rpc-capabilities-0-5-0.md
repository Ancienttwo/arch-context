> **Archived**: 2026-09-03 12:12
> **Related Plan**: plans/archive/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260903-1212

# Implementation Notes: rf5a-cli-rpc-capabilities-0-5-0

> **Status**: Active
> **Plan**: plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md
> **Contract**: tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md
> **Review**: tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md
> **Last Updated**: 2026-09-03 09:09
> **Lifecycle**: notes

## Design Decisions

- **`createdAt` is the HEAD committer date, not a clock and not epoch-0.** `readHeadCommitterDate`
  (`packages/local-runtime/git-adapter/src/index.ts`) parses `git show -s --format=%cI HEAD` and
  fails closed on an unborn or unreadable HEAD. Both `snapshot.createdAt` and
  `assessment.createdAt` take it, so two scans at the same HEAD are byte-identical while still
  dating the measurement to the commit it measured. `requestId` is `refactor_request.<16 hex of
  digestJson(request)>`, so identity comes from the request payload alone.
- **One `trackedFiles` read feeds both consumers.** `runRefactorScan` calls
  `readTrackedSourceFiles(root)` once and hands the same array to `buildModuleStatisticsSnapshot`
  and (as `.map(f => f.path)`) to `assessRefactor`. `refactor-scan.test.ts` proves the binding with
  a single-variable control: a proposal naming a tracked, declared file resolves to its owner node;
  the same proposal naming an uncommitted path resolves to none and reports `unowned-paths`.
- **`proposedRecommendations` is a preview, planned under the same HEAD date.** The daemon replays
  the ledger read-only, passes the latest recommendations into `planRefactorRecommendationRun` with
  `now = createdAt`, and returns `plan.recommendations` plus `plan.suppressed`. Nothing is appended;
  `refactor record` re-plans under the daemon clock and is the only writer.
- **CodeGraph attestation is observed, never asserted.** `codeFacts.version` and
  `codeFacts.binaryDigest` come from running the resolved CLI's `--version` and hashing the resolved
  binary, and only when `.codegraph` exists. With no index nothing observed this tree, so both are
  empty strings and the snapshot builder independently degrades coverage to `unknown`. The pinned
  `REQUIRED_CODEGRAPH_VERSION` is a requirement, not evidence, so it is not reported as one.
- **No MCP tool.** `refactor` is a CLI verb over `refactorScan` / `refactorRecord` only, per the PRD
  non-goals. `refactorScan` is registered in `RUNTIME_RPC_LONG_METHODS`.

## Deviations From Plan Or Spec

- **`bun.lock` was not modified.** Bun `1.4.0` does not rewrite the workspace `version` metadata
  when only a version changes; `bun install`, `bun install --force`, and `bun install
  --frozen-lockfile` all report "no changes" and leave the file byte-identical. Repo history agrees:
  `bun.lock` was last touched at `21f3bab`, and the `0.4.5`-`0.4.8` bumps never updated it. The
  brief expected a version-line-only diff here; there is none to make.
- **`docs/verification/practice-assets-s6-catalog-readback.json` was left at HEAD.** The brief named
  `bun run record:s6:catalog`, which rewrites that evidence file. The file is outside the contract's
  `allowed_paths` and was already stale on `main` (it recorded `catalogDigest sha256:a80c8...` while
  `catalog.yaml` carried `sha256:1fc4f...`), so regenerating it would have been an unrelated,
  out-of-scope repair. `catalog.yaml` was instead regenerated through the repo's own loader
  (`loadPracticeCatalog(...).manifest`, serialized exactly as the file is stored — only the
  `catalogDigest` line moved) and proved by `practice-catalog.test.ts`; `bun run
  readback:s6:catalog` still closes with `failures: []`.
- **`packaged-cli-smoke.mjs` needed two fixes beyond adding the scan step.** (1) `git init` rebinds
  `storageRepositoryId`, so the daemon started under the pre-Git identity must be stopped *before*
  the commit and the post-commit runtime paths re-read, otherwise the final `daemon stop` addresses
  a different connection file and leaks a live daemon. (2) The two MCP-planned node bodies wrote
  `responsibilities:` items at column 0, which the repo's YAML reader rejects as
  `unexpected trailing YAML`; nothing in the smoke loaded the native model before `refactor scan`,
  so the malformed fixture had never been exercised. Both list items are now indented, matching
  every committed node file.
- **`refactor scan` tolerates a repository with no root `package.json`.** `readWorkspacePackages`
  throws `ENOENT` without one, and the smoke repo (like any non-JS repository) has none. The scan
  reads workspace manifests only when a root manifest exists; a repository that declares no
  workspaces has no `exports` map to resolve bare specifiers through, and such specifiers stay
  counted as unresolved. The git-adapter itself is unchanged apart from `readHeadCommitterDate`.
- **`docs/spec.md` and the install runbook were not string-replaced.** Both asserted `0.4.8` is
  *published*; `0.5.0` is not. Their `Release State` / scope wording now names `0.5.0` as the
  current, unpublished release identity and keeps `0.4.8` as the last published pair.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Epoch-0 `createdAt` (the `projection run` precedent) vs HEAD committer date | HEAD committer date | Both are deterministic; only one is true about which commit was measured. |
| `proposedRecommendations` from an empty previous set vs the real ledger | Real ledger | A preview that ignores what is already open would advertise recommendations `record` immediately suppresses. |
| Report `REQUIRED_CODEGRAPH_VERSION` vs probe the binary | Probe | `repositoryImportPairs` never checks the version, so the pin would be an unverified claim inside signed evidence. |
| `git init` first in the smoke vs after the last `apply` | After, with an explicit daemon stop and paths re-read | Committing first would change every earlier worktree-digest assertion; the identity rebind is handled explicitly instead. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Determinism: two `refactor scan --json` runs at `b0da678` both hash to
  `ccf7c0ecaf8d177f15314123b2198d2f329de35f35dcdea072710ea1d254eba3`.
- Suites: `refactor-scan.test.ts` 9 pass; `cli.test.ts` 64 pass; `refactor-recording.test.ts` 17
  pass; `contracts.test.ts` 179 pass; `practice-catalog.test.ts` 10 pass.
- `node scripts/packaged-cli-smoke.mjs` OK (~7.7 s, inside the 30 s per-process budget).
- Docs projection regenerated once as `changeset.docs-rf5a-1`; only
  `docs/architecture/.projection-manifest.json` moved, `docs drift --json` reports `ok: true`.

## Acceptance Round 2 — Gate Findings P1/P2/P3

### P1 — scan published a stale worktree identity (blocking)

`refactorScan` took its identity from `architectureLedgerScope`, which is
`resolveArchitectureLedgerScope(gitScope)` and returns the LAST STORED EVENT's `worktree`
(`local-store-sqlite/src/index.ts:2619-2638`). In any repository that already had a ledger event,
`scan --json` therefore published a frozen `worktreeDigest` while `refactorRecord` validates
`expectedWorktreeDigest` against the live `computeWorktreeDigest`, so `scan` → `record` could
never succeed: `AC_REFACTOR_STALE "Worktree digest changed before refactor record"`.

Fix keeps the two scopes separate instead of collapsing them:

- `runtime-daemon/src/index.ts` `refactorScan` now resolves `gitScope`
  (`architectureLedgerGitScope`, the same authority `refactorRecord` validates against) and
  publishes it as the envelope `repository`/`worktree`, feeds it to `runRefactorScan`, registers
  it, and builds `recordCommand` from it. `storageScope` (`resolveArchitectureLedgerScope`) is
  kept for the replay only, because `architectureLedgerWorkspaceKey` hashes
  `headSha`+`worktreeDigest`, so a replay under the live identity would find no prior events.
- `refactorRecord` now compares `registered.headSha`/`worktreeDigest` against `gitScope`, the same
  live authority `assertFreshWorktree` already used. This binds registered ↔ live ↔ expected
  instead of registered ↔ last-stored-event. The freshness check is unchanged and not weakened.
  The appended event still carries `storageScope`, so the ledger chain stays one continuous log.

Nothing under `local-store-sqlite` changed. The scan's own `expectedWorktreeDigest` staleness
mapping (`assertRequestedStateIsCurrent` in `refactor-scan.ts`) now compares against that same live
digest, so `AC_REFACTOR_STALE` there means what it says.

Regression guard: `refactor-scan.test.ts` "publishes the live worktree identity, so scan then
record works over an existing ledger". It seeds a real ledger event through `refactorScan` →
`refactorRecord`, then adds and commits `src/extra.ts` so the live tree moves away from that
event's identity.

Pre-fix (daemon reverted to the `architectureLedgerScope` identity, test unchanged):

```
 9 pass
 1 fail
(fail) daemon refactorScan > publishes the live worktree identity, so scan then record works over an existing ledger
  expect(scan.worktree.worktreeDigest).toBe(liveDigest)
  Expected: "sha256:f10cf60c932e15a535632e5c229de2b8d495430b6fb8906ca3d1164d9dd3dd2b"
  Received: "sha256:4448f7fdf26b4dc0858f8763ebb7a708d0267a25573338e8ed7ed148ea96e417"
```

Post-fix:

```
 10 pass
 0 fail
 53 expect() calls
```

`scripts/packaged-cli-smoke.mjs` now runs `refactor record --assessment-digest <scan> \
--expected-worktree-digest <scan> --json` right after the scan step and asserts `ok === true` plus
`assessmentDigest` parity. Smoke still ends `[packaged-cli-smoke] OK`; no timeout was raised.

Manual readback in this worktree at `b0da678`:

| envelope | ok | code | warnings | suppressed |
| --- | --- | --- | --- | --- |
| `refactor scan --json` | true | none | none | — |
| `refactor record` (1st) | true | none | none | `duplicate-active-fingerprint` x2 |
| `refactor record` (2nd) | true | none | none | `duplicate-active-fingerprint` x2 |

Both records are `duplicate-active-fingerprint` because this repository's ledger already carries
those fingerprints open from earlier RF3 runs; the point of the readback is that neither is
`AC_REFACTOR_STALE` any more. Two consecutive `refactor scan --json` runs are `cmp`-identical.

### P2 — `bun.lock` still pinned 0.4.8

`bun install --lockfile-only` on bun 1.4.0 reported `no changes` and left the file untouched, so
the five workspace `"version"` fields were set to `0.5.0` by hand (`bun.lock:20,29,33,42,51`).
`bun install --frozen-lockfile` exits `0`, `grep -c '0.4.8' bun.lock` is `0`, and
`git diff --stat -- bun.lock` is `5 insertions(+), 5 deletions(-)` — no other line moved.

### P3 — runbook pinned an unpublished version

`docs/runbooks/personal-user-install.md:32` claimed `npm install -g archctx@0.5.0` as the pinned
reproduction of the current verified release. It is back to `archctx@0.4.8`, with `0.5.0` described
as prepared but unpublished and gated on `deploy/release-checklists/archctx-0.5.0.md`, mirroring
`docs/spec.md` `## Release State`. Nothing in the runbook claims `0.5.0` is published.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.

## Gate residual (2026-09-03, orchestrator)

- `refactor record` ok-envelope reports `worktree.worktreeDigest` from the storage scope (last stored event) while the feeding `refactor scan` envelope reports the live git-scope digest. Same shape as the pre-existing `recommendations` append; not new drift. Follow-up: make the record envelope echo the live identity it validated against (RF5b or 0.6.0), so a caller diffing scan/record envelopes sees one identity.

## Codex review fixes (2026-09-03)

Four review findings on the committed slice, fixed in the working tree.

**F1 — TOCTOU between identity capture and use.** `refactorScan` captured `gitScope` and then read
the model, HEAD blobs, workspace manifests and CodeGraph pairs; anything committed in that window
was measured under an identity the tree no longer had, and `refactorRecord` accepted it. The scan
now re-reads the live identity through the same `architectureLedgerGitScope` after the assessment
is built and returns `AC_REFACTOR_STALE` naming the moved field (`headSha`, `worktreeDigest`)
without registering anything; the record repeats the comparison against the registered identity
immediately before the append, inside the existing writer boundary. No third digest variant, and
`assertFreshWorktree` is unchanged.

Deferred to 0.6.0 (unchanged here): the appended event and its replay still key off the storage
scope, so the ledger partition key stays coupled to the event identity.

**F2 — RPC params were only cast.** `decodeRuntimeRefactorScanInput` / `decodeRuntimeRefactorRecordInput`
mirror `decodeRuntimeApplyUpdateInput`: the input must be a plain object, only an absent `request`
selects the default repository scan, and `assessmentDigest` / `expectedWorktreeDigest` must be
non-empty strings with `selection` an array of non-empty strings. `refactorRecord(null)` used to
throw a `TypeError` the transport reported as HTTP 500; it is now `AC_SCHEMA_INVALID`.

**F3 — CLI value flags.** `refactor scan|record` read every value flag through `refactorFlagValue`,
which rejects a missing value or a next token starting with `--` and names the flag, so a bare
trailing `--request-json` no longer silently runs the default scan. `--selection` is repeatable and
comma-separated (the `--major-reason` convention) and reaches `refactorRecord` in the order it was
typed, unsorted and un-deduplicated. `RuntimeRefactorRecordInput.selection` is validated and carried
only; selective recording itself stays RF5b's.

**F4 — tests.** `refactor-scan.test.ts` asserts the scan envelope's `headSha`/`worktreeDigest` are
read back from git at scan time, and adds a scan and a record that move the tree from inside the
daemon's own call graph (a `TestLocalStore` subclass whose ledger replay commits once), which is the
only honest way to enter both windows. Reverting just the two identity re-reads makes both fail:
the scan returns `ok: true` with a mixed-state envelope, and the record appends a second event whose
`worktree.headSha` is the commit the tree has already left. Dispatch-boundary coverage goes through
`ArchctxRuntimeRpcServer` + `RuntimeRpcClient`. `cli.test.ts` covers bare `--request-json`,
`--assessment-digest` with no value, and `--selection` passthrough.

## Codex review fixes (2026-09-03)

Plan decision (d)'s `--selection` passthrough is dropped. Nothing consumed it: neither
`refactor-recording.ts` nor the recommendation engine read the field, so a caller who passed a
subset still got every planned recommendation recorded — a silent semantic lie.
`decodeRuntimeRefactorRecordInput` now rejects `selection` whenever it is present (any value,
including `[]`) as `AC_SCHEMA_INVALID`, the field is off `RuntimeRefactorRecordInput`, and the CLI
no longer has a `--selection` flag. Selective recording is a later slice, not this one.

`class RefactorFlagError` and the `refactorFlagValue*` helpers sat below the `if (import.meta.main)`
entrypoint, which runs during module evaluation and suspends on top-level await, so a real spawned
run hit the class in its temporal dead zone and returned `AC_RUNTIME_UNAVAILABLE` ("Cannot access
'RefactorFlagError' before initialization") instead of the `AC_SCHEMA_INVALID` naming the flag.
They now sit above the entrypoint next to `RuntimeVersionUnsupportedError`; no behaviour change.
Imported-`runCli` tests can never see this (`import.meta.main` is false), so the guard is a spawned
assertion: `scripts/packaged-cli-smoke.mjs` and a new `cli.test.ts` case both run
`refactor record --assessment-digest --json` and require `AC_SCHEMA_INVALID` naming the flag.
