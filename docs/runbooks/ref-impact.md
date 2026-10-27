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

The CLI reads the existing CodeGraph index through a disposable private snapshot.
It never syncs or opens the original index. CodeGraph's own source enumeration and
readiness checks validate the snapshot. Indexed source hashes must match the
selected immutable Git blobs before declaration ranges are bound to that ref.
Only matching refs receive evidence; historical refs without matching facts stay
unknown. Hunk coordinates come from bounded comparisons of the same raw blobs.

Changed head ranges report the affected flow step. An authoritative zero-match
lookup in an indexed, supported, error-free file reports
`selector-unresolved-at-head`. Ambiguous declarations, missing files and invalid
ranges identify the step with `selector-evidence-unavailable`. Partial positive
findings remain visible while aggregate coverage stays unknown. Deleted base
lines require separately bound base evidence.

The snapshot uses CodeGraph 1.6.2's shipped source scanner, including its include,
includeIgnored and extension settings. The selected source/configuration files,
Git metadata and DB/WAL copy are limited to 512 MiB and 100,000 entries. Unsafe
symlinks in selected inputs, external Git object stores, unsupported path/config
overrides and changing inputs refuse evidence. Impact summarizes these snapshot
refusals as `ref-code-facts-unavailable`; it does not distinguish a missing index
from an unsupported snapshot layout. `flows check --no-sync` exposes the specific
snapshot failure reason. Ordinary ignored dependency trees
are not copied. Private temporary files are removed after reading.

Installed Git filter definitions alone do not prevent a snapshot. Git's effective
attributes are checked across all tracked paths, including embedded repositories;
selected clean/process filters are refused before provider status can run them.
Configured drivers named `unset` or `unspecified` are also refused when their names
make Git's attribute response ambiguous. The provider's name-status diff does not
request patches, so diff/textconv configuration alone does not execute a callback.

Consumers must inspect reason codes, dependency coverage and truncation fields;
unknown or truncated output is not proof that no impact exists. Limits are
included in the response, including a shared line-diff work budget. Oversized or
invalid inputs fail with a structured error rather than fabricated coverage.

No model, ledger, source or Git worktree mutation is performed by this command.
Rollback of this unreleased feature is a revert of its code, schema and docs;
there is no persisted-data migration.
