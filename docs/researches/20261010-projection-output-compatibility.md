# Projection output compatibility for the next archctx release

Status: unreleased. Fold this into the next versioned release note
(`docs/researches/YYYYMMDD-archctx-X.Y.Z-release.md`) during release prep. It covers PR #267
(issues #257, #258, #259), PR #269, PR #272 (#266), PR #270 and PR #286 (#276, #277). v0.6.3
predates all of them, so renderer v5 and provenance v3 ship together for the first time.

## Breaking changes

### `docs` envelopes: machine-dependent values left `provenance` (#257, #266, #277)

The `provenance` object on the `docs plan` and `docs apply` envelopes (including the `noop` apply)
is the committed manifest provenance. It now records machine-independent values only: content
digests of the model and the declared sources, plus renderer, layout and CodeGraph package and
version. Everything that depends on the checkout path, the index build time, the platform or
whether `codegraph init` ran on that machine is in the sibling `runtimeSnapshot` object, which
`docs drift` also returns:

| Removed field | Read instead | Removed by |
| --- | --- | --- |
| `provenance.baseHeadSha` | `runtimeSnapshot.headSha` | provenance v2 (#267) |
| `provenance.worktreeDigest` | `runtimeSnapshot.worktreeDigest` | provenance v2 (#267) |
| `provenance.generatedFrom.codeGraphBinaryDigest` | nothing; no runtime consumer reads it | #272 (#266) |
| `provenance.codeGraphDigest` | `runtimeSnapshot.codeGraphDigest` | provenance v3 (#277) |
| `provenance.indexedWorktreeDigest` | `runtimeSnapshot.indexedWorktreeDigest` | provenance v3 (#277) |
| `provenance.generatedFrom.codeGraphStatus` | `runtimeSnapshot.codeGraphStatus` | provenance v3 (#277) |

`runtimeSnapshot.codeGraphDigest` digests the CodeGraph version and the code evidence the run read
(import graphs and selector evidence). It no longer includes the binary digest or the index status,
so re-indexing an unchanged tree does not move it. The removed fields are not emitted, not even as
aliases.

Detect the shape with `provenance.schemaVersion`:

- `archcontext.architecture-docs-projection-provenance/v1`: oldest shape, with commit and worktree.
- `.../v2`: never released. No `baseHeadSha` or `worktreeDigest`; still has `codeGraphDigest`,
  `indexedWorktreeDigest` and `generatedFrom.codeGraphStatus`.
- `.../v3`: current. `sourceTreeDigest`, `modelDigest`, `projectionInputDigest`, `rendererVersion`,
  `layoutVersion` and `generatedFrom.{codeGraphPackage, codeGraphVersion}` only. The published
  manifest contract (`ArchitectureDocsProjectionManifestV1`, `architectureDocsProjectionManifestIssues`
  and `schemas/runtime/projection-manifest.schema.json`) accepts only v3.

Migration for consumers: read HEAD, worktree and CodeGraph runtime state from `runtimeSnapshot`,
and gate on `provenance.schemaVersion` rather than on field presence. Do not compare
`runtimeSnapshot` across machines or commits. It describes one run and is never committed.

### Protocol snapshots keep their shape (#266, #277)

`ProjectionSnapshotV1` in `projection run` results, apply receipts, recovery bindings and readbacks
drops `generatedFrom.codeGraphBinaryDigest` (#266); the JSON schemas under `schemas/runtime/` reject
it. It still carries `baseHeadSha`, `codeGraphDigest`, `indexedWorktreeDigest` and
`generatedFrom.codeGraphStatus`, now taken from the run's runtime snapshot rather than from the
committed provenance. Receipts are runtime artifacts, so a readback or replay that rebuilds its
request from a receipt reads `generatedFrom` from the receipt's binding, never from the manifest.

### Committed manifest `docs/architecture/.projection-manifest.json`

- Renderer `archcontext.docs-renderer/v5` and provenance v3 (#269, #267, #277). Each entity target
  is stamped with `sourceFootprintDigest`, a content digest of the node's declared footprint, and
  `verifiedAgainst.commit` is gone.
- Two machines that project the same commit write byte-equal manifests, whatever the checkout
  path, the platform, the index build time or whether a `.codegraph` index exists.
- Footprint digests read file contents with CRLF normalized to LF (#269), so a `core.autocrlf`
  checkout stamps the same digest as an LF one. A lone CR is still content.
- Provenance is a pure function of content, so there is no sticky reuse of an earlier provenance.
  A manifest written by an older archctx fails the freshness gate closed with
  `projection-source-stamp-missing` (pre-#267), and a v1/v2 provenance is never read as v3: it
  shows as manifest drift and freshness fails with `projection-snapshot-provenance-missing`.
  Migration: re-run the documentation projection once (`archctx docs apply`, or `archctx projection
  run` in `apply` mode) and commit the rewritten manifest.

### Footprints count Git-visible files only (#270, #257)

Footprint stamps, scale signals, the source tree digest and the CodeGraph import footprints are
measured over one list per run: tracked plus untracked, non-ignored files
(`git ls-files --cached --others --exclude-standard`). Git supplies the file list only. Contents
are read from the worktree with the same CRLF normalization, and Git history is never read, so a
shallow clone stamps the same digest. A gitignored file under a `source.include` glob, such as
build output, a cache or a log, no longer counts. `.git` and `node_modules` path segments stay
excluded even when tracked.

Stamps of nodes whose footprint contained ignored files change once; re-project to refresh them.
Outside a Git worktree the measurement fails closed with `AC_REPO_NOT_FOUND` (reasonCode
`git-worktree-required`).

### `projection run` in `check` mode (#270, #259)

`check` is computed in-process and read-only. The CLI answers it before any runtime client
exists, so it never starts or contacts the daemon, opens no local store or journal, writes no
runtime state and needs no task session. The daemon and MCP path call the same function, so both
surfaces return the same result: `freshness` (capability `projection-check-freshness-v1`, #259),
`human-action-required` with `orphaned-document-review` human actions when an orphan may hold
human text (#268), and the usual drift status.

A `check` result no longer carries `priorCommittedApplies`. A check never commits, and reading the
journal would need runtime state; `apply` (which replays a committed request, #265) and `readback`
report earlier committed attempts. `check` still runs the CodeGraph handshake and `codegraph sync`,
which update the repo-local, gitignored `.codegraph` index.

## Non-breaking

- `projection run` and `docs` fail with `AC_CODE_FACTS_UNAVAILABLE` (reasonCode `index-missing`)
  when `codeFacts.required: true` and the CodeGraph index is missing, instead of reporting a major
  change for every capability (#258).
- An orphaned module document of a removed node is deleted in the same ChangeSet when the text
  outside its generated region is exactly the renderer's own skeleton for that target (title and
  empty §3, §4 and Optimization Backlog headings, as the committed manifest records the target) and
  the region digest is intact. Any human text there still reports `orphaned-document-review` and
  blocks the apply (#276).
