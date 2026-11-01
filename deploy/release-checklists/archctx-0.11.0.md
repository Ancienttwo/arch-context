# archctx / archctx-contracts 0.11.0 preparation

Baseline: `origin/main@93a951247e`, the merge of #440.
This records a release candidate, not publication. Both registry latest versions were read back as 0.10.0 during preparation.

## Changes

- #438 / #439: **new command and contract.** `archctx history [--ref <rev>] [--format json|mermaid] [--offset <n>] [--limit <n>]` derives architecture milestones from the first-parent Git history of `.archcontext/model` and `.archcontext/manifest.yaml`.
  - Each milestone carries the structural delta at domain → capability granularity, the nearest owning `capability` of each delta item, `baseRev` (the preceding valid milestone) and a purpose line from the commit subject. An invalid historic model is an error milestone, and the next valid revision is a recovery milestone.
  - JSON output is paginated (`--limit` defaults to 200, maximum 1000), and `--ref` pins later pages. `--format mermaid` emits the full shape of each milestone.
  - The new contracts are `archcontext.architecture-history/v1` and `archcontext.architecture-history-mermaid/v1` in `archctx-contracts`.
  - The new failure reason codes are `history-model-invalid`, `history-model-layout-unsupported`, `history-model-missing`, `history-model-too-large` and `history-shallow-repository`. A shallow clone fails closed with `AC_PRECONDITION_FAILED`.
  - Revision states are cached under the shared cache directory, keyed by derivation version `v3`.
  - Git log reads disable `log.showSignature`, so signed commits do not corrupt the revision field.
- #439: **rolling writer output.** `projection publish` writes `docs/architecture/history.md` with the most recent 20 milestones. Each valid milestone shows a domain overview of changed edges and, at 20 changed edges or fewer, a capability detail diagram. `verify-pr` compares a changed `history.md` with the head render. `history.md` is not in the projection manifest, and `docs apply` does not write it.
- #434 / #440: repository-only. `docs/architecture/` keeps only `archimap.html`, the projection manifest and the capability document. The authority matrix and the script-surface policy moved verbatim to ADR-0050 and ADR-0051. The AL10 beta-decision readback is inspect-only. No product code changed.

## Compatibility

Version 0.11.0 is a minor release: it adds a command, a public contract and a rolling-writer output. Upgrade `archctx` and `archctx-contracts` together.

- Repositories that run `projection publish` get a new generated `docs/architecture/history.md` on their next publish. The rolling writer owns that file; hand edits fail `verify-pr`.
- `archctx history` needs full history. In a shallow CI checkout, fetch with `fetch-depth: 0` or expect `history-shallow-repository`.
- `docs plan`, `docs apply` and `docs drift` output, the projection manifest schema, both projection profiles, RPC v2 and the SQLite migrations are unchanged. There is no architecture authority promotion.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (`catalogDigest` regenerated from `loadPracticeCatalog`), the review action default, and the example workflows.
- [x] Deterministic readbacks derived from the product version regenerated from their producers.
- [x] Hosted Verify passed on the merged changes' PR heads: `de2cb8d1` (#439) and `8aa2d0e1` (#440).
- [ ] Release-candidate PR head: hosted full/matrix Verify before merge.
- [ ] Rebuild both package tarballs from accepted main and read back version, contents and digests.
- [ ] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior code and version authorities. Published versions are immutable and require a new corrective version.
