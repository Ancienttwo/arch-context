# Release validation and Governance revalidation

A `workflow_dispatch` run of Verify is release validation, the only run that executes the complete matrix: the Linux pre job, the N Linux shard jobs and the Linux post job (`Verify execution: ubuntu-latest / Node 22.22.x / pre`, `/ shard 1` … `/ shard N`, `/ post`, with N from `.github/verify-sharding.json`), Governance, the macOS and Windows split jobs, node compat on the six Node 24 and 25 targets, the targeted platform jobs and Linux arm64. Governance checks the composite receipt that [ADR-0055](../adr/ADR-0055-governance-receipt-spans-run-attempts.md) defines, then runs `bun run verify:governance --ci-inspect`. Routine `pull_request` and `push` runs execute only the impact plan ([verify-sharding.md](verify-sharding.md#impact-plan-and-release-validation)); they also run the Linux receipt and Governance, so they revalidate Governance on every change. Locally, `bun run verify:governance` runs full Verify only. Event-specific concurrency prevents a dispatch from cancelling a routine run.

## Operator procedure

Release validation is a release operation: dispatch it only with the owner's approval for the exact commit.

1. Freeze the candidate on `main` or on a `release/<name>` branch, and read its full head SHA.
2. Run `gh workflow run verify.yml --repo Ancienttwo/arch-context --ref <main or release/<name>> -f sha=<full approved SHA>`. The planner and the gate refuse any other ref, a short or different SHA, and a dispatched head that differs from the SHA.
3. Read the resulting run's `head_sha`, `event`, `status`, `conclusion` and jobs from GitHub. Require the approved SHA, event `workflow_dispatch`, and `Verify gate` with `success`. The gate already requires every job of the plan to have succeeded. Record exact run/job URLs and subject.
4. Do not count a dispatch from a branch whose workflow or planner differs from `main` as release validation: such a branch can skip the ref check and run its own matrix.

The [GitHub manual workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) documents dispatch, `--ref` and `-f` inputs. Verify is already registered on the default branch; the selected branch must contain the `sha` input. This procedure does not merge a PR, waive required checks, publish a release, or close an issue.

The ref check stops default and agent behavior only. Hard enforcement needs owner settings: a ruleset that limits who can create and update `main` and `release/**`, a release environment with a deployment-branch policy and release-only secrets or approval for the complete-suite jobs, and a release step that accepts only a run from that environment for the approved SHA.

## Verified execution

Historical, before release validation: [manual run 36122160055](https://github.com/Ancienttwo/arch-context/actions/runs/36122160055) on `405d6ca1bec1fe6ec603e9eb11ff9c7cc49e5ec8` succeeded: only Governance executed, all 24 canonical commands passed, and the matrix was skipped. Full Verify reported 2037 pass / 2 platform skips / 0 fail. Exact subject, job and log provenance: `docs/verification/20260925-governance-revalidation.json`. The prior platform matrix is a separate run and retains its original source binding.
