# ArchContext Intervention Skill

Use this skill when posture is `intervention` or `proof-required`.

## SOP

1. If posture is `proof-required`, execute the proof point first.
2. If posture is `intervention`, inspect target state, migration state, constraints, and kill list.
3. Use `archcontext_plan_update` for architecture model changes.
4. Use `archcontext_apply_update` only after local approval and fresh checkpoint.
5. Call `archcontext_complete_task` to verify cleanup and compatibility debt.

## Rule

Do not convert migration state into target state. Do not preserve compatibility code without a contract.
