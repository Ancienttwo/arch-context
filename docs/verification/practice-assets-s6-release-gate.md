# Practice Assets S6 Release Gate

## Status

This document is the S6 release-gate evidence ledger. The catalog-scale,
eval/quality, performance/reliability, package-manifest, local no-cloud, and
local tarball lifecycle gates are verified. The cross-platform PR CI matrix is
also verified. Documentation, operations, rollout controls, independent disable,
central Hook, rollback, session stale, and cache purge gates are verified for
Practice Assets v1.

## Catalog Scale Gate

### P1 Map

The catalog-scale boundary is the built-in static practice catalog, not repo
overlays or dynamic documentation.

- Asset loader: `packages/core/practice-catalog/src/index.ts`
- Practice assets: `packages/core/practice-catalog/assets/practices/`
- Profile assets: `packages/core/practice-catalog/assets/profiles/`
- Source registry: `packages/core/practice-catalog/assets/sources/`
- Static manifest: `packages/core/practice-catalog/assets/catalog.yaml`
- CLI validation surface: `archctx practices validate --strict`
- Release readback surface:
  `scripts/practice-assets-s6-catalog-readback.ts` and
  `docs/verification/practice-assets-s6-catalog-readback.json`

Out of scope for this slice: performance gates, packaged product OS matrix,
rollout flags, and final release signoff.

### P2 Trace

The verified path is:

1. `loadPracticeCatalog({ includeRepoOverlay: false })` reads built-in
   practices, profiles, and source records.
2. Practice source refs are validated against the source registry.
3. Built-in profile include refs are validated against the built-in asset
   registry. This preserves repo overlay disable semantics while still catching
   broken profile definitions in the shipped catalog.
4. The loader computes deterministic asset digests, source IDs, manifest
   entries, and the catalog digest.
5. `packages/core/practice-catalog/assets/catalog.yaml` is compared byte-shape
   against the generated manifest.
6. `scripts/practice-assets-s6-catalog-readback.ts` records and inspects the
   catalog gate packet. The inspector rejects undersized catalogs, missing
   category negative scope, missing profiles, missing required sources,
   reference-only source use, provenance gaps, unsuperseded deprecated assets,
   and stale static manifests.

The output side effect is
`docs/verification/practice-assets-s6-catalog-readback.json`, which records 41
total practices, 40 active practices, 8 profiles, 19 source records, at least 4
active practices in each category, zero provenance gaps, and a static manifest
match.

### P3 Decision

The current catalog loader exists as a deterministic static asset path with repo
overlays layered later. The S6 change keeps that invariant: the shipped catalog
can grow and gain profiles without allowing repo overlays to invalidate built-in
profile definitions. New practice matches default to declared evidence for
recommendation, which keeps scale growth from crowding existing heuristic eval
results.

At 10x scale, the first failure point would be unreviewed catalog growth or a
stale generated manifest. The chosen gate makes those failures deterministic:
counts, category coverage, source license posture, provenance completeness,
deprecation lineage, and manifest freshness all fail closed before release.

## Source Pinning

- Required built-in source records are present for MADR, Backstage, ArchUnit,
  Structurizr DSL, Twelve-Factor, OpenTelemetry, Kubernetes, and OpenSSF.
- Structurizr DSL is pinned as `LicenseRef-Structurizr-Docs`, level B,
  built-in with attribution.
- Twelve-Factor is pinned from `https://github.com/heroku/12factor` as MIT,
  level A, built-in with attribution.
- Kubernetes documentation is pinned from
  `https://github.com/kubernetes/website` as CC-BY-4.0, level B, built-in with
  attribution.
- OWASP Cheat Sheet Series and arc42 are retained as reference-only
  ShareAlike sources. No built-in practice references them.

## Eval Dataset And Quality Gate

### P1 Map

The S6 eval boundary is the deterministic practice/retrieval/enforcement eval
surface, not a hosted service, model prompt, or dynamic documentation fetch.

- Eval runner: `evals/run.ts`
- Practice positive datasets:
  `evals/practices/structural-positive.jsonl` and
  `evals/practices/no-keyword-structural-positive.jsonl`
- Practice negative datasets:
  `evals/practices/benign-negative.jsonl`,
  `evals/practices/keyword-heavy-benign-negative.jsonl`, and
  `evals/practices/budget-irrelevant-resource.jsonl`
- Enforcement/waiver adversarial dataset:
  `evals/practices/enforcement-waiver-adversarial.jsonl`
- Context budget dataset:
  `evals/context-budget/{cases,documents}.jsonl`
- Readback surface:
  `scripts/practice-assets-s6-eval-readback.ts` and
  `docs/verification/practice-assets-s6-eval-readback.json`
- Human-readable report:
  `docs/verification/m6-representative-eval-report.md`

Out of scope for this slice: 100-asset warm-load performance, hook latency,
cache corruption recovery, SQLite/daemon upgrade behavior, package manifests,
OS installer matrix, rollout flags, and final release signoff.

### P2 Trace

The verified path is:

1. `evals/run.ts` loads labeled JSONL fixtures and calls shipping exports:
   `practice-engine.matchPracticesForTask`, `retrieval.runRetrievalEval`,
   `practice-engine.evaluatePracticeEnforcement`, and waiver validation.
2. Practice positive fixtures pass real `symbols`, `edges`, and observed
   evidence into `detectArchitecturePressure` and `matchPracticesForTask`.
3. Negative fixtures exercise docs/tests/fixtures, keyword-heavy benign text,
   and budget/irrelevant-resource cases. The gate counts a benign failure only
   when a negative produces non-advisory enforcement.
4. No-keyword structural positives assert that task text does not contain the
   expected practice candidate terms; the match must come from structural
   context and observed evidence.
5. Adversarial fixtures exercise complete-enforcement policy with
   heuristic-only matches, external-dynamic source trust, expired/tampered
   waivers, wrong checks, wrong practice IDs, wrong subjects, invalid digests,
   empty scopes, and vague reasons.
6. The runner computes S6 metrics and keeps `--check` read-only. `bun evals/run.ts`
   regenerates the Markdown report; `bun run record:s6:eval` records the JSON
   readback packet.

The output side effects are
`docs/verification/m6-representative-eval-report.md` and
`docs/verification/practice-assets-s6-eval-readback.json`. The readback records
60 positive cases, 80 negative cases, 20 adversarial cases, 160 total
scenarios, 50 Chinese or mixed Chinese/English cases, 30 no-keyword structural
positives, 30 keyword-heavy benign negatives, 20 budget/irrelevant resource
cases, and zero dataset metadata/evidence/enforcement-ceiling violations.

### P3 Decision

The practice catalog remains evidence-led rather than prompt-led. The eval
therefore records expected practice IDs, expected evidence minimum, prohibited
IDs, and expected enforcement ceiling on every practice dataset record. New
positive fixtures use observed code-context evidence instead of changing
`NormalizedCodeContext` to invent a declared-evidence state that the current
contract does not expose.

At 10x scale, the first failure point would be fixture labels drifting from
what the matcher can prove from code facts, or benign keyword-heavy cases
becoming non-advisory gates. The chosen readback fails those conditions
deterministically through metadata completeness, prohibited ID checks, evidence
minimum checks, enforcement ceiling checks, and non-advisory negative counting.

### Verified Metrics

- Practice Top-3 recall: 93.3%, threshold >= 92.0%.
- Context constraint recall: 100.0%, threshold >= 95.0%.
- Context irrelevant ratio: 4.4%, threshold <= 15.0%.
- Benign precision: 100.0%, threshold >= 95.0%.
- No-keyword structural recall: 96.7%, threshold >= 85.0%.
- Heuristic-only hard-gate rate: 0.0%.
- Dynamic-doc hard-gate rate: 0.0%.
- Invalid/tampered waiver rejection: 100.0%.

## Performance And Reliability Gate

### P1 Map

The S6 runtime gate proves the local practice runtime path under 100 repo
overlay assets. It is not a dynamic documentation, hosted service, or cloud
control-plane gate.

- Catalog loader: `packages/core/practice-catalog/src/index.ts`
- Practice matcher: `packages/core/practice-engine/src/index.ts`
- Context compiler path:
  `packages/core/context-compiler/src/index.ts`
- Checkpoint path:
  `packages/core/application/src/index.ts` and
  `packages/local-runtime/runtime-daemon/src/index.ts`
- SQLite state path:
  `packages/local-runtime/local-store-sqlite/src/index.ts`
- Contract and schema:
  `packages/contracts/src/practices.ts` and
  `schemas/runtime/practice-checkpoint.schema.json`
- Readback surface:
  `scripts/practice-assets-s6-runtime-readback.ts` and
  `docs/verification/practice-assets-s6-runtime-readback.json`

Out of scope for this slice: packaged tarball manifests, OS install/uninstall
matrices, local no-cloud product E2E, Context7 optional packaging, rollout
flags, and runbook drills.

### P2 Trace

The verified path is:

1. The readback creates a temporary repo with 100 repo overlay practices plus
   the built-in catalog, producing 141 effective practices.
2. `loadPracticeCatalog({ root })` is warmed and sampled 12 times. The p95 is
   recorded against the S6 50ms threshold.
3. `matchPracticesForTask` is run against a fixed observed code context and
   pressure signal. The p95 is recorded against the S6 150ms threshold.
4. `createStartedDaemon(...mock codegraph...)` runs `init -> prepare ->
   checkpoint` with unique hook tool call IDs so each sample executes analysis
   instead of using coalescing. The checkpoint hook must report
   `egress:"none"` and `network:"forbidden"`.
5. Catalog corruption is reproduced with an invalid repo overlay. The catalog
   validation surface returns typed practice issues and recovers after removing
   the invalid file.
6. SQLite cache/store corruption is reproduced with an invalid target
   `runtime.sqlite`. Migration inspection returns `target-incomplete`; migration
   fails with a clear repair/delete recovery action instead of silently reading
   corrupted state.
7. Legacy SQLite migration starts from a valid legacy DB, migrates forward to
   the current schema, then adds an unknown future table. The current daemon
   migration path safely ignores the unknown table and still reports
   `target-current`.
8. Daemon stale-catalog behavior is reproduced through persisted checkpoint
   state: prepare stores a baseline, the stored baseline is changed to an older
   catalog digest, and a restarted daemon checkpoint returns
   `reasonCode:"stale-catalog"` with `fresh:false`.

The output side effect is
`docs/verification/practice-assets-s6-runtime-readback.json`, which records
catalog warm p95 16.362ms, matching warm p95 2.894ms, checkpoint warm p95
30.904ms, zero network dependency, typed catalog/cache recovery, forward and
backward-compatible SQLite migration behavior, and explicit stale-catalog
detection.

### P3 Decision

The existing runtime intentionally recomputes catalog guidance during prepare
and checkpoint instead of treating guidance as a long-lived daemon-global
cache. The S6 gate preserves that correctness shape and adds a contract-level
staleness reason for the only missing state transition: same worktree and head,
but changed catalog digest after daemon upgrade.

At 10x scale, the first failure point would be synchronous catalog file loading
or repeated matcher document construction inside checkpoint. The chosen gate
measures those costs separately before measuring the complete hook path, so a
future regression fails at the responsible boundary. The `stale-catalog`
extension is the smallest coherent contract change because checkpoint already
records both current and baseline catalog digests; it only makes the mismatch
machine-visible.

## Packaging And Local Product Gate

### P1 Map

The packaging boundary is the generated one-package `archctx` tarball, not the
workspace checkout or private workspace packages.

- Release stage builder:
  `scripts/fg6-npm-release-dry-run.ts`
- Installed product smoke:
  `scripts/local-product-tarball-smoke.mjs`
- Local no-cloud first-experience readback:
  `scripts/fg6-local-no-cloud-readback.ts` and
  `scripts/local-no-cloud-e2e.mjs`
- Practice assets:
  `packages/core/practice-catalog/assets/`
- JSON schemas:
  `schemas/`
- Release evidence:
  `docs/verification/fg6-npm-release-dry-run.json`,
  `docs/verification/fg6-local-product-tarball-smoke.json`, and
  `docs/verification/fg6-local-no-cloud-readback.json`

Out of scope for this slice: README/runbook docs, rollout flags, and live npm
publish.

### P2 Trace

The verified path is:

1. The release stage builds `packages/surfaces/cli/src/main.ts` into
   `bin/archctx.mjs` with a Node shebang. `@node-rs/jieba` is externalized and
   declared as a runtime dependency so native tokenizer bindings resolve from
   npm rather than from the checkout.
2. The stage copies the built-in practice catalog to `assets/`, copies JSON
   schemas to `schemas/`, and generates `NOTICE.md` from the bundled source
   registry.
3. `npm pack --json` and `npm pack --dry-run --json` produce the distribution
   manifest. The inspector fails if catalog files, source registry files,
   required schemas, attribution notice, source license, source digest, or
   source attribution are missing.
4. The installed tarball smoke installs the generated tarball into a temporary
   npm project, hides Bun from `PATH`, runs the installed `archctx` bin, starts
   the loopback daemon, runs `init -> sync -> practices validate -> prepare`,
   exercises MCP tools, reinstalls the tarball as an upgrade simulation, then
   uninstalls the package while verifying runtime state remains outside the
   package install directory.
5. The local no-cloud E2E runs
   `doctor -> paths -> mcp install -> init -> sync -> practices validate ->
   context -> prepare -> status -> checkpoint -> complete -> review` with
   GitHub, Cloud, and LLM provider env removed.

The output side effects record 66 release tarball entries, 13 practice files, 1
profile file, 19 source records, 43 schema files, zero missing attribution,
zero missing digests, zero missing license records, strict installed catalog
validation with 41 practices / 19 sources / 8 profiles, and retained runtime
state after uninstall.

### P3 Decision

The product boundary is a Node-only local CLI distribution. It must not depend
on the workspace, Bun, GitHub App, Cloud account, LLM provider, or Context7 for
Local Core. The non-obvious packaging constraint is the native Chinese
tokenizer: bundling it into one file breaks platform native binding resolution,
so the release keeps `@node-rs/jieba` as an explicit npm dependency while still
excluding Context7 from required dependencies.

At 10x scale, the first packaging failure would be a manifest omission: a
checkout smoke could pass while the tarball lacks assets, schemas, or notices.
The chosen gate makes the tarball manifest authoritative and checks installed
runtime behavior from the generated package, which is the smallest coherent
change because it reuses the existing release stage instead of adding a second
packaging path.

## Cross-Platform CI Matrix Gate

PR #36 (`codex/practice-assets-s6-packaging-gates`) verified the packaged
product path on GitHub Actions run `28070573588` at head
`713806d0c50101ec48dd76d11b3811ac0b558dc0`.

- Governance Verify: passed.
- `ubuntu-latest` / Node 24.x: passed.
- `ubuntu-latest` / Node 25.x: passed.
- `macos-latest` / Node 24.x: passed.
- `macos-latest` / Node 25.x: passed.
- `windows-latest` / Node 24.x: passed.
- `windows-latest` / Node 25.x: passed.

This closes S6-30 and S6-EG3 for the packaging branch: the same verify workflow
ran the installed local product tarball smoke, no-cloud E2E, sprint status
check, and platform IPC permission readback across the release OS matrix.

## Documentation And Operations Gate

### P1 Map

The docs/ops boundary is the user-facing Practice Assets v1 operating surface,
not a new runtime decision path.

- README trust boundary: `README.md`
- Practice Assets runbook: `docs/runbooks/practice-assets-v1.md`
- Upgrade/rollback runbook: `docs/runbooks/upgrade-rollback.md`
- Central Hook policy: `.ai/hooks/README.md`
- S6 docs/ops readback:
  `scripts/practice-assets-s6-docs-ops-readback.ts`,
  `docs/verification/practice-assets-s6-docs-ops-readback.json`, and
  `docs/verification/practice-assets-s6-docs-ops-readback.md`
- Source evidence reused by the readback:
  `docs/verification/practice-hook-egress-readback.json`,
  `docs/verification/practice-context7-readback.json`,
  `docs/verification/practice-assets-s4-enforcement-gate.md`,
  `docs/verification/practice-assets-s6-catalog-readback.json`,
  `docs/verification/practice-assets-s6-runtime-readback.json`,
  `docs/verification/fg6-npm-release-dry-run.json`,
  `docs/verification/fg6-local-product-tarball-smoke.json`, and
  `docs/verification/fg6-rollback-compat-readback.json`

Out of scope: design-partner, opt-in beta, team collaboration, or production
rollout telemetry. Those require separate external rollout packets.

### P2 Trace

The verified path is:

1. README separates Static Practice Assets from Dynamic Documentation
   References and states that Local Core sends no source body, diff, prompt,
   model output, secret, or unredacted path to Context7 by default.
2. The Practice Assets runbook documents repo practice authoring, enforcement
   promotion through `.archcontext/policies/practices.yaml`, ChangeSet-backed
   waivers, central Hook setup, Context7 pin/fetch/purge privacy, source update,
   license incident, false-positive rollback, quarterly owner review, feature
   flags, and staged rollout readback.
3. The upgrade/rollback runbook binds package release, rollback, catalog
   revision, stale session, and cache purge drills to concrete commands.
4. The docs/ops readback inspects the documentation plus existing S3/S4/S5/S6
   evidence. It verifies enforcement can be set to advisory independently,
   Context7 is default-disabled and failure-matrix safe, Codex has a
   central-first `repo-harness-hook` readback, package release and local tarball
   lifecycle evidence are green, stale catalog detection is green, and
   `archctx docs purge --all` is documented with a runtime purge command.

The side effects are
`docs/verification/practice-assets-s6-docs-ops-readback.json` and
`docs/verification/practice-assets-s6-docs-ops-readback.md`, both verified.
This closes S6-34 through S6-40 and S6-EG5 through S6-EG7 for the Practice
Assets v1 documentation, operations, rollout controls, central Hook, rollback,
session stale, and cache purge boundary.

### P3 Decision

The S6 docs/ops gate keeps operational truth inspectable instead of treating
documentation as prose-only release evidence. The invariant is that Static
Practice Assets remain local, deterministic, provenance-bound, and advisory by
default, while Context7 stays optional, external, unverified, and advisory-only.

At 10x scale, the first failure point would be drift between product behavior
and runbooks: users could promote enforcement or fetch external docs without a
bounded rollback path. The chosen gate makes docs executable enough to fail
closed while reusing existing runtime/readback evidence, which is the smallest
coherent change because it does not add another policy engine or rollout system.

## Residual S1/S2 Closure

The final release branch also closes the earlier scoped partials that were left
in the sprint ledger:

- `PracticeOverlayV1` and `schemas/repo/practices/practice.schema.json` now
  include `overlay.expiresAt`.
- `loadPracticeCatalog` rejects expired repo overlays and exact override
  revision rollback with typed errors.
- `matchPracticesForTask` filters candidate assets by asset repository kind,
  language, framework, path/node scope, and matching profile include/exclude
  sets before retrieval scoring.
- `docs/verification/practice-assets-acceptance-ledger.json` records Practice
  Assets sprint acceptance evidence and is verified by
  `scripts/verify-practice-assets-acceptance-ledger.mjs`.

## Verified Commands

- `bun test packages/core/practice-catalog/test/practice-catalog.test.ts`
- `bun test packages/core/practice-engine/test/practice-engine.test.ts`
- `bun test scripts/practice-assets-s6-catalog-readback.test.ts`
- `bun test scripts/practice-assets-s6-eval-readback.test.ts`
- `bun test scripts/practice-assets-s6-runtime-readback.test.ts`
- `bun test scripts/practice-assets-s6-docs-ops-readback.test.ts`
- `bun test scripts/fg6-npm-release-dry-run.test.ts scripts/fg6-local-no-cloud-readback.test.ts`
- `bun test packages/core/application/test/control-loop.test.ts packages/contracts/test/contracts.test.ts`
- `bun run record:s6:catalog`
- `bun run readback:s6:catalog`
- `bun run record:s6:eval`
- `bun run readback:s6:eval`
- `bun run record:s6:runtime`
- `bun run readback:s6:runtime`
- `bun run record:s6:docs-ops`
- `bun run readback:s6:docs-ops`
- `bun run verify:practice-assets-acceptance-ledger`
- `bun run readback:fg6:npm-release-dry-run`
- `bun scripts/fg6-npm-release-dry-run.ts inspect --evidence docs/verification/fg6-npm-release-dry-run.json --json`
- `bun run readback:fg6:local-no-cloud`
- `bun scripts/fg6-local-no-cloud-readback.ts inspect --evidence docs/verification/fg6-local-no-cloud-readback.json --json`
- `bun run readback:fg6:local-product-tarball`
- `bun packages/surfaces/cli/src/main.ts practices validate --strict`
- `bun run verify:practices`
- `bun evals/run.ts --check`
- `bun run typecheck`
- `git diff --check`
- `bun run verify`

## Pending S6 Gates

None for Practice Assets v1. Collaboration rollout telemetry remains a separate
future acceptance surface and is not claimed by this S6 release gate.
