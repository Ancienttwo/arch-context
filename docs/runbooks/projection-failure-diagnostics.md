# Projection failure diagnostics

`projection publish` retains registered producer failure details in the outer
error, `data.error`, persisted writer `lastRun.error` and `publish-status`.
Persisted details are revalidated against the same registered failure contract;
unknown or malformed metadata makes status fail closed as invalid writer state.

Unclassified exceptions include their owning stage and a closed built-in
`errorClass` family. A custom subclass is reported by its built-in family, never
its arbitrary name. Names, messages, stacks, source bodies and process output are
not copied into these metadata fields. Non-error throws are labelled `NonError`;
an unavailable exception does not acquire an invented class.

This does not establish why stopping old daemons made an earlier publish work.
Deleted-worktree readiness classification remains a separate #415 requirement;
health and authenticated shutdown behavior are unchanged by this diagnostic fix.
