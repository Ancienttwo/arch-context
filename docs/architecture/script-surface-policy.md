# Script Surface Policy

> **Status**: Active
> **Owner**: Governance Verify
> **Verification**: `bun test scripts/governance-verify-workflow.test.ts`

## Purpose

The root `scripts/` directory is an executable governance, verification, release, and evidence-readback surface. It is not a scratch directory. A script can be transitional in implementation detail, but it is not removable until its ownership surface and evidence role are gone or superseded.

This policy prevents two failure modes:

- deleting a historical readback script that still anchors `docs/verification/` or the acceptance ledger;
- keeping milestone scripts forever without a visible owner, command, import, or readback reference.

## Ownership Surfaces

Every non-test file under `scripts/` must be owned by at least one of these surfaces:

| Surface | Meaning | Typical owner |
|---|---|---|
| `package.json` command | A developer-facing or release-facing root command invokes the script | Root command surface |
| GitHub workflow | CI invokes the script directly or uploads its artifact | Workflow contract |
| Script import | Another script imports it as a shared helper or fixture producer | Importing script |
| `docs/verification/` | Historical or current evidence names the script as the readback mechanism | Verification evidence |
| `docs/runbooks/` | Operator documentation names the script as an operational command | Runbook owner |
| acceptance ledger | `docs/verification/acceptance-ledger.json` records the script as evidence | Acceptance owner |

Tests alone are not an ownership surface. A tested script with no command, import, runbook, or evidence reference is still a cleanup candidate.

## Cleanup Rules

- Do not delete or move a script only because its milestone is complete. Evidence scripts can remain valid historical readback surfaces after the feature ships.
- Do not preserve root `package.json` aliases only for convenience after a milestone has closed. If the evidence remains discoverable from `docs/verification/`, the root command can be removed in a focused cleanup.
- Root `record:*` and `readback:*` aliases must be referenced outside `package.json`. If no runbook, evidence, workflow, plan, or script names the alias, use the direct script command instead of keeping a root alias.
- Do not add compatibility wrappers, duplicate scripts, or best-effort aliases to keep old command names alive unless an approved migration contract names the compatibility window.
- Shared helpers should stay small and imported by name. If a helper grows into a standalone command, give it a command or a runbook entry.
- Any script that touches `_ops/`, external services, publishing, deployment, or hosted evidence must make that dependency explicit in its command name, runbook, or verification document.

## Deletion Gate

Before deleting a script:

1. Confirm it has no `package.json`, workflow, import, verification doc, runbook, or acceptance-ledger reference.
2. If it has a root command but the command is obsolete, remove the command and keep or update the evidence reference in the same change.
3. If it has evidence references, delete it only when the evidence is superseded by a newer accepted artifact and the ledger/docs are updated in the same change.
4. Run `bun test scripts/governance-verify-workflow.test.ts`.
5. Run the narrow test for the owning area, then `bun run verify:governance` before merge.

Rollback is path-level: restore the script and any command/doc/ledger references removed in the cleanup change.

## Current Boundary

This policy does not require moving files out of `scripts/`. Directory reshaping would touch many evidence paths and should be a separate migration with explicit ledger and documentation updates.
