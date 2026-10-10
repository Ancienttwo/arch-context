# Projection output compatibility for the next archctx release

Status: unreleased. Fold this into the next versioned release note
(`docs/researches/YYYYMMDD-archctx-XXXX-release.md`) during release prep. It covers PR #267
(issues #257, #258, #259), #266, #277 and the follow-ups first proposed in PR #270.

## Breaking changes

### `docs` envelopes: machine-dependent values moved out of `provenance` (#257, #266, #277)

The `provenance` object on the `docs plan`, `docs preview` and `docs apply` envelopes (including the
`noop` apply) is the committed manifest provenance. It now records machine-independent values only:
content digests of the model and the declared sources, plus renderer, layout and CodeGraph package
and version. Everything that depends on the checkout path, the index build time, the platform or
whether `codegraph init` ran on that machine moved to the sibling `runtimeSnapshot` object, which
`docs drift` also returns:

| Removed field | Read instead | Since |
| --- | --- | --- |
| `provenance.baseHeadSha` | `runtimeSnapshot.headSha` | provenance v2 (#267) |
| `provenance.worktreeDigest` | `runtimeSnapshot.worktreeDigest` | provenance v2 (#267) |
| `provenance.generatedFrom.codeGraphBinaryDigest` | not emitted; the CodeGraph handshake verifies the binary internally | provenance v2 (#266) |
| `provenance.codeGraphDigest` | `runtimeSnapshot.codeGraphDigest` | provenance v3 (#277) |
| `provenance.indexedWorktreeDigest` | `runtimeSnapshot.indexedWorktreeDigest` | provenance v3 (#277) |
| `provenance.generatedFrom.codeGraphStatus` | `runtimeSnapshot.codeGraphStatus` | provenance v3 (#277) |

`runtimeSnapshot.codeGraphDigest` digests the CodeGraph version and the code evidence the run read
(import graphs and selector evidence). It no longer includes the binary digest or the index status,
so re-indexing an unchanged tree does not move it.

The old fields are not emitted, not even as aliases. Detect the shape with
`provenance.schemaVersion`:

- `archcontext.architecture-docs-projection-provenance/v1` — oldest shape, with commit and worktree.
- `.../v2` — no `baseHeadSha` or `worktreeDigest`; still has `codeGraphDigest`,
  `indexedWorktreeDigest` and `generatedFrom.codeGraphStatus`.
- `.../v3` — current: `sourceTreeDigest`, `modelDigest`, `projectionInputDigest`, `rendererVersion`,
  `layoutVersion` and `generatedFrom.{codeGraphPackage, codeGraphVersion}` only.

Migration for consumers: read HEAD, worktree and CodeGraph runtime state from `runtimeSnapshot`,
and gate on `provenance.schemaVersion` rather than on field presence. Do not compare
`runtimeSnapshot` across machines or commits: it is a per-run fact and is never committed.

The cross-repository protocol keeps its shape: `ProjectionSnapshotV1` (`projection run` results,
apply receipts, recovery bindings and readbacks) still carries `baseHeadSha`, `codeGraphDigest`,
`indexedWorktreeDigest` and `generatedFrom.codeGraphStatus`, now taken from the run's runtime
snapshot. Its JSON schemas are unchanged.

### Committed manifest `docs/architecture/.projection-manifest.json`

- Provenance is now v3 (see above). Each entity target is stamped with `sourceFootprintDigest`, a
  content digest of the node's declared footprint; `verifiedAgainst.commit` is gone (#267).
- Two machines that project the same commit write byte-equal manifests, whatever the checkout
  path, the platform, the index build time or whether a `.codegraph` index exists.
- Provenance is a pure function of content, so there is no sticky reuse of an earlier provenance
  any more. A manifest written by an older archctx fails the freshness gate closed with
  `projection-source-stamp-missing` (pre-#267) and its v1/v2 provenance is never read as v3: it
  shows as manifest drift. Migration: re-run the documentation projection once (`archctx docs
  apply` or `archctx projection run` in `apply` mode) and commit the rewritten manifest.

### Footprints count Git-visible files only

Footprint stamps, scale signals, the source tree digest and the CodeGraph import footprints are
measured over one list per run: tracked plus untracked, non-ignored files
(`git ls-files --cached --others --exclude-standard`). A gitignored file under a `source.include`
glob (build output, caches, logs) no longer counts. Stamps of nodes whose footprint contained
ignored files change once; re-project to refresh them. Outside a Git worktree the measurement fails
closed with `AC_REPO_NOT_FOUND` (reasonCode `git-worktree-required`). Line endings are still
normalized, so a CRLF checkout measures the same digests as an LF one.

### `projection run` in `check` mode

`check` is computed in-process and read-only: it never starts or contacts the daemon, opens no
local store, writes no runtime state and needs no task session. Its result carries `freshness`
(capability `projection-check-freshness-v1`, #259) and no longer carries `priorCommittedApplies`;
`apply` and `readback` report earlier committed attempts.

## Non-breaking

- `projection run` and `docs` fail with `AC_CODE_FACTS_UNAVAILABLE` (reasonCode `index-missing`)
  when `codeFacts.required: true` and the CodeGraph index is missing, instead of reporting a major
  change for every capability (#258).
