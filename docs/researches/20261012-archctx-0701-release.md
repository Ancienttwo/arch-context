# archctx / archctx-contracts 0.7.1

## Changes

CLI:

- #297, #303: the published 0.7.0 bundle ran the CLI entry before some module constants were set. `plan --operations-file` always failed, and `plan --help` and `hash --help` printed nothing. The entry now runs after every top-level constant is set. `plan --operations-file -` reads the operations from stdin.
- #315: the CLI secret check reported some standard base64 values as a private key file reference (`device-private-key-file-ref-forbidden`). A value that started with `/` and contained `key`, `device` or `private` matched, for example an echoed review signature. The check now skips a padded base64 value. Real file references, also `FILE:///` ones, are still refused.

Refactor:

- #295, #307: `refactor scan` reads all CodeGraph import nodes in one query sized from the index count. Before, it read at most 5000 nodes, and a larger complete index always gave `code-facts-truncated`. The request field `importNodeLimit` (CLI `--import-node-limit`, default 50000) caps the read. Above the cap, `codeFacts` is `coverage: partial` with the new reason code `code-facts-import-limit` and `importNodeCount`. `code-facts-truncated` now means only that the read returned fewer nodes than the index reported, or that no index answered.
- #310: `recommendations show` and the scan-candidate decisions take `--import-node-limit`, so a candidate from a scan with a custom limit is found and recorded under the same `requestId`. `refactor verify` takes `importNodeLimit` in the verification request (CLI `--import-node-limit`). Without it, verify measures with the limit of the recorded baseline snapshot.
- #301, #309: the scan result has `untrackedExcludedCount`: the worktree files that Git does not ignore and that `HEAD` does not carry. The scan measures `HEAD` only. Capability `refactor-scan-untracked-count-v1`.

Ownership and dependencies:

- #296, #304: path ownership uses one rule for `resolve` and `refactor scan`: when all candidates lie on one `parent` chain, the deepest one owns the path. `archctx resolve --paths-from <file>` resolves many paths in one call and reports the owning capability.
- #301, #309: `plan` previews a ChangeSet that writes a node file with `preview.ownershipDelta`: the files that become owned, contested or unowned, or change owner. Capability `changeset-ownership-delta-v1`. `archctx deps [--into capability.<id>]` reports the capability dependency matrix from the import graph. It counts only edges whose two ends are in `HEAD`. Capability `capability-dependencies-v1`.
- #309: workspace package reading expands `dir/*` entries, so `refactor scan` and `deps` resolve bare specifiers in a repository that declares `packages/*`. Another glob shape fails with `workspace-glob-unsupported`.

Docs and flows:

- #295, #311: the docs projection reads all CodeGraph import nodes too. Before, its import graphs were truncated above 5000 import nodes.
- #299, #302, #305: module pages render component entrypoints, sizes and outbound relations. The new manifest setting `docs.language` (`zh-Hant`, `zh-Hans`, `en`) selects the title suffix and two headings of a new module document skeleton. It never rewrites an existing document. Mermaid labels escape special characters with entity codes and keep the model text.
- #312: this repository's architecture docs accept the flow-proof digest change that the #305 Mermaid escape caused. The flow proof itself did not change.
- #300, #306: `archctx flows check --json` runs the P2 flow proof without a projection and reports each declared selector. A call with a runtime built-in name counts as a call edge to a sink only when the source file imports the sink file. Capability `flow-selector-check-v1`.
- #298, #308: `archctx docs anchors [--json]` reports stale citations in human-owned document text and node prose: missing paths, missing symbols, and line numbers that are out of range or moved. It is read-only and opens the CodeGraph index read-only (`index-open-failed` when that fails). A call-shaped `name()` is checked against the current source. Capability `docs-anchors-v1`.

Runtime:

- #313: on Windows, a CLI read of the daemon control file during the daemon idle exit failed the removal with `EBUSY`, and `archctxd.json` and the lock file stayed. The removal now retries while a reader holds the file. A request or a health check during that wait cancels the idle exit. Cleanup failures go to `archctxd.log` instead of an unhandled rejection. The Windows native file-create deadline is 60 s, and the CodeGraph `--version` handshake deadline is 10 s.

Contracts:

- archctx-contracts publishes `flow-selector-check.schema.json`, `capability-dependencies.schema.json` and `docs-anchors.schema.json`.
- `code-facts-import-limit` is in every refactor reason-code enum. The scan and show schemas have `codeFacts.importNodeCount` and `refactorRequest.importNodeLimit`. The scan schema has `untrackedExcludedCount`.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together, at the same version.

A consumer that validates 0.7.1 output with the 0.7.0 schemas can reject it:

- A scan, show or recommendation can carry the reason code `code-facts-import-limit`, which the 0.7.0 enums do not have.
- A scan or show can carry `codeFacts.importNodeCount` and `untrackedExcludedCount`, which the 0.7.0 schemas do not allow (`additionalProperties: false`).
- The 0.7.0 capabilities schema accepts the new feature flags, because it matches flags by pattern.

All new fields are optional, so the 0.7.1 schemas accept output from archctx 0.7.0. Snapshots recorded before 0.7.1 have no `importNodeCount`. `refactor verify` measures such a baseline with the default import node limit.

`refactorClassifierRulesetDigest` changes, because the reason-code enum changes. New refactor runs bind a new ruleset digest.

The #306 proof rules can change a proven flow selector to unproven, for example a built-in-named call through a package alias or a barrel. Run `archctx flows check --json` before the first projection after the upgrade. In this repository, both selectors stay `proven`.

The committed projection format does not change. The renderer stays `archcontext.docs-renderer/v5`, and the manifest stays v2.

CodeGraph remains pinned to `@colbymchenry/codegraph` 1.6.1. The pinned Bun toolchain is 1.4.3.

## Verification

All candidate commands use Bun 1.4.3. The candidate is `8b6f211e` (main after #312) plus this release commit.

- `bun run verify`: typecheck, package and mock audits, architecture Mermaid render, practices and the CodeGraph selector check pass. `bun test`: 2644 pass, 3 skip, 1 fail. The failure is a 30 s timeout in `local-store-sqlite` "architecture ledger appends, replays, snapshots, compacts ..." while the host load average was about 40. Alone, that file passes (102 pass, 0 fail). The steps after `bun test` (Explorer, packaged CLI smoke, privacy and security readbacks, acceptance ledgers, sprint status, evals) pass when run on their own.
- `bun install --frozen-lockfile` passes.
- The version-bound deterministic records (fg4, fg6) were regenerated with their record scripts after the rebase. Only `generatedAt` changed.
- The `archctx-contracts` npm preflight is ready (`archctx-contracts@0.7.1`, 199 files, not yet published). The npm release dry-run passes with no failures.
- The architecture projection was refreshed in #312 on top of #309, #308 and #313. `docs drift` was clean, with no major change and no refresh signals.

Publish both npm packages after the release-prep CI passes. Rebuild the tarballs from the merged main commit. Create tag `v0.7.1` and the GitHub Release only after both npm publishes succeed. Tag `v0.7.0` points to `184e3d28` (Merge #294), the commit that the published 0.7.0 packages were built from.
