# ArchContext Intervention Skill

Use this skill when posture is `intervention` or `proof-required`.

## SOP

1. If posture is `proof-required`, execute the proof point first.
2. If posture is `intervention`, inspect target state, migration state, constraints, and kill list.
3. Run `archctx plan` for architecture model changes.
4. Run `archctx apply --id <id> --approved --expected-worktree-digest <digest>` only after reviewing the preview and running a fresh `archctx check --changed <paths...> --json`.
5. Run `archctx complete --head-sha <sha> --json` to verify cleanup and compatibility debt.

## Rule

Do not convert migration state into target state. Do not preserve compatibility code without a contract.
