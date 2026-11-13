# archctx / archctx-contracts 0.14.1 preparation

Baseline: `f381b510`, the published 0.14.0 commit (tag `v0.14.0`). This checklist describes merged code through `5804c215`.

## Changes

- **#579 / #587: fix, re-baseline of a superseded manifest that carries floors.** A v1–v3 manifest that records `minimumRendererVersion` or `minimumProtocolVersion` (repo-harness's 0.13.0 manifest records `archcontext.docs-renderer/v6`) refused `archctx docs apply --approved` with `AC_PRECONDITION_FAILED` / `projection-manifest-incompatible`. Its floors now decide only whether this engine may replace it. A floor this engine meets lets the re-baseline write a fresh v4 manifest, and the floors are not carried into v4. A floor this engine does not meet still refuses with `projection-manifest-incompatible`.
- **#580 / #588: behavior change, no agent-context region in a root contract file under `repo-harness/v1`.** The repository-root `AGENTS.md` and `CLAUDE.md` get no manifest row and no region; `contractFiles` still names and requires them for routing, and capability-local contract files keep their rows. `archctx agent-context` refuses by the committed manifest's profile, a raw root `render_agent_context` ChangeSet refuses under `repo-harness/v1`, and the #572 root-create branch is removed. ADR-0056 §9 is amended to match.
- **#574 / #586: repository only.** ADR-0058 records that CodeGraph code facts are read only through the in-process read-only handle. No product behavior change.

## Release notes

Use this section as the GitHub Release notes file.

**archctx / archctx-contracts 0.14.1 fixes the 0.14.0 re-baseline of a manifest that carries floors, and stops `repo-harness/v1` from writing agent-context regions into root contract files. Upgrade both packages together.**

Fixes:

- **#579:** `archctx docs apply --approved` re-baselines a superseded v1–v3 manifest whose `minimumRendererVersion` / `minimumProtocolVersion` floors this engine meets. The new v4 manifest does not carry those floors. A floor this engine does not meet still refuses with `AC_PRECONDITION_FAILED` / `projection-manifest-incompatible`, and without `--approved` a superseded manifest still refuses with `projection-manifest-upgrade-required`.
- **#579, `archctx-contracts`:** `architectureDocsProjectionCompatibilityIssues` no longer reports floors on a superseded declared schema; it still checks each floor against the engine. Floors with no declared schema, a non-string schema or an unsupported schema report `projection manifest floors require a current or superseded schema`, which replaces `projection manifest floors require the current schema`.

Behavior changes (#580, ADR-0056 §9 amendment):

- Under `repo-harness/v1`, `docs apply`, adoption and `projection run` write no `agent-context` row and no region for a `contractFiles` path that is the root `AGENTS.md` or `CLAUDE.md`. `contractFiles` still requires and accepts the root files, and `export native` still lists them. Capability-local contract files keep their `projection_target.agent-context.<agents|claude>.<node>` rows and regions.
- `archctx agent-context plan|preview|apply` reads the committed manifest by profile, instead of checking for `agent-context` rows. A superseded v1–v3 manifest refuses with `projection-manifest-upgrade-required`. A v4 `repo-harness/v1` manifest refuses with `AC_PRECONDITION_FAILED` / `agent-context-owned-by-projection`, whether or not it records an `agent-context` row. Without a manifest, or under a v4 `default` manifest, the command runs as before.
- Under a `repo-harness/v1` manifest, a raw `render_agent_context` ChangeSet that writes a root contract file (for example through MCP `archcontext_plan_update`) is not allowed at preview, with the finding `Root contract has no agent-context region under repo-harness/v1`, and throws at apply.
- The #572 root-create branch is removed in every profile. A root contract write requires an existing file with an exact `sha256:` `expectedHash` (`Root contract must exist with an exact expectedHash`), and an `expectedHash` of `missing` is refused. Outside `repo-harness/v1`, the write must still equal the canonical render byte for byte.
- In a projection-writer pull request, a change to the root `AGENTS.md` or `CLAUDE.md` is non-generated, because the root files have no row.

Known issue: [colbymchenry/codegraph#3280](https://github.com/colbymchenry/codegraph/issues/3280) is unchanged from 0.14.0; the single-rerun rule in the 0.14.0 checklist still applies.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together. Reason codes, protocol and manifest schemas, RPC v2, SQLite migrations, CodeGraph, Bun 1.4.3 and Node `>=22.22 <26` are unchanged from 0.14.0. No runtime schema changes.

- **From 0.13.0:** follow the 0.14.0 Compatibility section and `docs/runbooks/architecture-documentation-projections.md`. A v3 manifest whose floors this engine meets now re-baselines in one `archctx docs apply --approved --profile <default|repo-harness/v1>`. Do not delete `minimumRendererVersion` first.
- **From 0.14.0 under `repo-harness/v1` with root contract files:** the manifest has root rows. The next apply stops at those files with `orphaned-document-review` (`docs apply` refuses with `projection-orphan-review-required`). There is no retire step: remove the root regions by hand, then apply again; the apply drops the rows.
- **repo-harness raising its pin from 0.13.0 to 0.14.1 ([aimpact-inc/repo-harness#2686](https://github.com/aimpact-inc/repo-harness/issues/2686)):** target 0.14.1, not 0.14.0. 0.14.0 refuses repo-harness's v3 manifest, which records `minimumRendererVersion: archcontext.docs-renderer/v6`. Every 0.14.0 note for repo-harness still applies: deduplicate `differingPaths` or key targets by `targetId`, accept `callees` and `index-stale`, re-confirm symbol anchors, and use full clones. On top of those:
  - The re-baseline writes no region into the root `AGENTS.md`/`CLAUDE.md`; repo-harness never ran 0.14.0, so there are no root rows to clear. The #580 acceptance run on repo-harness main `844d59141` kept both root files byte-identical and wrote six capability-local rows: `assets/`, `scripts/` and `src/cli/hook/`, each with `AGENTS.md` and `CLAUDE.md`.
  - The same run refused first with `projection-ambiguous-ownership` for `docs/architecture/runtime-topology.md`, the ADR-0056 §11 step for an unvouched whole-file output. Run the `git rm` in `error.details.commands`, then apply again.
  - After the re-baseline, `archctx agent-context plan|preview|apply` refuses with `agent-context-owned-by-projection`; before it, with `projection-manifest-upgrade-required`. Callers must use `docs apply` or `projection run` instead.
  - A writer pull request that touches the root contract files is not generated-only.

## New in the published payload

Nothing new. No file under `schemas/` changes between `v0.14.0` and this candidate. Read back both tarballs after the final candidate is built.

## Evidence and remaining gates

- [x] #579 and #580 merged; notes reconciled with their code (`ee3eaf3a`, `5804c215`).
- [x] Version authorities synchronized in the same 11 files as #578, which with this checklist is its 12-file shape. The practice catalog digest is `sha256:eb7555526d512dc8eb4858e6e49b9b2248a2f69c0e62fabd308d05edde6ab196`, matching both `loadPracticeCatalog` and `digestJson` of the manifest body. Remaining `0.14.0` references are historical checklists, this checklist, ADR-0054/0056/0057, the runbooks' version history and the `layout.ts` changelog note.
- [x] Offline `bun run typecheck`, `bun run verify:practices`, and the contracts, publishability, practice-catalog, practice-engine, provenance-readback and npm dry-run tests passed (see the PR body).
- [ ] Release-candidate PR head: required review and hosted full/matrix Verify pass before merge.
- [ ] Dry run and both preflights at the RC head; record the tree hash.
- [ ] Rebuild both package tarballs from accepted main; read back versions, contents and digests.
- [ ] Publish interactively with npm web authentication. Wait for both registry versions, then read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit, using the finalized Release notes above.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publishing, tagging and creating the GitHub Release are owner actions. Do not republish an accepted upload while it is processing. Before publication, revert the candidate to restore the 0.14.0 version authorities; after publication, immutable versions require a new version for a fix.
