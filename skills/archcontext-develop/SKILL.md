# ArchContext Develop Skill

Use this skill for ordinary feature work in an ArchContext-enabled repository.

## SOP

1. Call `archcontext_prepare_task` with the user task before editing code.
2. Code against the returned posture, constraints, and resources.
3. After meaningful changes, call `archcontext_checkpoint` with only `root` and optional `changedPaths`. This reads debt without writing a practice baseline.
   When the workflow explicitly needs to advance practice guidance, call `archcontext_practice_checkpoint` with the task session and practice inputs.
4. If the work needs architecture model updates, call `archcontext_plan_update`; do not write model files directly.
5. Before final response, call `archcontext_complete_task`.

## Checkpoint Debt And Practice Updates

- Read `items` and `actionsRequired` from the debt checkpoint. Empty items with partial/unknown
  coverage do not prove the absence of deferred dependency, flow or practice debt.
- `archcontext_prepare_task` seeds the daemon-owned practice baseline. Debt checkpoint does not
  change it. Only an explicit practice checkpoint advances that baseline.
- For the explicit practice writer, treat `added/upgraded` as new practice issues and
  `removed/downgraded` as resolved practice issues. `requiresProof` remains a proof task.
- A stale practice writer result requires a fresh prepare; do not pass its session, digest or
  budget inputs to the debt reader, which rejects them.

## Rule

The skill is orchestration only. Runtime packages own pressure, policy, review, practice matching, and ChangeSet behavior. Do not copy practice prose, matching rules, or checker logic into this skill.
