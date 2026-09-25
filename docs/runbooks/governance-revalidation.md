# Governance revalidation

The existing Verify workflow accepts a manual event that executes only the canonical Governance job. That job still runs `bun run verify:governance`: ordinary full local Verify followed by the 23 evidence inspections. It retains Node 22.22.x, Bun 1.4.0, read-only repository permissions and its 15-minute timeout. Normal pull requests and main pushes retain all nine platform/Node jobs. Event-specific concurrency prevents a manual run from cancelling an automatic matrix.

## Operator procedure

1. Freeze and push the candidate branch. For an explicitly authorized workflow/evidence-only follow-up whose platform code is unchanged, use `[skip ci]` on the commit to avoid automatically repeating existing matrix evidence. This is not general permission to skip PR verification.
2. Run `gh workflow run verify.yml --repo Ancienttwo/arch-context --ref BRANCH`.
3. Read the resulting run's `head_sha`, `event`, `status`, `conclusion` and jobs from GitHub. Require the intended branch head, event `workflow_dispatch`, completed successful Governance, and no executed matrix jobs. Record exact run/job URLs and subject.
4. Keep the prior nine-platform matrix evidence bound to its original tested subject. A Governance-only run must never replace that matrix record or be called a new nine-platform pass. Confirm the intervening diff contains only the documented workflow routing/tests/records before reusing the earlier platform proof.

The [GitHub manual workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) documents dispatch and `--ref`. Verify is already registered on the default branch; the selected branch must contain the manual trigger. This procedure does not merge a PR, waive required checks, publish a release, or close an issue. A skipped matrix check is not matrix execution evidence.

Task history and exact results: `plans/plan-20260925-1345-remaining-audit-issues.md`, `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`. FG6 authority and prior matrix provenance remain in `docs/researches/20260925-fg6-matrix-conclusions.md`.

## Verified execution

[Manual run 36122160055](https://github.com/Ancienttwo/arch-context/actions/runs/36122160055) on `405d6ca1bec1fe6ec603e9eb11ff9c7cc49e5ec8` succeeded: only Governance executed, all 24 canonical commands passed, and the matrix was skipped. Full Verify reported 2037 pass / 2 platform skips / 0 fail. Exact subject, job and log provenance: `docs/verification/20260925-governance-revalidation.json`. The prior platform matrix is a separate run and retains its original source binding.
