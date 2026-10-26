# Stateless ref impact (partial delivery)

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

## Flow coverage remains incomplete

The actual CLI has no supported producer of historical CodeGraph facts bound to
the selected commit and tree. Consequently `touchedFlowSteps.status` is `unknown`
and its items are null. Pure-engine tests inject ref-bound facts to exercise
matching; they do not establish real CLI flow-impact support. This change only
partially addresses issue #409, which must remain open.

Consumers must inspect reason codes, dependency coverage and truncation fields;
unknown or truncated output is not proof that no impact exists. Limits are
included in the response, including a shared line-diff work budget. Oversized or
invalid inputs fail with a structured error rather than fabricated coverage.

No model, ledger, source or Git worktree mutation is performed by this command.
Rollback of this unreleased feature is a revert of its code, schema and docs;
there is no persisted-data migration.
