# Projection output compatibility for the next archctx release

Status: unreleased. Fold this into the next versioned release note
(`docs/researches/YYYYMMDD-archctx-XXXX-release.md`) during release prep. It covers PR #267
(issues #257, #258, #259) and its follow-up.

## Breaking changes

### `docs` envelopes: commit and runtime identities moved out of `provenance` (#257)

The `provenance` object on the `docs plan`, `docs preview` and `docs apply` envelopes (including the
`noop` apply) is the committed manifest provenance. It now records content identities only. Fields
that describe the machine or checkout that ran the projection moved to the sibling
`runtimeSnapshot` object, which `docs drift` also returns:

| Removed field | Read instead | Since |
| --- | --- | --- |
| `provenance.baseHeadSha` | `runtimeSnapshot.headSha` | provenance v2 (#267) |
| `provenance.worktreeDigest` | `runtimeSnapshot.worktreeDigest` | provenance v2 (#267) |
| `provenance.generatedFrom.codeGraphBinaryDigest` | `runtimeSnapshot.codeGraphBinaryDigest` | provenance v3 |

The old fields are not emitted, not even as aliases. Detect the shape with
`provenance.schemaVersion`:

- `archcontext.architecture-docs-projection-provenance/v1` — old shape, all three fields present.
- `.../v2` — no `baseHeadSha` and no `worktreeDigest`; still has `generatedFrom.codeGraphBinaryDigest`.
- `.../v3` — current; none of the three.

Migration for consumers: read HEAD, worktree and CodeGraph runtime identity from
`runtimeSnapshot`, and gate on `provenance.schemaVersion` rather than on field presence. Do not
compare `runtimeSnapshot` across machines or commits: it is a per-run fact and is never committed.

The cross-repository protocol is unchanged: `ProjectionSnapshotV1` (`projection run` results, apply
receipts, recovery bindings and readbacks) still carries `baseHeadSha` and
`generatedFrom.codeGraphBinaryDigest`, and its JSON schemas are unchanged.

### Committed manifest `docs/architecture/.projection-manifest.json`

- Provenance is now v3 (see above). Each entity target is stamped with `sourceFootprintDigest`, a
  content digest of the node's declared footprint; `verifiedAgainst.commit` is gone (#267).
- A manifest written by an older archctx fails the freshness gate closed with
  `projection-source-stamp-missing` (pre-#267) and is not reused as the sticky provenance
  (v1/v2). Migration: re-run the documentation projection once (`archctx docs apply` or
  `archctx projection run` in `apply` mode) and commit the rewritten manifest.
- Projecting the same tree on another machine with the same CodeGraph version no longer rewrites
  the manifest.

### Footprints count Git-visible files only

Footprint stamps, scale signals and the source tree digest are measured over tracked plus
untracked, non-ignored files (`git ls-files --cached --others --exclude-standard`). A gitignored
file under a `source.include` glob no longer counts. Stamps of nodes whose footprint contained
ignored files change once; re-project to refresh them. Outside a Git worktree the measurement
fails closed with `AC_REPO_NOT_FOUND` (reasonCode `git-worktree-required`).

### `projection run` in `check` mode

`check` is computed in-process and read-only: it never starts or contacts the daemon, opens no
local store, writes no runtime state and needs no task session. Its result carries `freshness`
(capability `projection-check-freshness-v1`, #259) and no longer carries `priorCommittedApplies`;
`apply` and `readback` report earlier committed attempts.

## Non-breaking

- `projection run` and `docs` fail with `AC_CODE_FACTS_UNAVAILABLE` (reasonCode `index-missing`)
  when `codeFacts.required: true` and the CodeGraph index is missing, instead of reporting a major
  change for every capability (#258).
