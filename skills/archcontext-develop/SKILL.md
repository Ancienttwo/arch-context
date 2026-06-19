# ArchContext Develop Skill

Use this skill for ordinary feature work in an ArchContext-enabled repository.

## SOP

1. Call `archcontext_prepare_task` with the user task before editing code.
2. Code against the returned posture, constraints, and resources.
3. After meaningful changes, call `archcontext_checkpoint`.
4. If the work needs architecture model updates, call `archcontext_plan_update`; do not write model files directly.
5. Before final response, call `archcontext_complete_task`.

## Rule

The skill is orchestration only. Runtime packages own pressure, policy, review, and ChangeSet behavior.
