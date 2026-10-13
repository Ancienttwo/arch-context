# Architecture debt reads

`archctx debt --changed-path src/pay.ts --json` runs in process. Repeat `--changed-path` for
more paths; omit it to inspect the repository. The reader does not start a daemon, render
documents, sync CodeGraph or write model/runtime state. It requires Git and an adopted model.
Invalid paths and missing authority return typed error envelopes.

The `archcontext.architecture-debt/v1` payload reports measured ownership and human citation
problems, the affected paths/nodes/capabilities, the producer's reason, and an action. Source
byte stamps are not an input. A logic-only edit with no measured problem owes no task.

Ownership uses the existing parent-chain measurement used by dependency and refactor checks.
An unclaimed path is actionable only under a declared source root and outside declared excludes.
Files that have been deleted are not new unowned files; citations pointing at them are checked.
Citation checks reuse `docs anchors`, including citations in another capability's document that
refer to a changed file. Model/policy edits inspect repository scope because they can change
obligations outside a source path's current owner.

## Coverage and identity

Always inspect `checks` and `coverage`. An empty `items` array with partial coverage does **not**
prove the absence of dependency, flow or practice debt. The edit-time reader explicitly defers
those checks to complete/PR integration. Missing symbol evidence remains an anchors coverage
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

The pure evaluator accepts dependency, flow and practice evidence, and projection's existing
dependency report uses the same classification. The complete consumer and a full read-only
CodeGraph path await #327 S2/S3 integration. Renderer/protocol floors and capability-isolated
generated output remain in #327. Do not treat this command as evidence that #328 is closed.
