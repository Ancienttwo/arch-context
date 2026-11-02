---
schemaVersion: archcontext.adr/v1
id: adr.0052.governance-composite-verification-receipt
title: Governance Composite Verification Receipt
status: accepted
decidedAt: 2026-11-03
appliesTo:
  - module.architecture-context.tooling
supersedes: []
---

# ADR-0052: Governance Composite Verification Receipt

> **Status**: Accepted by the owner on [#463](https://github.com/Ancienttwo/arch-context/pull/463). [#462](https://github.com/Ancienttwo/arch-context/issues/462) implements it; until it merges, the single-job receipt stays in force.
> **Owner**: Governance Verify
> **Origin**: [#456](https://github.com/Ancienttwo/arch-context/issues/456), [#461](https://github.com/Ancienttwo/arch-context/issues/461). Implementation: [#462](https://github.com/Ancienttwo/arch-context/issues/462).
> **Verification**: `bun test scripts/verify-sharding-workflow.test.ts scripts/governance-verify-workflow.test.ts`

## Context

Automatic and manual Governance do not run the full verifier themselves (#361). `bun run verify:governance --ci-inspect` ([`scripts/verify-governance.mjs`](../../scripts/verify-governance.mjs) `main`) first reads a receipt for the full verification that ran earlier in the same workflow run, then runs the other 23 inspections. Today that receipt is a single job. `validateGovernancePrerequisite` in [`scripts/verify-ci.mjs`](../../scripts/verify-ci.mjs) accepts the prerequisite only if the job named `Verify execution: ubuntu-latest / Node 22.22.x / full` exists exactly once, completed with `success` in this run, attempt and source head, and contains exactly one successful step named `Verify`, which runs the whole `bun run verify`. The job also has to report a `checkout_sha` output equal to Governance's own checkout.

On 2026-11-02 that one job no longer fit its 20-minute cap: the test suite alone took 1164.95 s (#456). macOS and Windows already split full verification into pre → test shards → post ([verify-sharding runbook](../runbooks/verify-sharding.md)). A split Linux run has no single `Verify` step, so the existing receipt cannot accept it unless an aggregation step takes the name `Verify` and the receipt silently changes meaning. This ADR changes the receipt deliberately.

## Decision

### 1. Invariant

A Governance full-verification receipt holds only if the full verifier ran completely on one checkout SHA in one run attempt, and every gate passed. "Completely" means every command of local `bun run verify` (`verify:pre`, `bun test --timeout 60000` over the whole Bun-discovered test-file set, `verify:post`, in that order) ran and exited zero. "One checkout" means every participating job checked out `GITHUB_SHA` of that run attempt.

### 2. Composite receipt

The Linux full verification runs as the split form only: one pre job, N test shard jobs and one post job on ubuntu-latest / Node 22.22.x. The post job contains the coverage proof. The receipt is valid only if all of the following hold. A failure of any one makes the receipt invalid:

- Each expected job (section 3) appears exactly once in the current run attempt's GitHub jobs API readback (`hostedJobs`). It has `status: completed` and `conclusion: success`, and its `run_id`, `run_attempt` and `head_sha` equal the run's. A missing, skipped, cancelled, timed-out, duplicated or mismatched job makes the receipt invalid.
- Each expected job contains exactly one completed, successful step for each of its gate steps:

  | Job | Gate steps |
  |---|---|
  | pre | `Verify pre-gates in original order`, `Bind verified checkout` |
  | shard k | `Execute assigned full files with all real assertions`, `Bind verified checkout` |
  | post | `Prove each discovered file executed exactly once`, `Verify post-gates in original order with fresh local fixtures`, `Bind verified checkout` |

  `Bind verified checkout` asserts `git rev-parse HEAD` equals `GITHUB_SHA`, as the single job's last step does today. This step-level check carries the existing rule that the verifier step itself succeeded, and was not skipped by an `if`, over to each job. The new jobs get no weaker check.
- The post job exposes `checkout_sha` from its `Bind verified checkout` step. Governance requires `needs.<post>.result` to be `success` and that output to equal its own checkout and `GITHUB_SHA`, which is today's `VERIFY_PREREQUISITE_RESULT` / `VERIFY_PREREQUISITE_CHECKOUT_SHA` binding moved from the single job to the post job.
- The coverage proof is the existing split mechanism, unchanged. The pre job runs `verify:ci plan`. That command's `discoverTestFiles` makes Bun's own discovery pass and records the discovered file set and a `partitionFiles` grouping into a plan bound to `subject()` = run ID, attempt and `GITHUB_SHA`. Each shard runs `verify:ci shard`, which refuses a plan whose subject or target differs from its own and writes a report of the files Bun actually executed. The post job's `Prove each discovered file executed exactly once` step runs `verify:ci coverage`, that is `validateCoverage`. It requires one report per planned shard, empty shards included, each with exit code 0, the same subject and target, and exactly its assigned files. The union of the reports must equal the plan's discovered set. So the post job's success, together with that step's success, proves that the shards together executed the whole discovered suite on the receipt's checkout and run attempt.

The single-job form is not accepted as a fallback, and no job, step or alias imitates it (section 5).

### 3. Names and shard count

The expected job names are exactly `expectedWorkers(config, "ubuntu-latest", "22.22.x")`, built by `workerName`:

- `Verify execution: ubuntu-latest / Node 22.22.x / pre`
- `Verify execution: ubuntu-latest / Node 22.22.x / shard 1` … `/ shard N`
- `Verify execution: ubuntu-latest / Node 22.22.x / post`

N is the `shards` value of the `ubuntu-latest` / `22.22.x` row in `splitTargets` of [`.github/verify-sharding.json`](../../.github/verify-sharding.json), read from Governance's own checkout. That row is the only authority for the Linux shard count. The workflow does not hard-code the shard list. The Linux pre job derives the shard indices from the same row and passes them to the shard matrix. Because Governance names every shard from the config, a shard that the workflow silently drops or skips is a missing name and fails the receipt. A change to N changes the plan's group count and the expected names together, so the old count cannot pass.

The Linux split jobs are dedicated jobs and stay outside the lane-gated generic split matrix. They run on every event (push, both pull request lanes and `workflow_dispatch`), as the single job does today. Their results never depend on another OS target's legs. The topology controller keeps the Governance target out of its generic `split` and `shards` outputs. The nine `OS / Node version` summary names and the `Governance Verify` check name do not change.

### 4. Manual revalidation

On `workflow_dispatch`, exactly the Linux pre job, the N Linux shard jobs, the Linux post job and `Governance Verify` run: N + 3 jobs. Topology, node compat, the generic split matrix, Linux arm64, job evidence, summaries and runner cost stay skipped on manual dispatch. [`docs/runbooks/governance-revalidation.md`](../runbooks/governance-revalidation.md) says this in its opening paragraph and in procedure step 3. The run is accepted only if those N + 3 jobs completed with `success` and no other job executed. The runbook links this ADR for the receipt rule and does not restate it. Historical evidence in `docs/verification/20260925-governance-revalidation.json` keeps its original single-job meaning and is not re-read under this rule.

### 5. Retired in the implementation pull request

#462 removes the following in the same pull request. It adds no alias, translator or second accepted form:

- The single-job receipt. The `Verify` step check in `validateGovernancePrerequisite`, the `GOVERNANCE_WORKER` constant (`Verify execution: ubuntu-latest / Node 22.22.x / full`), and the `verify-linux-full` job with that name in [`.github/workflows/verify.yml`](../../.github/workflows/verify.yml). No job named `… / full` remains.
- The `validateConfig` guard "shared Governance prerequisite must remain a full worker". Its OS-coverage assertion becomes "every OS has exactly one `splitTargets` row at 22.22.x".
- The `GOVERNANCE_TARGET` branch of `expectedWorkers` that returns the single full worker. The Linux target then resolves through the split-row branch like macOS and Windows.

### 6. What does not change

- Local `bun run verify` and local `bun run verify:governance` (full verify plus the 23 inspections) stay byte-for-byte the same. `verify:pre` and `verify:post` remain exact projections of `verify`.
- The other 23 Governance inspections, their order and their ledger condition (`GOVERNANCE_COMMANDS.slice(1)`).
- The job-evidence and runner-cost readers: `jobVerdicts`, `runnerMinutes` and `hostedJobs` keep their code. Job evidence for the Linux target now checks the split names because `expectedWorkers` returns them.
- `governanceSourceHead`, and the run, attempt, workflow path, event and source-head checks in `validateGovernancePrerequisite`.
- The network-isolated first-experience readback and the platform IPC readback. They move into the Linux pre job with their artifact names unchanged.

## Files the implementation changes (#462)

- [`scripts/verify-ci.mjs`](../../scripts/verify-ci.mjs): `validateGovernancePrerequisite` (iterates the section 3 names and the section 2 gate steps instead of one `Verify` step), `validateConfig`, `expectedWorkers`, `GOVERNANCE_WORKER`, and the `topology` branch of `main`.
- [`scripts/verify-governance.mjs`](../../scripts/verify-governance.mjs): no logic change. `main` keeps calling `verifyGovernancePrerequisite` before the 23 inspections.
- [`.github/verify-sharding.json`](../../.github/verify-sharding.json): adds the `ubuntu-latest` / `22.22.x` `splitTargets` row.
- [`.github/workflows/verify.yml`](../../.github/workflows/verify.yml): the dedicated Linux pre, shard and post jobs replace `verify-linux-full`. `governance-verify` and `verify-collect` `needs` them, and Governance's prerequisite env reads the post job.
- [`scripts/governance-verify-workflow.test.ts`](../../scripts/governance-verify-workflow.test.ts): two whole tests change. The first, lines 33-50, isolates manual revalidation. Its `verify-linux-full` references are `needs` at line 39, the timeout at line 42, the missing `if` at line 43 and the job exemption at line 45; they move to the Linux split jobs, each with a 20-minute timeout. The second, lines 163-182, covers the shared full worker. Its references are the runner and Node at lines 165-167, `bun run verify` as the fourth run step at lines 168-172, the checkout binding and Governance env at lines 173-177, and the manual-dispatch job set at lines 179-181. They become the pre, shard and post command and gate-step order, the post job's `checkout_sha` binding and the section 4 job set.
- [`scripts/verify-sharding-workflow.test.ts`](../../scripts/verify-sharding-workflow.test.ts): the Governance fixture and rejection matrix (lines 15-53) move to the composite receipt and add a dropped shard, a missing coverage step and a mismatched checkout to the rejections. The topology counts (lines 342-391), the Governance-target refusal (line 405), the linux-lane verdict test (line 301) and the lane-free jobs check (line 455) change to the Linux split jobs.
- [`docs/runbooks/governance-revalidation.md`](../runbooks/governance-revalidation.md): lines 3 and 9, per section 4.
- [`docs/runbooks/verify-sharding.md`](../runbooks/verify-sharding.md): line 9 under "Execution and ownership" (Ubuntu keeps one complete verifier), line 15 under "State and gate order" (Ubuntu's network-isolated E2E stays on its unsplit worker), line 39 under "Pull request lanes" (the linux lane runs the shared Linux full worker), the "Linux full worker cap" section, and the topology counts under "Node version coverage" and "Local verification".
- [`docs/adr/README.md`](README.md): the ADR-0052 index row, added with this ADR. #462 updates it only if the title changes.

The FG6 reader's `verifyCommand` check (`scripts/fg6-platform-workflow-matrix-readback.ts:185`, `text.includes("run: bun run verify")`) matches a substring. It passes today only because `run: bun run verify:pre` contains `run: bun run verify`. When #462 removes the single job's `run: bun run verify`, it must either keep that true or make the check exact in the same pull request.

## Consequences

- Governance's receipt covers more evidence than before: N + 2 jobs and their gate steps, not one job and one step. A dropped shard, a skipped coverage step or a job on another checkout now fails Governance by name.
- Each Linux job gets the 20-minute cap back; #462 has to show on a hosted run that every job finishes under it. The split costs N + 1 more installs per run, manual revalidation included.
- Governance reads job and step names. Renaming a Linux split job or one of the section 2 gate steps is a receipt change and needs a superseding ADR.
- Plan and shard artifacts are named per attempt (`verify.yml` lines 251, 292 and 343). Only "Re-run all jobs" can produce a Governance receipt. "Re-run failed jobs" finds no plan or reports for its new attempt and fails, which is the safe direction.
- When the suite grows, N goes up in one config row. The receipt follows without a code change.
