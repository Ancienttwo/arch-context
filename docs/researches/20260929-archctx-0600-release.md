# archctx 0.6.0 release candidate

## Scope

Since `v0.5.13` (`aa93324`), main (`4e21628`) has merged six PRs (#243, #244, #245, #246, #247, #249) carrying 16 non-merge commits. The minor bump is for a breaking RPC contract change in #247.

### BREAKING: `ledger accept-committed` v2 (PR #247)

`1616e11`, `ab31f54`, `6136819`, `a31c141`, `cdb4dd8`, plus harness/docs commits `bf759ec`, `e524b5b`, `c299e8d`.

- **Old request shape rejected.** The v1 four-field RPC request for `ledger accept-committed` now returns `AC_SCHEMA_INVALID`. Callers must send an ordered list of 1–32 `{journalId, changeSetId}` pairs, listed in commit order. The chain has to start at the projection manifest's baseline `modelDigest`, link every journal (`a_i == b_{i+1}`) and end at the current NativeModel digest.
- **Preview/approve flow.** The preview returns only `plan`, `acceptancePlanId` (`digestJson(plan)`) and `expectedWorktreeDigest`. It never returns an `acceptedChange` tuple. The approve call has to pass `acceptancePlanId` and `expectedWorktreeDigest`. The daemon recomputes the plan under the writer lock, and any change since the preview (a new HEAD commit, a re-baseline of `docs/architecture`) changes the plan id, so the approval is refused. Only a successful approval returns `acceptedChange`. Re-approving with the same `acceptancePlanId` replays the recorded tuple (`replayed: true`).
- **Record-only v2 event.** The approval appends an `architecture.changeset.accepted` event with payload `archcontext.accepted-committed-change/v2`, `operations: []`, and base ledger digest equal to the resulting one. It does not change ledger graph authority. The payload type is now a v1|v2 union. There is one event per baseline model, current model and ledger scope.
- **`apply_update` returns `journalId`.** For drafts that write `.archcontext/model/{nodes,relations,flows}/*.y(a)ml`, the pre-commit hook records a digest-only `archcontext.changeset-model-transition/v1` `{before, after}` in the existing journal `metadata_json`, so no schema migration is needed. If the evidence cannot be recorded, nothing is written.
- **CLI.** `archctx ledger accept-committed` adds a repeatable `--journal <journalId>=<changeSetId>`. `--journal-id` with `--changeset-id` stays as a one-journal shorthand. Approval uses `--approved --acceptance-plan-id <id> --expected-worktree-digest <digest>`.
- **Refusal conditions** (the full list is in `docs/runbooks/architecture-documentation-projections.md`): a broken or out-of-order chain, pending/aborted/foreign-root journals, non-UTF-8 or symlinked semantic model files, unprovable capability proofs, rejected projection entries, a flow-proof change without a journaled flow edit when the source tree, proof-relevant selector evidence or renderer version moved since the baseline, and a conflicting acceptance event at the same snapshot. The security review rounds (`6136819`, `a31c141`, `cdb4dd8`) also make HEAD anchoring ignore git replace refs and read semantic files once through one strict snapshot.

### Security fix: projection-owned journal anchor (PR #249)

`28b3287`. The accepted-committed baseline anchor used to trust any latest committed journal that wrote `docs/architecture/.projection-manifest.json`. `docs/architecture/` is on the policy write allowlist and `plan_update` accepts caller-authored `render_projection` bodies, so an approved ChangeSet could forge the anchor. Drafts planned by the daemon's projection host (docs, projection, agent-context) now get `projectionOwned: true` in journal `metadata_json` at pre-commit, and the journal anchor requires that marker.

**Upgrade impact:** journals written before this marker existed no longer anchor anything. Acceptance fails closed with `baseline-unanchored` until you either commit the manifest (a HEAD-blob anchor still works) or re-baseline with `archctx docs apply --approved`.

### Other changes since v0.5.13

- **Unowned-paths count scoped to actionable paths** (`569c2b9`, #244, closes #240): `unownedFileCount` counts an unclaimed file only when it sits under a top-level directory the model declares source in and no node excludes it. A model with no declared source keeps the whole repo in scope. `byPath` is unchanged. **Consumer-observable change:** module-statistics and refactor-assessment observations report the smaller count. On this repository the commit message records 1145 → 5.
- **Context7 hard-gate scan fails closed** (`968a6b8`, #244, closes #235): `scripts/practice-context7-readback.ts` scans every runtime-daemon file that declares each method and throws when none does. Verification-script change only.
- **Three runtime-daemon extractions**, described as move-only in their commit messages: Landscape service (`5e5a566`, #244, closes #239), Explorer projection, cache and change-feed drain (`4f87899`, #245, closes #237), and practice checkpoint baseline and coalescing (`801ebc8`, #246, closes #236). This note does not re-derive the byte-identical claims.
- `6bca4fe` (#243, repo-harness init refresh for 0.19.4) and `642a121` (handoff notes) do not touch the runtime.

## Candidate and provenance

Prepared in an isolated worktree on branch `claude/release-0600`, based on `4e21628`. It raises the package, product, lockfile, fixture, catalog, action and workflow-example version anchors from 0.5.13 to 0.6.0 (16 files, the same set as prior releases), recomputes `catalogDigest`, and regenerates the version-bound FG4/FG6 no-provider evidence. The hashes below were produced from the uncommitted candidate worktree. They are **local candidates, not published provenance**, and a published tarball must be rebuilt from the final merged main.

Every command ran with an isolated Bun 1.4.0 to satisfy `scripts/check-bun-version.mjs`.

## Verification

- `bun install --frozen-lockfile`: passes against the bumped lockfile with no changes.
- `catalogDigest`: `catalog.yaml` `productVersion` set to 0.6.0. The digest recomputed by `practices validate --strict` is `sha256:d284e2b877e9db3f5a579325cdf1a5f57b2891778a81b3b6a580f80c4ff456e7`, and re-running validation after writing it returns the same value. `bun run verify:practices`: 36 pass, 0 fail.
- `bun run readback:fg4:deterministic-conclusion` and `bun run readback:fg6:no-provider-deterministic`: `status: "verified"`, `failures: []`. Only `generatedAt` and the version-bound `modelDigest` changed.
- `bun run typecheck`: clean. `node scripts/package-boundary-audit.mjs`: passes (5 workspaces).
- `bun run verify:governance` (runs the full `bun run verify` first, then the FG3–FG6 inspections): exit 0, `status: "verified"`, 24 of 24 commands exit 0, 0 skipped. The inner `bun run verify` took 369.9s. Its `bun test` pass: 2360 pass, 1 skip, 0 fail, 2361 tests across 212 files, 13644 `expect()` calls, 344.41s. `verify:explorer` `public-maximum` durations topped out at 13.93ms against the 500ms limit on this macOS run.
- npm release dry-run (`bun scripts/fg6-npm-release-dry-run.ts run`, pack only, output and artifacts redirected outside the worktree): `status: "verified"`, `failures: []`. Local candidate `archctx-0.6.0.tgz` (523147 bytes, 88 entries) SHA-256 `d737ab8ff7f679d400fa882aee00f07d0dbfc57239b7aea2214c12c9d7855da8`, shasum `c7e537f20790b72fcc3ac8f051b614f452933126`, integrity `sha512-57qI55WuaYqRYelDwAvvdHX7KB8QVEGjbl4Yt5NnUz812Bj7LqHNIk1rDQqSORnClWjok/XT5y6+yfuu6xJkSQ==`. Local candidate `archctx-contracts-0.6.0.tgz` (94795 bytes, 180 entries) SHA-256 `ea6e708bf2d3d45f76ecb0ecfa3d4f98562ee27a79f210e3ac8a8accc52de3c5`, shasum `0ef60bf6af9b613847c0af138824eba09d90dd13`, integrity `sha512-aBy/bRJB2Dt3K4zDG4VBg1bcW2qKPrkLPI4cbHclt4FY3p5YDlllKjacP5NjChLswj6PusVuVz+OuKL1RPh1HA==`. The shasum and integrity computed locally match the values the dry-run recorded.
- Local product tarball smoke (`node scripts/local-product-tarball-smoke.mjs`, outside the worktree): exit 0. It builds its own `archctx-0.6.0.tgz` (519782 bytes, SHA-256 `8446401d736e71795d13b27ce26362e20af99de67ee68f392875b5d211584384`; this is not the dry-run artifact). The installed product reports `0.6.0`, the daemon is loopback-only, stdio MCP exposes 7 tools, and the installed CodeGraph dependency is 1.5.0. Strict practices validation passes with 41 practices, 19 sources and 8 profiles, and the catalog digest equals the value above. Reinstall keeps state and uninstall retains state.
- `npm view archctx@0.6.0` and `npm view archctx-contracts@0.6.0`: both `E404`. `latest` dist-tag is 0.5.13.

## Open before publishing

- Confirm a green Verify, including the `windows-latest` leg, on the exact commit that gets tagged.
- `npm publish`, tag and GitHub release follow only after that.

## Projection reconcile

After the bump, `archctx docs drift --profile repo-harness/v1` reports only `projection-manifest-stale` on `docs/architecture/.projection-manifest.json`, with `majorChange.mode: none`. It was applied through `archctx docs apply --approved` (`changeset.docs-release-0600-r2`, profile `repo-harness/v1`), which rewrites only the manifest; drift is clean afterwards.

A first pass in the fresh worktree ran before a CodeGraph index existed. Every flow selector then resolved as `selector-evidence-missing`, so drift falsely reported `verified-flow-proof-changed` and the generated `context.md` region would have replaced the proven sequence diagram with an unprovable notice. That output was discarded. Run `codegraph init` in a new worktree before any `docs drift|plan|apply`.
