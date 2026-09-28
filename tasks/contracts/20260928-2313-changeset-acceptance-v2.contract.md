# Task Contract: changeset-acceptance-v2

> **Status**: Active
> **Plan**: plans/plan-20260928-2313-changeset-acceptance-v2.md
> **Task Profile**: code-change
> **Workflow Profile**: strict
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-28 23:13
> **Review File**: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md`
> **Notes File**: `tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Today `ledger accept-committed` only accepts a single node rename (`packages/local-runtime/runtime-daemon/src/index.ts:1207`). Node additions, ownership changes, summary edits and relation changes can never produce an accepted event, so docs are reconciled through manual `docs apply --approved` with no accepted-projection receipt or refresh-signal delivery. #238's move-only extraction is gated on this landing first. If it ships wrong, a hand edit to `.archcontext/` could be recorded as an operator-accepted, journaled change.

## Goal

Two commits on this branch:

**A. Journal model-transition evidence.** For ChangeSet drafts whose operation paths touch `.archcontext/model/{nodes,relations,flows}/*.y(a)ml`, the daemon records a digest-only `archcontext.changeset-model-transition/v1` `{before, after}` NativeModel digest on the still-pending journal, in every write mode, from the ChangeSet pre-commit hook.
- The record is written only after a re-hash shows that non-written semantic files are unchanged and written files match the op bodies.
- Any check failure or loader error records nothing and never fails or alters the apply result.
- `apply_update` returns `journalId`.

**B. v2 committed-change acceptance.** `acceptCommittedChange` takes an explicit ordered list of 1–32 `{journalId, changeSetId}` pairs and works as preview/approve (`acceptancePlanId = digestJson(plan)`, recomputed under the writer lock on approve). It accepts only when all of these hold:
- the digest chain holds: first before == manifest `semanticBaseline.digests.modelDigest`, consecutive after == next before, last after == current NativeModel digest;
- every journal is committed, in the same canonical root, and wrote at least one semantic file;
- `committedAt` is non-decreasing;
- majorChange mode is `human-action-required`;
- there are no rejected projection entries and no unprovable p1/p2 proof;
- accepted reason codes and affected ids exactly equal the observed ones;
- a proof-only change is explained by a journaled flow or semantic edit.

The payload is `archcontext.accepted-committed-change/v2` (same eventType, `operations: []`, base == resulting ledger graph digest). It records:
- the chain;
- `fileSetDigest`;
- baseline/current digests;
- `directlyEditedNodeIds` / `affectedAncestorNodeIds` / `carriedNodeIds`;
- `acceptancePlanId`;
- `authority: "yaml"`.

The v1 payload stays valid in a v1|v2 union, and recorded v1 events are untouched. `AcceptedArchitectureChangeReferenceV1` is unchanged. The old four-field RPC input returns `AC_SCHEMA_INVALID`. The CLI keeps `--journal-id/--changeset-id` as a one-journal shorthand, adds repeatable `--journal <journalId>=<changeSetId>`, and runs a preview when `--approved` is absent.

## Scope

- In scope:
  - Commits A and B above.
  - Pure acceptance helpers in a new module (e.g. `runtime-daemon/src/committed-change-acceptance.ts`), not in `index.ts`.
  - Store + TestLocalStore support.
  - Tests.
  - The runbook update.
  - Closing the `tasks/todos.md` row "Semantic acceptance for committed YAML ChangeSets beyond node renames".
  - A new deferred row for opt-in local consumer-side event verification.
- Out of scope:
  - consumer-side event resolution (the cross-repository v1 protocol treats `acceptedChange` as opaque; see `plans/plan-20260925-1345-remaining-audit-issues.md:443`);
  - MCP exposure;
  - ledger graph authority promotion;
  - the #238 extraction itself.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

The direction is wrong if either holds:
- the manifest `semanticBaseline.digests.modelDigest` is not `digestJson(loadNativeModelFromArchContext(root))`, so the chain cannot be anchored;
- a legitimate single ownership-only ChangeSet cannot satisfy the chain.

Cheapest proof point, before any edit: in a temp copy of this repo, compare the manifest baseline modelDigest with the live NativeModel digest.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear as a `package_test` check in Verification Plan).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260928-2313-changeset-acceptance-v2.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md`
- Notes file: `tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

`packages/core/projection-engine/{src,test}/` added 2026-09-29 (security review round 1): transition evidence must parse the exact bytes it hashes, which needs an in-memory NativeModel loader.

```yaml
allowed_paths:
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md
  - tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md
  - tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md
  - packages/local-runtime/runtime-daemon/src/
  - packages/local-runtime/runtime-daemon/test/
  - packages/local-runtime/local-store-sqlite/src/
  - packages/local-runtime/local-store-sqlite/test/
  - packages/core/architecture-ledger/src/
  - packages/core/architecture-ledger/test/
  - packages/core/changeset-engine/src/
  - packages/core/changeset-engine/test/
  - packages/core/projection-engine/src/
  - packages/core/projection-engine/test/
  - packages/surfaces/cli/src/
  - packages/surfaces/cli/test/
  - tests/
  - docs/runbooks/architecture-documentation-projections.md
```

## Evidence Requirements

```yaml
evidence_requirements:
  # Set benchmark to required when this contract consumes the harness profile benchmark matrix.
  benchmark: not_applicable
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    runner_invocations: null
    wall_time_minutes: null
  permission_scope:
    mode: inherit_allowed_paths
    writable_paths: []
    network: inherited
  roles:
    parent:
      mode: narrate_and_gatekeep
      purpose: approval_checkpoint_owner
    explorer:
      mode: read_only
      purpose: codebase_research
    worker:
      mode: edit_within_allowed_paths
      purpose: implementation
    verifier:
      mode: read_only
      purpose: exit_criteria_review
  runner:
    preferred:
      - subagent
    fallback: null
    brief_is_authoritative: true
```

## Exit Criteria (Machine Verifiable)

This block contains only non-executable artifact requirements. Define every
executable check once in the canonical Verification Plan below. Each check must
state its phase, cost, evidence policy, necessity, and input environment; a
missing or malformed plan fails closed. Populate artifact requirements only
for deliverables this task actually owns; do not create a spec, notes or report
merely to fill this template.

```yaml
exit_criteria:
  files_exist: []
  artifacts_exist: []
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "typecheck",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun run typecheck",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "New acceptance module, payload union, RPC and CLI shapes must compile on the pinned toolchain.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "package-boundary-audit",
      "kind": "command",
      "command": "node scripts/package-boundary-audit.mjs",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "New module and store methods must keep workspace package boundaries valid.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "affected-tests",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test --timeout 60000 packages/local-runtime/runtime-daemon packages/local-runtime/local-store-sqlite packages/core/architecture-ledger packages/core/changeset-engine packages/surfaces/cli tests",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Covers transition recording, acceptance chain positives/negatives, RPC wire shape, CLI preview/approve and projection receipt end to end.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "full-test",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test --timeout 60000",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Apply-path change touches every write mode; the full suite guards unrelated consumers.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "packaged-cli-smoke",
      "kind": "command",
      "command": "node scripts/packaged-cli-smoke.mjs",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The packaged CLI and daemon must still start with the new RPC shape.",
      "inputs": {
        "env": []
      }
    }
  ]
}
```

Author the actual checks using [Testing Policy and Artifact Standards](../../docs/reference-configs/sprint-contracts.md#testing-policy-and-artifact-standards).
The empty array is not permission to omit required repository checks: retain it
only when no executable criterion applies and explain why in Acceptance Notes.
Prefer existing covering tests; creating a task-named test or adding typecheck
is not a template requirement. For each selected check declare `id`, `kind`,
`cwd`, `phase`, `cost`, `evidence_policy`, `necessity`, `inputs.env`, and its
`command` or `path`. Declare the same execution once, including checks nested
inside aggregate scripts. Use `baseline_with_delta` only with an immutable
baseline and named current delta checks; never infer it from paths or command text.

## Acceptance Notes (Human Review)

- Changed behavior/boundary, existing covering tests and remaining gap:
- New test case/file rationale, or why existing coverage is sufficient:
- Selected check IDs and why their coverage is sufficient; omitted coverage:
- Full/expensive check justification and expected cost, if applicable:
- Execution/baseline references, subject, current delta and disposition:
- Residual risks and incomplete observations:

## Rollback Point

- Commit / checkpoint: base `a4cc94b` (main).
- Revert strategy: `git revert` of the PR. Transition records are additive journal metadata that older code ignores; v2 events are record-only (`operations: []`) and grant no ledger graph authority. Any SQLite change must be additive and documented in the notes file.
