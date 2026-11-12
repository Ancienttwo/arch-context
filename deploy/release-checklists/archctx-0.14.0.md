# archctx / archctx-contracts 0.14.0 preparation

Baseline: `3de93034`, the 0.13.0 release preparation. This phase describes merged code through `f39d03e5`; items marked **PENDING** describe proposals that have not merged and must be checked again before release.

## Changes

- **#542, #553: render-equivalent freshness and manifest v4 (ADR-0056).** Freshness compares rendered output to the committed manifest, rather than source stamps; a source-only edit that does not change output stays fresh. The manifest, result, recovery and other contracts move as listed below. The operator re-baselines once; there is no v3 reader.
- **#566: architecture history.** `architecture-history` becomes a projection target, and the writer applies `docs/architecture/history.md` through a ChangeSet. A history read in a shallow repository fails closed; an intact committed history row can otherwise be carried forward without a history read.
- **#543, #550, #562: state machines.** State-machine loading is consolidated, the unused `StateMachineRuleCheckV1` export is removed, and symbol anchor digests cover direct callees. Deleted paths select all symbol anchors; nested declaration bodies use CodeGraph `contains` edges. **PENDING #571:** nested state-machine YAML becomes a validation error; current merged code silently skips it.
- **PENDING #572: agent-context projection.** Contract regions become manifest rows and projection owns their writes. Shared paths produce one `changes[]` entry per target; marker v2 drops `sourceDigest`. A missing designated root contract can be created by the canonical render.
- **#564: ADR-0057. PENDING #540 phase 2:** remove the default-profile `architecture-changelog` target and its type without an alias, and migrate the old file during the v4 re-baseline.
- **#545, #554, #555:** CodeGraph status and child commands avoid refreshing or locking the Git index; import targets resolve against Git-visible files.
- **#556:** a receipt-bearing projection apply requires a ready CodeGraph index before writing. **#568:** `.codegraph/` metadata is excluded from projection-writer changes. **#570:** practice path globs use the shared glob compiler.
- **#531, #532, #534, #538, #551, #561: repository and documentation.** Register the tooling owner; correct retryable failed-job terminal counts (also recorded in the 0.13.0 checklist); allow Governance receipts to span attempts of the same run and SHA; clarify the hosted-job attempt boundary; remove the topology re-verification signal from the ADR; and update the projection runbook for v4 ownership and proof. These include no additional release version changes.

## Release notes

Use this section as the GitHub Release notes file after all PENDING items have merged and been verified.

**archctx / archctx-contracts 0.14.0 changes projection freshness and requires a one-time manifest re-baseline. Upgrade both packages together.**

Breaking changes:

- Manifest `archcontext.architecture-docs-projection-manifest/v3` becomes `/v4`; v1–v3 are refused with `projection-manifest-upgrade-required`. There is no v3 reader or automatic migration. Rows no longer carry `sourceStamps` or `scale`; freshness is based on output. `archctx projection freshness [--json]` no longer accepts `--changed-path` or the `nodes`/`tree` scope; `archctx checkpoint --changed-path` is unchanged. The old `changed-path-outside-worktree` and `changed-path-not-normalized` failure reasons are removed. Freshness may sync CodeGraph.
- Contract types move: `ArchitectureDocsProjectionManifestV3`, `ArchitectureDocsProjectionManifestTargetV3`, and `ArchitectureDocsProjectionManifestCapabilityV3` become their `V4` counterparts; `ProjectionFreshnessV1` and `ProjectionFreshnessStaleNodeV1` become `ProjectionFreshnessV2` and `ProjectionFreshnessStaleTargetV2`; `ProjectionTargetChangeV1` becomes `ProjectionTargetChangeV2`; `ArchitectureDigestSetV1` and `ArchitectureProjectionProofEvidenceV1` become `ArchitectureDigestSetV2` and `ArchitectureProjectionProofEvidenceV2`; `ProjectionResultV2` becomes `ProjectionResultV3`; `ArchitectureRefreshSignalV1` becomes `ArchitectureRefreshSignalV2`; `ProjectionApplyRecoveryBindingV1`, `ProjectionApplyRecoveryProofV1`, and `ProjectionApplyRecoveryResultV1` become their `V2` counterparts; and `ProjectionApplyReadbackResultV1` becomes `ProjectionApplyReadbackResultV2`. Engine freshness evaluation moves from v2 to v3. `ProjectionApplyReadbackV1` remains named v1 but embeds the v2 result.
- `ArchitectureDigestSetV2` drops `sourceTreeDigest`, and `ArchitectureProjectionProofEvidenceV2` drops `sourceStamps`. `ProjectionTargetChangeV2` drops `stampChanged`, `stamp-only`, and `source-stamp-changed`; freshness replaces `staleNodes` with `staleTargets`. Runtime provenance and `ProjectionSnapshotV1` retain `sourceTreeDigest`.
- Freshness reports `projection-manifest-missing`, `projection-manifest-unreadable`, `projection-output-changed`, and `projection-manifest-changed`. Capability flags `projection-change-classification-v2`, `projection-check-freshness-v2`, `projection-freshness-v2`, and `projection-manifest-contract-v4` replace their predecessors.
- `archctx-contracts` removes `architectureDocsProjectionManifestSourceStamps`, `ArchitectureCapabilityScaleV1`, `ArchitectureScaleBucketV1`, `isArchitectureScaleBucket`, and `StateMachineRuleCheckV1`; `StateMachineCheckReportV1` remains. `architectureSourceStampsDigest` is renamed `architectureSourceTreeDigest` with the same formula. The projection engine removes its stamp evaluators `evaluateArchitectureProjectionFreshness` and `evaluateArchitectureProjectionSnapshotFreshness`, `loadArchitectureProjectionManifestStamps`, `architectureProjectionStampedNodeIds`, stamp readback types and the `sourceFootprints` render input; `readCommittedArchitectureDocsProjectionManifest` replaces `assertArchitectureDocsProjectionManifestAccepted`.
- A pre-upgrade pending apply receipt carries a v1 recovery binding and fails closed after upgrade; readback or replay of a pre-upgrade committed apply fails with `projection-apply-receipt-invalid`. Drain pending receipts before upgrading.
- Symbol anchor digests now include the anchored declaration and its direct, Git-visible callees. Every previously confirmed symbol anchor reports `anchor-changed` once when checked against a current index; review the declaration and listed callees and confirm the new digest through a ChangeSet. File anchors keep their digest. A stale index yields `unchecked` / `index-stale` until synced.
- **PENDING #572:** `projection run` check and plan `changes[]` has one entry per target, unique by `targetId` and ordered by path then targetId. Different agent-context targets can share a path. The `archcontext.agent-context-renderer/v2` marker omits `sourceDigest`; projection owns designated contract regions and rewrites manually edited generated regions.
- **PENDING #540 phase 2:** the `default` layout and target type remove `architecture-changelog` without an alias. Target and manifest schemas reject that type; the default-profile migration below disposes of the old file.
- **PENDING #571:** a YAML file nested beneath `.archcontext/model/state-machines/` is a validate error, rather than being silently ignored.

Additions:

- `architecture-history` is a request and layout target for `repo-harness/v1`, producing `docs/architecture/history.md` from Git history. The existing `history-shallow-repository` failure carries optional `details.historyReadReason`: `target-named`, `history-row-missing`, `history-file-missing`, or `history-file-mismatch`. The exported `ARCHITECTURE_HISTORY_READ_REASONS` names those values.
- State-machine reports expose symbol-anchor `callees` (`path`, `qualifiedName`) and `index-stale`; `STATE_MACHINE_FAILURE_ISSUE_LIMIT` is 16 and `STATE_MACHINE_FAILURE_ISSUE_MAX_BYTES` is 256.
- **PENDING #572:** agent-context manifest rows identify each designated region. `archctx agent-context plan`, `preview`, and `apply` refuse with `agent-context-owned-by-projection` when a committed v4 row owns the region. A missing designated root contract is created only with the canonical render.

Known issue: [colbymchenry/codegraph#3280](https://github.com/colbymchenry/codegraph/issues/3280) tracks an intermittent Windows `codegraph init` crash on projects with no supported source files: access violation `0xC0000005` (3221225477), reported by Bun as exit 5. archctx itself runs only CodeGraph `sync`, `status` and queries. One rerun is allowed per red Windows job only when `codegraph init` exits 5 or 3221225477, stdout ends at `Parsing code...` or `Done`, and stderr is empty. A second matching red on the same head or any other red is a normal failure.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together. Close any rolling projection PR, check that projection check is `noop` and `archctx docs drift` is clean, and drain pending apply receipts with `projection recover` before upgrading. Then, in a full clone, run once with the profile recorded by the old manifest:

```sh
archctx docs apply --approved --profile <default|repo-harness/v1>
```

If adoption or re-baseline refuses with `projection-ambiguous-ownership` and names the stale writer-written `docs/architecture/history.md`, review the refusal and run the `git rm` command in `error.details.commands`, then rerun apply. No v3 row vouches for that whole-file output. Confirm clean `archctx docs drift`, a `noop` projection check, and `archctx projection freshness --json` with `ok: true`; commit the manifest and changed outputs together. See `docs/runbooks/architecture-documentation-projections.md` for the complete procedure.

**PENDING #540 phase 2 — default-profile migration (ADR-0057 Decision 3):** the approved v4 re-baseline reads the retired `docs/architecture/changelog.md`. It deletes the file only if the whole file is the generated region, its marker digest matches, and its body is the empty-state render. Human text, missing or unparseable markers, or a digest mismatch require human review; apply refuses with `projection-orphan-review-required` until a human removes the file. After re-baseline, the v4 manifest has no changelog row and later files at that path are not projection-owned.

For repo-harness when it raises its archctx pin: **PENDING #572:** deduplicate the `differingPaths` built from `changes[]`, or key targets by `targetId`. Readers of state-machine reports must accept `callees` and `index-stale`. The repo-harness CI selection checkout uses `fetch-depth: 0`; `verify-pr` is invoked from the local worker flow, so its checkout must also be a full clone.

## New in the published payload

The existing runtime schemas change in place: `archctx-capabilities.schema.json`, `architecture-refresh-signal.schema.json`, `projection-apply-readback.schema.json`, `projection-apply-recovery.schema.json`, `projection-manifest.schema.json`, `projection-publish-run.schema.json`, `projection-request.schema.json`, `projection-result.schema.json`, `projection-target.schema.json`, and `state-machine-check.schema.json`. Read back both tarballs after the final candidate is built; **PENDING #572 and #540 phase 2:** verify their final schema changes against the merged code.

## Evidence and remaining gates

- [ ] **PENDING #572, #540 phase 2, #571:** merge and verify each item, then reconcile these notes with its final code.
- [ ] Phase 2, after all other 0.14.0 PRs merge: synchronize every version authority, regenerate the practice catalog digest and cross-check it. Verify `git grep 0.13.0` outside `deploy/` and `docs/` returns nothing.
- [ ] Release-candidate PR head: required review and hosted full/matrix Verify pass before merge.
- [ ] Rebuild both package tarballs from accepted main; read back versions, contents and digests.
- [ ] Publish interactively with npm web authentication. Wait for both registry versions, then read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit, using the finalized Release notes above.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publishing, tagging and creating the GitHub Release are owner actions. Do not republish an accepted upload while it is processing. Before publication, revert the candidate to restore the 0.13.0 version authorities; after publication, immutable versions require a new version for a fix.
