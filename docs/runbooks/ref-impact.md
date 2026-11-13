# Stateless ref impact

```sh
archctx impact --base main --head HEAD --depth 1 --json
archctx impact --paths-from changed-paths.txt --depth 1 --json
```

Ref mode reads immutable Git objects without checkout or daemon startup. It maps
changed paths to base and head ownership, preserves ambiguous owners, follows
dependents in the head model and reports model additions, removals and changed
fields. Renames are represented as a deletion plus an addition. Line counts use
raw blobs, independent of current worktree attributes; binary or budget-limited
counts remain unknown. Depth is bounded to 0 through 10.

Paths mode accepts newline-separated repository-relative paths from a file or
stdin (`--paths-from -`). It uses the stable current worktree model; line counts
and model delta remain unknown. Paths mode cannot be combined with ref flags.
LF and CRLF delimit records. Empty records are ignored; leading and trailing
whitespace belongs to the path and is preserved, including whitespace-only paths.

## Ref-bound flow evidence

The CLI reads the repository's existing CodeGraph index in-process through one
read-only handle (ADR-0058). It never syncs the index, opens it writable or copies
it, and it starts no CodeGraph process. The index must be ready first: compatible
with the pinned CodeGraph, and current with the worktree by CodeGraph's own change
test. Indexed source hashes must then match the selected immutable Git blobs before
declaration ranges are bound to that ref. Only matching refs receive evidence;
historical refs without matching facts stay unknown. Hunk coordinates come from
bounded comparisons of the same raw blobs.

Changed head ranges report the affected flow step. An authoritative zero-match
lookup in an indexed, supported, error-free file reports
`selector-unresolved-at-head`. Ambiguous declarations, missing files and invalid
ranges identify the step with `selector-evidence-unavailable`. Partial positive
findings remain visible while aggregate coverage stays unknown. Deleted base
lines require separately bound base evidence.

The source population is CodeGraph 1.6.2's own file enumeration, including its
include, includeIgnored and extension settings. Impact summarizes every code-facts
refusal as `ref-code-facts-unavailable`: a missing index, an index that cannot be
opened, an index behind the worktree and an index that moved during the read.
`flows check --no-sync` reads the same way and exposes the specific reason:
`index-missing`, `index-open-failed` or `code-facts-read-not-ready`.

The read runs only the git commands ADR-0058 allows: `ls-files`, `rev-parse`,
`check-ignore` and `config --get core.excludesFile`, plus the `rev-parse`,
`ls-tree`, `cat-file` and `log` reads of the immutable refs. It never runs `git
status` or `git diff`, so configured clean/process filters, `core.fsmonitor` and
index hooks are not executed, and a repository that uses them still gets evidence.
SQLite may leave the `codegraph.db-wal` and `codegraph.db-shm` sidecar files in
`.codegraph/`; nothing else is written.

Consumers must inspect reason codes, dependency coverage and truncation fields;
unknown or truncated output is not proof that no impact exists. Limits are
included in the response, including a shared line-diff work budget. Oversized or
invalid inputs fail with a structured error rather than fabricated coverage.

No model, ledger, source or Git worktree mutation is performed by this command.
Rollback of this unreleased feature is a revert of its code, schema and docs;
there is no persisted-data migration.
