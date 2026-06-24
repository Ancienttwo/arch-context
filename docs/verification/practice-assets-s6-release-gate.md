# Practice Assets S6 Release Gate

## Status

This document is the S6 release-gate evidence ledger. The catalog-scale and
eval/quality gates are verified; performance, packaging, cross-platform, docs,
rollout, and release gates remain pending.

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

- Practice Top-3 recall: 100.0%, threshold >= 92.0%.
- Context constraint recall: 100.0%, threshold >= 95.0%.
- Context irrelevant ratio: 4.4%, threshold <= 15.0%.
- Benign precision: 100.0%, threshold >= 95.0%.
- No-keyword structural recall: 100.0%, threshold >= 85.0%.
- Heuristic-only hard-gate rate: 0.0%.
- Dynamic-doc hard-gate rate: 0.0%.
- Invalid/tampered waiver rejection: 100.0%.

## Verified Commands

- `bun test packages/core/practice-catalog/test/practice-catalog.test.ts`
- `bun test scripts/practice-assets-s6-catalog-readback.test.ts`
- `bun test scripts/practice-assets-s6-eval-readback.test.ts`
- `bun run record:s6:catalog`
- `bun run readback:s6:catalog`
- `bun run record:s6:eval`
- `bun run readback:s6:eval`
- `bun packages/surfaces/cli/src/main.ts practices validate --strict`
- `bun run verify:practices`
- `bun evals/run.ts --check`
- `bun run typecheck`
- `git diff --check`
- `bun run verify`

## Pending S6 Gates

- Performance and reliability gates: S6-23 through S6-28.
- Packaging and cross-platform gates: S6-29 through S6-33.
- Documentation, operations, rollout, and final release signoff: S6-34 through
  S6-40 and S6-EG1 through S6-EG7.
