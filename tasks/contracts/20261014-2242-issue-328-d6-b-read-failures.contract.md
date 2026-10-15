# Task Contract: issue-328-d6-b-read-failures

> **Status**: Local integration verified; hosted CI pending
> **Plan**: plans/plan-20261014-2242-issue-328-d6-b-read-failures.md
> **Task Profile**: code-change
> **Owner**: D6-B sole implementation writer, delegated Codex thread
> **Capability ID**: capability-architecture-context
> **Review File**: tasks/reviews/20261014-2242-issue-328-d6-b-read-failures.review.md
> **Notes File**: tasks/notes/20261014-2242-issue-328-d6-b-read-failures.notes.md

## Goal and Scope

Implement only docs anchors and flows check direct/CLI failure exits, prepared from 550ae58b
and first delivered incrementally on main 71d8b65b6efe0be2daee26608cc37c02baeba6d5.
The coordinator now authorizes merging the already accepted 31bbc3bbd5714a84776ec1c419c44e2d5db79603
into this same B branch: identity fix and accepted CI configuration only, without unmerged C1.
The plan's frozen failure/compatibility table and delivery boundary are authoritative. This is
incremental B delivery after #356 merged, with no duplicated A commits. Preserve all
success/value APIs, D5 discovery and existing CodeGraph behavior; do not edit A's checkout.
Coordinator-directed amendment: use one anchors entrypoint/adapter for standalone and debt calls.
Unknown nested anchors failures may use actual producer stage docs-anchors as an expected B change.
Preserve known code/action/reason/retryability, success reports/digests/coverage and discovery;
close once and never replace the primary producer refusal with cleanup failure. No debt-only
legacy branch, new error family or global writer legacy edit.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20261014-2242-issue-328-d6-b-read-failures.md
  - tasks/contracts/20261014-2242-issue-328-d6-b-read-failures.contract.md
  - tasks/notes/20261014-2242-issue-328-d6-b-read-failures.notes.md
  - tasks/reviews/20261014-2242-issue-328-d6-b-read-failures.review.md
  - packages/contracts/src/failure.ts
  - packages/local-runtime/runtime-daemon/src/producer-failure.ts
  - packages/local-runtime/runtime-daemon/src/architecture-debt.ts
  - packages/local-runtime/runtime-daemon/src/docs-anchors.ts
  - packages/local-runtime/runtime-daemon/src/flow-selector-check.ts
  - packages/surfaces/cli/src/main.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/local-runtime/runtime-daemon/test/read-failure-boundaries.test.ts
  - packages/surfaces/cli/test/docs-anchors.test.ts
  - packages/surfaces/cli/test/failure-envelope.test.ts
  - packages/surfaces/cli/test/cli.test.ts
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "d6-b-affected",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify two stateless reader failure boundaries, existing strict metadata/privacy, D5 discovery and A producer compatibility.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun run typecheck && node scripts/package-boundary-audit.mjs && bun test --timeout 60000 packages/contracts/test/failure-envelope.test.ts packages/local-runtime/runtime-daemon/test/read-failure-boundaries.test.ts packages/local-runtime/runtime-daemon/test/architecture-debt-read-inputs.test.ts packages/local-runtime/runtime-daemon/test/complete-architecture-debt.test.ts packages/surfaces/cli/test/docs-anchors.test.ts packages/surfaces/cli/test/architecture-debt.test.ts packages/surfaces/cli/test/failure-envelope.test.ts"
    },
    {
      "id": "d6-b-flow-success",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Complete CLI contract and accepted-main daemon upgrade identity/RPC version test files, including real CodeGraph flow success; no name filtering, no timeout increase.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "bun test --timeout 60000 packages/surfaces/cli/test/cli.test.ts packages/surfaces/cli/test/daemon-upgrade-identity.test.ts packages/surfaces/cli/test/rpc-version-upgrade.test.ts"
    },
    {
      "id": "d6-b-packaged",
      "kind": "command",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify the bundled Node CLI still builds and preserves byte-bound output.",
      "inputs": {
        "env": [
          "DO_NOT_TRACK",
          "CODEGRAPH_NO_DOWNLOAD",
          "ARCHCONTEXT_STATE_DIR"
        ]
      },
      "command": "node scripts/packaged-cli-smoke.mjs"
    }
  ]
}
```

## Acceptance and Stop Conditions

Strict known/unknown/mutated metadata and cleanup failures must pass direct and selected CLI
regressions without secret output. Preserve success/coverage/probe/reader-close semantics.
Stop on an A repair, competing writer or required excluded-file edit. The coordinator confirmed
A merged and authorized the accepted-main route, affected checks, independent review, ordinary
push and Draft PR. No self-merge, issue closure or C/D implementation. B does not complete D6/#328.

## Rollback

Revert only the B stages/adapter extraction/two reader/CLI/test slice. No state or model migration.

## Accepted-main integration evidence

On 0b56e067ee84b4c4db3fc6b52ce79a3712bfb646, all three checks above passed: 62 affected
tests / 1732 assertions, 119 complete CLI/identity/version tests / 2188 assertions, typecheck,
five-workspace boundary audit and packaged native-context/CLI smoke. Source/test hashes stayed
unchanged through verification. Full hosted CI for the final pushed B HEAD remains mandatory;
#358 diagnostic non-reproduction does not satisfy that gate.
