# Projection output compatibility for the next archctx release

Status: unreleased. Fold this into the next versioned release note
(`docs/researches/YYYYMMDD-archctx-X.Y.Z-release.md`) during release prep. It covers PR #267
(issues #257, #258, #259), PR #269, PR #272 (#266) and PR #270. v0.6.3 predates all of them, so
renderer v5 and provenance v2 ship together for the first time.

## Breaking changes

### `docs` envelopes: machine and checkout identity left `provenance`

The `provenance` object on the `docs plan`, `docs preview` and `docs apply` envelopes (including the
`noop` apply) is the committed manifest provenance. Fields that describe the checkout or the
machine that ran the projection are gone from it:

| Removed field | Read instead | Removed by |
| --- | --- | --- |
| `provenance.baseHeadSha` | `runtimeSnapshot.headSha` | provenance v2 (#267) |
| `provenance.worktreeDigest` | `runtimeSnapshot.worktreeDigest` | provenance v2 (#267) |
| `provenance.generatedFrom.codeGraphBinaryDigest` | nothing; no runtime consumer reads it | #272 (#266) |

`runtimeSnapshot` is a sibling of `provenance` on the same envelopes, and `docs drift` returns it
too. The removed fields are not emitted, not even as aliases.

Detect the shape with `provenance.schemaVersion`:

- `archcontext.architecture-docs-projection-provenance/v1`: old shape, all three fields present.
- `archcontext.architecture-docs-projection-provenance/v2`: current. No `baseHeadSha`, no
  `worktreeDigest`, and `generatedFrom` holds only `codeGraphPackage`, `codeGraphVersion` and
  `codeGraphStatus`.

#266 removed the binary digest without a version bump because provenance v2 was never released.
A v2 manifest written by an unreleased build between #267 and #272 can still carry
`generatedFrom.codeGraphBinaryDigest`; it is not reused as the sticky provenance, so the next
projection rewrites it.

Migration for consumers: read HEAD and worktree identity from `runtimeSnapshot`, and gate on
`provenance.schemaVersion` rather than on field presence. Do not compare `runtimeSnapshot` across
machines or commits. It describes one run and is never committed.

### Protocol snapshots no longer carry the CodeGraph binary digest (#266)

`ProjectionSnapshotV1.generatedFrom` in `projection run` results, apply receipts, recovery
bindings and readbacks drops `codeGraphBinaryDigest` as well. The JSON schemas under
`schemas/runtime/` reject it. `baseHeadSha` stays on the protocol snapshot.

### Committed manifest `docs/architecture/.projection-manifest.json`

- Renderer `archcontext.docs-renderer/v5` and provenance v2 (#269, #267). Each entity target is
  stamped with `sourceFootprintDigest`, a content digest of the node's declared footprint, and
  `verifiedAgainst.commit` is gone.
- Footprint digests read file contents with CRLF normalized to LF (#269), so a `core.autocrlf`
  checkout stamps the same digest as an LF one. A lone CR is still content.
- A manifest written by an older archctx fails the freshness gate closed with
  `projection-source-stamp-missing` (pre-#267), and a provenance from another renderer version or
  schema is not reused as the sticky provenance. Migration: re-run the documentation projection
  once (`archctx docs apply`, or `archctx projection run` in `apply` mode) and commit the rewritten
  manifest.
- The manifest is not yet machine-independent. `codeGraphDigest`, `indexedWorktreeDigest`,
  `projectionInputDigest` and `generatedFrom.codeGraphStatus` still depend on the machine, the
  checkout path or the local CodeGraph index. #277 tracks that work.

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
