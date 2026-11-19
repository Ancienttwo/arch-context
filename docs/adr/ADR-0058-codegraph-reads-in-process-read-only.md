---
schemaVersion: archcontext.adr/v1
id: adr.0058.codegraph-reads-in-process-read-only
title: CodeGraph Code Facts Are Read Only Through the In-Process Read-Only Handle
status: accepted
decidedAt: 2026-11-13
appliesTo:
  - module.architecture-context.local-runtime
  - component.architecture-context.local-runtime.runtime-daemon
  - module.architecture-context.contracts
  - component.architecture-context.surfaces.cli
supersedes: []
---

# ADR-0058: CodeGraph Code Facts Are Read Only Through the In-Process Read-Only Handle

> **Status**: Accepted by the owner on [#586](https://github.com/Ancienttwo/arch-context/pull/586) on 2026-11-13 (decision https://github.com/Ancienttwo/arch-context/pull/586#issuecomment-6846913570), for [#574](https://github.com/Ancienttwo/arch-context/issues/574).
> **Amends**:
> - [ADR-0002](ADR-0002-codegraph-required-code-facts-engine.md), Decision and Consequences: how runtime code reaches CodeGraph for reads, and which provider modules may be called beside the public SDK (Decisions 1 and 7 below). The ADR-0002 rule "No direct reads of CodeGraph internal SQLite or file layout" stays in force for the database.
> - [ADR-0054](ADR-0054-state-machine-model-kind.md) §7 and §8: the sentences saying that the checkpoint readiness gate "runs `codegraph --version` and `codegraph status`", and that §8 counts those commands in the edit-time read. The gate reads compatibility from the read-only handle instead (Consequences below).
> **Amended**: by the owner on [#608](https://github.com/Ancienttwo/arch-context/issues/608) on 2026-11-19 (decisions https://github.com/Ancienttwo/arch-context/issues/608#issuecomment-6987726659 and https://github.com/Ancienttwo/arch-context/issues/608#issuecomment-6998189310; design notes [v1](https://github.com/Ancienttwo/arch-context/issues/608#issuecomment-6998412156) and [v2](https://github.com/Ancienttwo/arch-context/issues/608#issuecomment-6998747526), requirements [R1–R4](https://github.com/Ancienttwo/arch-context/issues/608#issuecomment-6998819082)): Decision 10, a narrow exception to Decisions 1, 7 and 8 and to the ADR-0002 database rule, for the shared base index.
> **Evidence**: the #574 design pass and its joint review, https://github.com/Ancienttwo/arch-context/issues/574#issuecomment-6842558111. These were measured on main f381b510 against a prototype: identical output from `checkpoint`, `constraints check` and `complete`; no `git status` or `git diff` on any read; wall time down 27–60 %.

## Context

archctx reads CodeGraph facts in three ways.

1. **The CodeGraph CLI**: `query`, `explore`, `impact`, `node`, `status -j` and `--version`. Every CLI read opens the live index writable (`CodeGraph.open`), and that open runs migrations and repairs. `status` and `sync` also run `git status` in the checkout. Without `GIT_OPTIONAL_LOCKS=0`, `git status` rewrites `.git/index` (#544, #547). The CLI provider also parses `explore` and `node` markdown with regular expressions.
2. **A private snapshot** (`withExistingCodeGraphSnapshot`). It copies the sources, the Git metadata and the database. It refuses Git clean and process filters, pins an empty `core.hooksPath`, and runs the SDK in a Node child taken from the provider's platform bundle. It exists so that the provider's `git status` and its writable opens never touch the original checkout. One read costs 3.25–3.98 s (#539).
3. **The in-process SDK handle**, already used by docs anchors, state-machine anchors and selector evidence. The selector-evidence open is writable unless the caller passes `readOnly`.

A read-only `CodeGraph.openSync(root, { readOnly: true })` behaves differently:

- It skips migrations, repair and WAL maintenance (CodeGraph 1.6.2 `db/index.js`, "A concurrent reader must leave migrations … to the writer").
- It runs no git, and it leaves the database bytes unchanged.
- It returns the same import population as `codegraph query -k import`. The sets are identical: 2787 nodes in arch-context and 6420 in repo-harness.

Every `status -j` compatibility fact has an SDK method. The one exception is the pending-changes count: the SDK's `getChangedFiles()` runs `git status`. Its verdict is a content-hash comparison, though, and Git only supplies the candidate files.

Measured on main against a prototype that reads in-process:

| Command | arch-context | repo-harness |
|---|---|---|
| `complete` | 7.80 → 3.09 s | 10.29 → 5.64 s |
| `checkpoint` | 0.93 → 0.40 s | 1.56 → 1.11 s |
| `constraints check` | 1.11 → 0.59 s | 1.32 → 0.96 s |

## Decision

1. **One read path.** Runtime code reads CodeGraph facts only through `CodeGraph.openSync(root, { readOnly: true })`. Facts are nodes, edges, files, index build information and statistics. The handle is opened in the process that runs archctx and closed when each operation ends; it is never held across daemon requests. No read starts the CodeGraph CLI, copies the index, or opens it writable. There is no fallback to the CLI read path.
2. **Building stays with CodeGraph.** `codegraph init` and `codegraph sync` remain CLI invocations in the `codeGraphChildEnv` environment (`GIT_OPTIONAL_LOCKS=0`). They are the only CodeGraph processes archctx starts.
3. **The git commands a read may run.** A read runs only these git commands: `ls-files`, `rev-parse`, `check-ignore` and `config --get core.excludesFile`. They come from archctx's own Git-visible file list and from the provider's file enumeration, and none of them reads file content through a filter or writes the index. A read never runs `git status`, `git diff` or any other git command. The snapshot's hooks-path pin and filter refusal are therefore no longer required, and the private snapshot is removed.
4. **What a read may write.** A read writes nothing to source files, to Git state, or to the contents of the CodeGraph database. For a read-only open, SQLite may create the `codegraph.db-wal` and `codegraph.db-shm` sidecar files in `.codegraph/`. The pinned provider's `validateDirectory` also rewrites `.codegraph/.gitignore` to its default when the file is missing or unreadable, or holds a stale CodeGraph-generated default; a user-authored file is left untouched. This applies even during `CodeGraph.openSync(root, { readOnly: true })`. These are the two permitted side effects, replacing the snapshot's zero-write promise. The second is recorded by the [S6b owner decision](https://github.com/Ancienttwo/arch-context/issues/574#issuecomment-6872810639), following the [provider-behavior finding](https://github.com/Ancienttwo/arch-context/issues/574#issuecomment-6858646203); upstream follow-up is [colbymchenry/codegraph#3287](https://github.com/colbymchenry/codegraph/issues/3287).
5. **Readiness.**
   - *Compatibility* comes from the handle: an index exists and opens; the loaded bundle version and the version that built the index both equal `REQUIRED_CODEGRAPH_VERSION`; the index state is `complete`; the extraction version is current; no references are pending.
   - *Freshness* is CodeGraph's own change test. Each indexed file's content hash is compared under the provider's size limit and stamp rule, and the provider's file enumeration finds added files.
   - archctx never re-derives a code fact, a file population or a hash rule with its own parser or regex.
6. **Version authority.** `REQUIRED_CODEGRAPH_VERSION` is the only pin. The version that answers is the manifest of the platform bundle this process loaded, which is the same bundle that provides the CLI that builds the index.
7. **Provider-internal modules.** Freshness calls these modules of the pinned provider version:
   - `extraction/index.js`: `scanDirectory`, `hashContent`
   - `file-limits.js`: `readBoundedSourceSync`, `oversizeStamp`
   - `extraction/extraction-version.js`: `EXTRACTION_VERSION`

   A contract test pins these module paths and export names, so a provider version bump fails at test time and never at runtime. If colbymchenry/codegraph ships a public, git-free change API (requested in [colbymchenry/codegraph#3287](https://github.com/colbymchenry/codegraph/issues/3287)), it replaces these internal calls. Reading the SQLite file or its tables directly remains forbidden (ADR-0002).
8. **Runtime.** Node is the supported runtime for code-facts reads; it is the packaged runtime, with engines ≥22.22. If the read-only open fails, the read fails closed with `index-open-failed`. One known case is Bun on macOS, which uses the system SQLite and cannot open the index read-only before the WAL sidecar files exist. A read never retries with a writable handle or a child process. Before the first implementation slice merges, CI runs the real-index suite under Node on macOS, Linux and Windows.
9. **Failure vocabulary.**
   - `AC_CODE_FACTS_UNAVAILABLE` with `index-missing`, or with `index-open-failed` (a new, additive failure reason).
   - `AC_CODE_FACTS_NOT_READY` with `code-facts-not-ready` for an incompatible index.
   - `pending-source-changes`, `code-facts-read-not-ready` and `index-stale` for an index behind the worktree.
   - The failure reasons `code-facts-snapshot-changed`, `code-facts-snapshot-limit-exceeded` and `code-facts-snapshot-layout-unsupported` are removed in the release that removes the snapshot (0.15.0). The release notes list this as a contracts break, and no unreachable entry is kept.

10. **Base index (#608).** A worktree with no index may start from a private, checked copy of the repository's base index. This is the only exception to Decisions 1, 7 and 8 and to the ADR-0002 database rule.
    - **The one direct open.** Only the base-refresh writer path opens `.codegraph/codegraph.db` as an opaque SQLite file. It runs in the primary checkout after a successful `codegraph sync`, opens the file on a read-only handle, and only runs `VACUUM INTO` to a new snapshot file. It reads no table and writes no row. It runs in the pinned platform bundle's `node` executable, because the macOS system SQLite of a Bun process cannot open the file read-only before the sidecars exist (Decision 8). That child is not a CodeGraph process. Every other direct read of the database stays forbidden.
    - **Consistency.** The snapshot is published only when no provider build held the writer lock and the read session's index revision and `HEAD` are unchanged after the copy, which is the design G4 rule. Otherwise it is discarded.
    - **Location.** `<git-common-dir>/archcontext/codegraph/<REQUIRED_CODEGRAPH_VERSION>/` holds immutable `base-<uuid>.db` snapshots, `current.json` (written to a temp file, then renamed) and `refresh.lock`. Unreferenced `base-*.db` files older than ten minutes in its own version directory are reported for hand cleanup; archctx deletes none.
    - **archctx removes only what it created in the same run.** A path's creation identity is its device, inode and birth time. Birth time, not ctime: the staged sync's writes and the install's hard link change ctime but not the file. A file system without birth times gives no identity, so nothing is removed there.
      - A run removes its own staging entries, its unpublished snapshot, its pointer temp file and its own `refresh.lock` only while each still has the identity held in memory since the run created it. The sidecars and lock that the provider children create in the run's fresh staging folder are recorded in memory right after each child exits.
      - `current.json` is the one path replaced across runs. Each publish creates an empty, exclusive `records/current.json@<identity>` that is never deleted, so one accumulates per publish. A `current.json` without a matching record is not replaced, and the refresh is `skipped-unproven`.
      - archctx never removes the folder of a crashed seed, an old unreferenced snapshot or a stale `refresh.lock`; a stale lock makes the refresh `skipped-unproven`. Each such path, and anything a run kept, is listed in the sync result's `codeGraphKept` with a hand-cleanup hint.
    - **The seed.** Only when `<root>/.codegraph/codegraph.db` does not exist. The live path holds nothing or a full index the checks proved, and an existing database is never opened, moved or removed by the seed. In order:
      1. A copy of the published snapshot goes into a private staging folder `<root>/.codegraph-seed-<pid>-<uuid>/`, whose first file is a `.gitignore` holding `*`. CodeGraph skips every `.codegraph-*` folder.
      2. The pinned bundle's own `codegraph sync` runs on it with `CODEGRAPH_DIR` set in that child only. `CODEGRAPH_DIR` is read from the pinned provider's source, not a documented contract, so the seed is off on Windows, with `CODEGRAPH_DIR` set in archctx's own environment, for a caller-named binary, and for any CLI or platform bundle that is not exactly `REQUIRED_CODEGRAPH_VERSION`. A pre-flight in the same bundle must resolve the plain target to `<root>/.codegraph` (not `.codegraph-wsl`) and the staged one to the staging folder.
      3. The staged sync must exit 0, change the copy, and leave no lock and no non-empty WAL. Then a read-only open of the staged copy, in the bundle's `node` with `CODEGRAPH_DIR` in that child only, must show the provider and extraction versions, a complete and non-stale index, and full-hash freshness against the worktree. The provider's sync skips a same-size edit with an unchanged mtime, so a successful sync alone proves no freshness. This child is the second exception to Decision 8's no-child rule: it is not a retry, and it reads only the staging copy.
      4. The destination must be absent, or a real directory whose only entry is a regular `.gitignore` that the pinned provider keeps (its `isStaleDefaultGitignore`, leading whitespace and byte-order mark included). `.gitignore` is created exclusively when absent. Every database and sidecar path must be untracked and ignored (`git ls-files`, `git check-ignore`). Then `codegraph.db` alone is hard-linked without overwriting; a concurrent install or `codegraph init` wins.
      5. The run's staging folder is removed only when the folder and every entry in it still have the identities this run recorded, without recursion; otherwise all of it stays and is reported. A seed attempt reports folders whose owner pid is dead and whose provider lock names no live process, and never removes them.

      Any unproven condition declines the seed and leaves the worktree as it would be without one.
    - **Reads bind to their worktree.** The adapter keeps each worktree's verified index with the identity (`dev:ino:ctimeNs`) of the database the SDK resolves for it. A read names its worktree, is refused when that worktree has no verified index, and is refused when the opened database is no longer the verified file. A readiness check on a read path never starts a writable sync: an index it has not seen, and a changed identity, are verified read-only. Only a command that owns a sync (`prepare`, and the commands that call `sync`) syncs a worktree the adapter has not verified. A database whose identity archctx cannot verify, for example one the SDK resolves outside `<root>/.codegraph`, is never served, after a sync or after an earlier success: the entry is dropped and the call refuses as retryable not-ready.
    - **The refresh reads the verified file.** The refresh snapshots `<root>/.codegraph/codegraph.db` only when the SDK resolves that same file, with the same identity before and after the copy; otherwise it is `skipped-unverifiable` or `skipped-moved`.
    - **Who may seed or refresh.** Only commands that run `codegraph sync` themselves seed. A read never seeds and never refreshes. Only the primary checkout refreshes. A linked `.codegraph` stays refused with `index-open-failed`.
    - **Facts.** Facts are still read only through the read-only handle (Decision 1).
    - **Failure vocabulary.** `AC_CODE_FACTS_UNAVAILABLE` gains the additive, retryable reason `index-base-building`: no base is published yet and a refresh is running.

## Implementation

The slices run serially, because each one writes `codegraph-adapter/src/index.ts`:

1. This ADR.
2. S1, High: the read session and readiness.
3. S2+S3, one slice, High: the import population and its dependency consumers, plus the projection handshake.
4. S4, High: remove the private snapshot.
5. S5, Medium: SDK-backed `buildTaskContext`, `findSymbols` and impact.
6. S6, Medium: cleanup, runbooks, and the provider-module contract test.

Nothing from #574 is released in 0.14.x.

## Consequences

- **What each command starts.** `checkpoint` no longer starts CodeGraph. `constraints check` and the dependency readers start no CodeGraph process. `complete` starts CodeGraph only for its `sync` runs.
- **ADR-0054 §7 and §8.** The checkpoint readiness gate reads compatibility from the read-only handle. It no longer runs `codegraph --version` or `codegraph status`, and it adds no CodeGraph command to the edit-time read.
- **Repositories the snapshot refused.** A repository with a Git clean or process filter, `include`/`includeIf`, `core.fsmonitor` or symlinked sources now gets code facts from `flows check --no-sync` and `impact`, instead of `code-facts-snapshot-layout-unsupported`.
- **Sidecar files.** After any archctx read, `.codegraph/` can hold the WAL and SHM sidecar files until the next CodeGraph writer closes the database.
- **No migrations.** The selector-evidence open becomes read-only on every path, so archctx never migrates or repairs the index. An index that would need a migration is reported as a version mismatch or `index-open-failed`.
- **One listed output change.** `buildTaskContext` takes its files from `findRelevantContext` and its query nodes from `searchNodes`, instead of the `explore` markdown. Its output changes once. That output is not on any timed path.
- **Contracts break in 0.15.0.** The three `code-facts-snapshot-*` failure reasons are removed. `index-open-failed` is added.
- **Bun dev and test runtime on macOS.** Reads need existing sidecar files, for example from a Node holder process. Tests keep the Node holder, and the real-index suite also runs under Node.
- **Scaling risks.** Freshness is linear in indexed bytes: 70–175 ms on repo-harness today. The import read stays capped at `CODEGRAPH_IMPORT_NODE_READ_LIMIT`, and at about 8× repo-harness that cap is reached first. Both are tracked as follow-ups outside #574.

## Rollback

Revert the slice pull requests. No data or ledger migration exists. The sidecar files are managed by SQLite and need no cleanup.

For Decision 10, revert its pull request. A worktree seeded before the revert keeps an ordinary index of its own. The base directory under `<git-common-dir>/archcontext/codegraph/` is then inert, and an operator may delete it. A `.codegraph-seed-*` folder left by a crash ignores itself, CodeGraph skips it, and it may be deleted by hand.
