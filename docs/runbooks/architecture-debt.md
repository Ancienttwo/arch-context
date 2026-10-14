# Architecture debt reads

`archctx debt --changed-path src/pay.ts --json` runs in process. Repeat `--changed-path` for
more paths; omit it to inspect the repository. The reader does not start a daemon, render
documents, sync CodeGraph or write model/runtime state. It requires Git and an adopted model.
Invalid paths and missing authority return typed error envelopes.

The `archcontext.architecture-debt/v1` payload reports measured ownership and human citation
problems, the affected paths/nodes/capabilities, the producer's reason, and an action. Source
byte stamps are not an input. A logic-only edit with no measured problem owes no task.

Ownership uses the existing parent-chain measurement used by dependency and refactor checks.
An unclaimed path is actionable under a declared source root and outside declared excludes.
With no source declarations at all, the existing ownership resolver treats the entire repository
as unowned; adopting a model alone does not establish source ownership.
Files that have been deleted are not new unowned files; citations pointing at them are checked.
Citation checks reuse `docs anchors`, including citations in another capability's document that
refer to a changed file. Model/policy edits inspect repository scope because they can change
obligations outside a source path's current owner.

## Coverage and identity

Always inspect `checks` and `coverage`. An empty `items` array with partial coverage does **not**
prove the absence of dependency, flow or practice debt. The edit-time reader explicitly defers
those checks to completion. Missing symbol evidence remains an anchors coverage
gap. No parser or guessed dependency set replaces unavailable CodeGraph evidence.

`items[].id` binds the problem's subject, independent of absolute worktree path, branch or time.
`digest` binds the whole debt result, including coverage and measured counts. Consumers use
that digest to deduplicate debt notices. Actions name a diagnostic command or the ChangeSet
planning surface; reads never grant permission to apply a suggested model edit.

`checkpoint` and `archcontext_checkpoint` attach the same result as `data.debt`. They retain
their existing daemon-owned practice baseline writes and coalescing. A coalesced practice result
still re-reads citation/ownership debt. The existing checkpoint `resultDigest` describes practice
guidance; `debt.digest` describes architecture debt. An unadopted repository is rejected before
the checkpoint saves a new baseline. This slice does not move checkpoint writes into the CLI.

## Performance and remaining RFC work

The initial read probe on repo-harness took 4,137 ms for ownership, citations, current import
facts and selector proof, exceeding #328's 3,000 ms falsifier. Therefore edit-time reads use only
ownership and citations. The reduced CLI's three cold-process samples on that repository were
3,016 / 1,745 / 1,676 ms: the first still exceeds three seconds. These are workload observations,
not a latency SLA or a strict budget pass.
See `docs/researches/20261013-issue-328-debt-reader.md` for subject and verification limits.

## Completion judgment

`complete` returns repository-wide `data.debt` from the same evaluator. Ownership and anchors
run for an adopted model even without a documentation projection manifest. Dependency/flow
reads reuse S2 readiness, read-only selectors and import queries with downloads disabled; they
never sync the index. Completion itself retains its existing daemon session, code-facts sync,
projection gates and saved review result. Practice evidence comes from the daemon's existing
baseline/enforcement evaluation; a practice regression appears in debt but keeps its single
existing practice finding and its waiver/fail-open behavior.

Every measured debt item that blocks completion contributes a repair action. Missing, stale,
refused, truncated or concurrently changed evidence produces one deduplicated
`architecture-debt-coverage` warning, with the coverage level and reason codes. In particular,
a formerly passing repository with no CodeGraph index now returns `pass_with_warnings`, not
`pass`; gaps do not invent failed proofs or required repair actions. Existing required-code-facts
preconditions still refuse where they did before. `practices:not-enabled` and `model-not-adopted`
are deliberate states, so they remain in coverage without an extra warning. An unadopted model
still fails existing model validation; an adopted but invalid model reports `invalid-schema`
without publishing a clean debt report. A mismatched task HEAD skips debt judgment and names
`architectureDebtChecksSkipped: stale-context` in review extensions.

Projection freshness remains separate, using S3's single evaluator unchanged. A source stamp
alone never creates a debt item, though the existing freshness gate can independently block.
The advertised `architecture-debt-v1` covers the reader, checkpoint attachment and completion
judgment. Renderer/protocol floors remain separate RFC work; this flag does not close #328.
