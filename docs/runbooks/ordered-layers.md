# Ordered architecture layers

Node `layer` remains the only layer authority; paths, IDs and parent ancestry do
not assign it. An optional manifest `model.layers` lists layers from top to bottom.
Every declared node layer must occur in that unique, non-empty list. Without the
list, existing exporters retain their previous ordering and output.

Prepare a reviewed manifest ChangeSet with:

```sh
archctx manifest plan --id changeset.layers --layers cli,effects,core
```

This can be combined with `--decisions docs/adr`. The command prepares a change;
the existing preview, expected-hash and approved-apply rules still govern writes.
It does not edit node layers or infer them. Native export includes `model.layers`
only when the manifest declares it. Mermaid and LikeC4 groups use that order;
Structurizr retains deterministic element ordering and uses the same layer
membership for its group declarations.

A constraint with `rule.type: layer-direction` evaluates observed imports against
the manifest order. A lower-to-higher import violates the rule; the reverse and
same-layer imports are allowed. Newly added nodes participate by their declared
layer without listing node IDs in the rule. Violation records include both node
IDs and `fromLayer` / `toLayer`. Missing endpoint ownership or a missing layer on
one end of a layered import yields an undetermined result, not a passing guard.
Unavailable code facts remain undetermined as for existing dependency checks.

Read the evaluated constraints without starting a daemon or writing runtime state:

```sh
archctx constraints check --json
```

This reads the current Git-visible model and the existing CodeGraph index through
the same evaluator used by review. Invalid declarations fail with
`constraint-model-invalid`; missing, stale or incomplete code facts remain
`undetermined`. It never initializes or synchronizes the index. Exit code 0 means
the query succeeded: consumers must inspect `data.status` (`pass`, `violated`,
`undetermined` or `not-applicable`) for the constraint verdict. Unsupported rules
are listed in `data.warnings`.

Other unevaluated constraint types now produce a warning per constraint. A
validated constraint is not proof that its rule has been evaluated. This feature
does not implement cycle detection or infer additional architecture truth.
