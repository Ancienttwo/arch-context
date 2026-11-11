---
schemaVersion: archcontext.adr/v1
id: adr.0055.governance-receipt-spans-run-attempts
title: Governance Receipt Spans the Run Attempts of One SHA
status: accepted
decidedAt: 2026-11-11
appliesTo:
  - module.architecture-context.tooling
supersedes:
  - adr.0052.governance-composite-verification-receipt
---

# ADR-0055: Governance Receipt Spans the Run Attempts of One SHA

> **Status**: Accepted by the owner on [#533](https://github.com/Ancienttwo/arch-context/issues/533) on 2026-11-11 (decision https://github.com/Ancienttwo/arch-context/issues/533#issuecomment-6787375028, option B). It supersedes [ADR-0052](ADR-0052-governance-composite-verification-receipt.md), which moves to `superseded`.
> **Owner**: Governance Verify
> **Origin**: [#533](https://github.com/Ancienttwo/arch-context/issues/533). ADR-0052 built the composite receipt in [#462](https://github.com/Ancienttwo/arch-context/pull/467).
> **Verification**: `bun test scripts/verify-sharding-workflow.test.ts scripts/governance-verify-workflow.test.ts`

## Context

`bun run verify:governance --ci-inspect` ([`scripts/verify-governance.mjs`](../../scripts/verify-governance.mjs) `main`) first reads a receipt for the full verification that ran earlier in the same workflow run, then runs the other 23 inspections. [ADR-0052](ADR-0052-governance-composite-verification-receipt.md) made that receipt composite: the Linux full verification runs as one pre job, N test shard jobs and one post job ([verify-sharding runbook](../runbooks/verify-sharding.md)).

ADR-0052 bound the receipt to a single **run attempt**. Every expected job's `run_attempt` had to equal the run's, the discovery plan's subject carried the attempt, and the plan and shard artifacts were named per attempt. ADR-0052 section 6 recorded the consequence deliberately: only "Re-run all jobs" could produce a receipt, and "Re-run failed jobs" was expected to fail.

That rule made an infrastructure failure unrecoverable without repeating the whole matrix. In [#532](https://github.com/Ancienttwo/arch-context/pull/532) the macOS shard 1 job failed its artifact upload with `ENOTFOUND` after zero test failures. "Re-run failed jobs" reruns that job and its dependents in a new attempt, which then found no plan and no reports for the new attempt and failed the receipt. Only "Re-run all jobs" could pass it.

The owner decided on 2026-11-11 that a receipt spans the attempts of one run on one SHA, and accepted the cost that the runner environment may differ across attempts.

## Decision

### 1. Invariant

A Governance full-verification receipt holds if the full verifier ran completely on one checkout SHA across the attempts of one workflow run, and every gate passed in its latest attempt. "Completely" means every command of local `bun run verify` (`verify:pre`, `bun test --timeout 60000` over the whole Bun-discovered test-file set, `verify:post`, in that order) ran and exited zero. "One checkout" means every participating job checked out `GITHUB_SHA` of that run, in whichever attempt it ran.

The receipt is bound to the run and its checkout SHA. It is not bound to an attempt: a job that passed in an earlier attempt and was not rerun still counts, and a job that was rerun in the current attempt is judged only by that latest attempt.

### 2. Composite receipt

The Linux full verification runs as the split form only: one pre job, N test shard jobs and one post job on ubuntu-latest / Node 22.22.x. The post job contains the coverage proof. The receipt is valid only if all of the following hold. A failure of any one makes the receipt invalid:

- `hostedJobs` reads the jobs of every attempt of the run, from the first up to the current one. The provider's run-scoped `/jobs` endpoint returns only the current attempt's jobs, so a partial rerun would otherwise hide the earlier attempts.
- Each expected job (section 3) is represented by the **latest attempt that ran it**. That record has `status: completed` and `conclusion: success`, and its `run_id` and `head_sha` equal the run's. A later attempt of the same job name supersedes an earlier one, so a job that was rerun and failed fails the receipt even when its earlier attempt succeeded.
- A name that no attempt ran, or that two jobs of one attempt both claim, fails the receipt by name. A duplicate within one attempt is never resolved by picking one record.
- Each expected job's latest attempt contains exactly one completed, successful step for each of its gate steps:

  | Job | Gate steps |
  |---|---|
  | pre | `Verify pre-gates in original order`, `Bind verified checkout` |
  | shard k | `Execute assigned full files with all real assertions`, `Bind verified checkout` |
  | post | `Prove each discovered file executed exactly once`, `Verify post-gates in original order with fresh local fixtures`, `Bind verified checkout` |

  `Bind verified checkout` asserts `git rev-parse HEAD` equals `GITHUB_SHA`. This step-level check carries the rule that the verifier step itself succeeded, and was not skipped by an `if`, over to each job.
- The post job exposes `checkout_sha` from its `Bind verified checkout` step. Governance requires `needs.<post>.result` to be `success` and that output to equal its own checkout and `GITHUB_SHA`.
- The coverage proof is the split mechanism. The pre job runs `verify:ci plan`. That command's `discoverTestFiles` makes Bun's own discovery pass and records the discovered file set and a `partitionFiles` grouping into a plan bound to `subject()` = run ID and `GITHUB_SHA`. Each shard runs `verify:ci shard`, which refuses a plan whose subject or target differs from its own and writes a report of the files Bun actually executed. The post job's `Prove each discovered file executed exactly once` step runs `verify:ci coverage`, that is `validateCoverage`. It requires one report per planned shard, empty shards included, each with exit code 0, the same subject and target, and exactly its assigned files. The union of the reports must equal the plan's discovered set. So the post job's success, together with that step's success, proves that the shards together executed the whole discovered suite on the receipt's checkout and run.
- The plan and shard artifacts are named per run, not per attempt, and their uploads set `overwrite: true`. A rerun shard therefore reuses the run's plan and replaces only its own report, and the post job's report download collects one report per shard. The job-evidence and runner-cost artifacts keep their attempt scope, because they report what one attempt actually executed.
- No attempt-scoped artifact from another run is ever read. There is no fallback artifact name, and no second accepted receipt form.

### 3. Names and shard count

The expected job names are exactly `expectedWorkers(config, "ubuntu-latest", "22.22.x")`, built by `workerName`:

- `Verify execution: ubuntu-latest / Node 22.22.x / pre`
- `Verify execution: ubuntu-latest / Node 22.22.x / shard 1` … `/ shard N`
- `Verify execution: ubuntu-latest / Node 22.22.x / post`

N is the `shards` value of the `ubuntu-latest` / `22.22.x` row in `splitTargets` of [`.github/verify-sharding.json`](../../.github/verify-sharding.json), read from Governance's own checkout. That row is the only authority for the Linux shard count. The workflow does not hard-code the shard list. The Linux pre job derives the shard indices from the same row and passes them to the shard matrix. Because Governance names every shard from the config, a shard that the workflow silently drops or skips is a missing name and fails the receipt. A change to N changes the plan's group count and the expected names together, so the old count cannot pass.

The Linux split jobs are dedicated jobs and stay outside the lane-gated generic split matrix. They run on every event (push, both pull request lanes and `workflow_dispatch`), as the single job did before ADR-0052. Their results never depend on another OS target's legs. The topology controller keeps the Governance target out of its generic `split` and `shards` outputs. The nine `OS / Node version` summary names and the `Governance Verify` check name do not change.

### 4. Manual revalidation

On `workflow_dispatch`, exactly the Linux pre job, the N Linux shard jobs, the Linux post job and `Governance Verify` run: N + 3 jobs. Topology, node compat, the generic split matrix, Linux arm64, job evidence, summaries and runner cost stay skipped on manual dispatch. [`docs/runbooks/governance-revalidation.md`](../runbooks/governance-revalidation.md) says this in its opening paragraph and in procedure step 3. The run is accepted only if those N + 3 jobs completed with `success` and no other job executed. The runbook links this ADR for the receipt rule and does not restate it. Historical evidence in `docs/verification/20260925-governance-revalidation.json` keeps its original single-job meaning and is not re-read under this rule.

### 5. What does not change from ADR-0052

The composite form ADR-0052 introduced stays exactly as it was written, except for the three run-scoped changes above: the Linux pre, shard and post jobs are the only accepted prerequisite, the single-job receipt stays retired, and the section 3 names and shard count remain the receipt's identity.

- Local `bun run verify` and local `bun run verify:governance` (full verify plus the 23 inspections) stay byte-for-byte the same. `verify:pre` and `verify:post` remain exact projections of `verify`.
- The other 23 Governance inspections, their order and their ledger condition (`GOVERNANCE_COMMANDS.slice(1)`).
- The job-evidence and runner-cost readers: `jobVerdicts`, `runnerMinutes` and `hostedJobs` keep their code. Job evidence for the Linux target checks the split names because `expectedWorkers` returns them.
- `governanceSourceHead`, and the run, workflow path, event and source-head checks in `validateGovernancePrerequisite`.
- The network-isolated first-experience readback and the platform IPC readback. They stay in the Linux pre job with their artifact names unchanged.

## Consequences

- "Re-run failed jobs" on Verify now produces a Governance receipt. A shard that failed on infrastructure is rerun in a new attempt, reuses the run's plan, replaces only its own report, and the post job and Governance accept the result.
- The latest attempt per job name wins, so a rerun that fails still fails the receipt. An earlier green attempt cannot be preferred over a later red one.
- Governance's receipt can now combine jobs from different attempts. The runner environment may differ across those attempts, and each job's `Bind verified checkout` still proves it checked out the receipt's SHA. The owner accepted this cost.
- Each attempt that runs the Linux pre job uploads the same run-scoped plan artifact name with `overwrite: true`, so the run holds the plan of the attempt that last produced one. A shard of any attempt reads a plan whose subject is the run and the SHA, which is the same subject its own report carries.
- Governance reads job and step names. Renaming a Linux split job or one of the section 2 gate steps is a receipt change and needs a superseding ADR.
- When the suite grows, N goes up in one config row. The receipt follows without a code change.
