---
schemaVersion: archcontext.adr/v1
id: adr.0051.script-surface-policy
title: Script Surface Policy
status: accepted
decidedAt: 2026-11-01
appliesTo:
  - module.architecture-context.tooling
supersedes: []
---

# Script Surface Policy

> **Status**: Active
> **Owner**: Governance Verify
> **Verification**: `bun test scripts/governance-verify-workflow.test.ts`
> **Amended**: [#468](https://github.com/Ancienttwo/arch-context/issues/468) retired the acceptance ledger surface. [#471](https://github.com/Ancienttwo/arch-context/issues/471) keeps reproducible evidence out of the repository and lets a completed readback script go once nothing runs it. [#476](https://github.com/Ancienttwo/arch-context/issues/476) retired the governance inspections that only re-checked committed records.

## Purpose

The root `scripts/` directory is an executable governance, verification, release, and evidence-readback surface. It is not a scratch directory. A script can be transitional in implementation detail. It is removable once no workflow, governance command (`scripts/verify-governance.mjs`), import or runbook runs it.

This policy prevents three failure modes:

- deleting a script that a workflow, governance command, import or runbook still runs;
- keeping milestone scripts forever without a visible owner, command, import, or readback reference;
- committing evidence that the verifying run can reproduce, so that every version bump or commit needs a regenerate commit.

## Ownership Surfaces

Every non-test file under `scripts/` must be owned by at least one of these surfaces:

| Surface | Meaning | Typical owner |
|---|---|---|
| `package.json` command | A developer-facing or release-facing root command invokes the script | Root command surface |
| GitHub workflow | CI invokes the script directly or uploads its artifact | Workflow contract |
| Script import | Another script imports it as a shared helper or fixture producer | Importing script |
| `docs/verification/` | Historical or current evidence names the script as the readback mechanism | Verification evidence |
| `docs/runbooks/` | Operator documentation names the script as an operational command | Runbook owner |

Tests alone are not an ownership surface. A tested script with no command, import, runbook, or evidence reference is still a cleanup candidate.

## Cleanup Rules

- Evidence that the run verifying a head can reproduce (a process fixture, a static audit, a deterministic gate) is produced and checked inside that run. Do not commit its output; the CI run bound to the head SHA is its record.
- A committed record of evidence that CI cannot reproduce (a real staging installation, a hosted or self-hosted runner execution, an owner approval) describes the run that produced it. Its inspection checks the record's own consistency and never compares it with the current product version, commit or date.
- A governance command must exercise current code, whether on the repository, a fixture or a recorded artifact. An inspection that only compares a committed record's fields with fixed values fails only when someone edits the record or the inspection itself, so it does not belong in `GOVERNANCE_COMMANDS`.
- A readback script of a completed milestone can be deleted once no workflow, governance command, import or runbook runs it. Its committed records stay as history unless a separate change retires them.
- Do not preserve root `package.json` aliases only for convenience after a milestone has closed. If the evidence remains discoverable from `docs/verification/`, the root command can be removed in a focused cleanup.
- Root `record:*` and `readback:*` aliases must be referenced outside `package.json`. If no runbook, evidence, workflow, plan, or script names the alias, use the direct script command instead of keeping a root alias.
- Do not add compatibility wrappers, duplicate scripts, or best-effort aliases to keep old command names alive unless an approved migration contract names the compatibility window.
- Shared helpers should stay small and imported by name. If a helper grows into a standalone command, give it a command or a runbook entry.
- Any script that touches `_ops/`, external services, publishing, deployment, or hosted evidence must make that dependency explicit in its command name, runbook, or verification document.

## Deletion Gate

Before deleting a script:

1. Confirm that no workflow, governance command, import or runbook runs it, directly or through a root `package.json` command.
2. Remove its root `package.json` command, if any, in the same change.
3. A document under `docs/verification/`, `docs/researches/` or `deploy/release-checklists/` that names it as a command once run does not block deletion and stays as written.
4. Run `bun test scripts/governance-verify-workflow.test.ts`.
5. Run the narrow test for the owning area. The pull request's `Governance Verify` job is the governance check before merge.

Rollback is path-level: restore the script and any command/doc references removed in the cleanup change.

## Current Boundary

This policy does not require moving files out of `scripts/`. Directory reshaping would touch many evidence paths and should be a separate migration with explicit documentation updates.
