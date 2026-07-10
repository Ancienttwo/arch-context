# Task Contract: codegraph-latest-no-bin-collision

> **Status**: Active
> **Plan**: plans/plan-20260711-0055-codegraph-latest-no-bin-collision.md
> **Task Profile**: code-change
> **Owner**: kito
> **Capability ID**: root
> **Last Updated**: 2026-07-11 01:53 CST
> **Review File**: `tasks/reviews/20260711-0055-codegraph-latest-no-bin-collision.review.md`
> **Notes File**: `tasks/notes/20260711-0055-codegraph-latest-no-bin-collision.notes.md`

## Goal

Make `archctx@latest` compatible with registry-current CodeGraph `1.4.0` without owning a conflicting global `codegraph` bin, then publish the fix as `archctx@0.2.3`, create `v0.2.3` and a GitHub Release, and prove registry/tag/release/bin metadata agree.

## Scope

- In scope:
  - root/local-runtime CodeGraph dependency and lockfile
  - adapter compatibility authority and packaged-dependency resolution
  - product-version manifest/fixture and current CLI expectations
  - generated npm package bin/files contract and focused release tests
  - local installed-tarball smoke
  - `0.2.3` version alignment across current product/release surfaces
  - npm publish after user-completed browser authorization
  - Git tag, GitHub Release, registry/bin readback, and current release evidence regeneration
- Out of scope:
  - repo-harness changes
  - floating `latest` in reproducibility-sensitive package manifests
  - capability-registry or ArchContext projection mutations to bypass the pre-existing orphan-module gate
  - global install or PATH mutation

## Workflow Inventory

- Source plan: `plans/plan-20260711-0055-codegraph-latest-no-bin-collision.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260711-0055-codegraph-latest-no-bin-collision.review.md`
- Notes file: `tasks/notes/20260711-0055-codegraph-latest-no-bin-collision.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260711-0055-codegraph-latest-no-bin-collision.md
  - tasks/todos.md
  - tasks/contracts/20260711-0055-codegraph-latest-no-bin-collision.contract.md
  - tasks/reviews/20260711-0055-codegraph-latest-no-bin-collision.review.md
  - tasks/notes/20260711-0055-codegraph-latest-no-bin-collision.notes.md
  - package.json
  - bun.lock
  - packages/local-runtime/package.json
  - packages/local-runtime/codegraph-adapter/
  - packages/contracts/src/product-version.ts
  - packages/contracts/fixtures/valid/product-version-manifest.json
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/cli/test/local-product-e2e.test.ts
  - scripts/fg6-npm-release-dry-run.ts
  - scripts/fg6-npm-release-dry-run.test.ts
  - scripts/local-product-tarball-smoke.mjs
  - scripts/architecture-ledger-al10-release-packaging-readback.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.test.ts
  - scripts/release-provenance-readback.test.ts
  - .github/workflows/archcontext-organization-runner.yml
  - actions/review-action/action.yml
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/runbooks/trusted-runner.md
  - docs/runbooks/personal-user-install.md
  - packages/cloud/package.json
  - packages/contracts/package.json
  - packages/core/package.json
  - packages/core/practice-catalog/assets/catalog.yaml
  - packages/surfaces/package.json
  - docs/verification/fg6-npm-release-dry-run.json
  - docs/verification/architecture-ledger-al10-npm-release-readback.json
  - docs/verification/fg6-release-distribution-readback.json
  - docs/verification/fg6-release-distribution.md
  - docs/verification/release-provenance-readback.json
  - docs/verification/release-provenance.md
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    tool_calls: null
    wall_time_minutes: null
  permission_scope:
    mode: inherit_allowed_paths
    writable_paths: []
    network: inherited
  roles:
    parent:
      mode: narrate_and_gatekeep
      purpose: integration_owner
    explorer:
      mode: read_only
      purpose: authoritative_version_surface_audit
    worker:
      mode: edit_within_allowed_paths
      purpose: isolated_runtime_or_packaging_implementation
    verifier:
      mode: read_only
      purpose: exit_criteria_review
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  artifacts_exist:
    - tasks/notes/20260711-0055-codegraph-latest-no-bin-collision.notes.md
  files_contain:
    - path: package.json
      pattern: '"@colbymchenry/codegraph": "1.4.0"'
    - path: packages/local-runtime/codegraph-adapter/src/index.ts
      pattern: 'REQUIRED_CODEGRAPH_VERSION = "1.4.0"'
    - path: package.json
      pattern: '"version": "0.2.3"'
    - path: packages/contracts/src/product-version.ts
      pattern: 'ARCHCONTEXT_PRODUCT_VERSION = "0.2.3"'
  tests_pass:
    - path: packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts
    - path: scripts/fg6-npm-release-dry-run.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts scripts/fg6-npm-release-dry-run.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts scripts/release-provenance-readback.test.ts
    - bun scripts/fg6-npm-release-dry-run.ts run --out /tmp/archctx-codegraph-latest-dry-run.json --artifact-dir /tmp/archctx-codegraph-latest-artifacts --json
    - node scripts/local-product-tarball-smoke.mjs
    - bun test packages/contracts/test/contracts.test.ts packages/surfaces/cli/test/cli.test.ts
  qa_scores:
    - dimension: functionality
      min: 7
  manual_checks:
    - "Evaluator review file recommends pass"
```

## Acceptance Notes (Human Review)

- Functional behavior: registry-current CodeGraph `1.4.0` passes adapter and installed-tarball flows.
- Edge cases: a custom/explicit CodeGraph binary still takes precedence; package fallback is used only for the default command when PATH has no executable.
- Regression risks: CodeGraph CLI argument/output compatibility and release readbacks that previously required `bin/codegraph.mjs`.
- Manual acceptance: generated manifest exposes only `archctx`; packaged runtime resolves its internal CodeGraph dependency without requiring an ArchContext-owned global `codegraph` bin.
- Release acceptance: registry `latest`, tarball metadata, `v0.2.3`, GitHub Release, and generated package bins agree; publish/tag/release commands are recorded in the review rather than made replayable contract commands.

## Rollback Point

- Commit / checkpoint: `b0e2d76`
- Revert strategy: revert this task's bounded diff; no data migration.
