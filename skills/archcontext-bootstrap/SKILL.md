# ArchContext Bootstrap Skill

Use this skill when installing or initializing ArchContext in a repository.

## SOP

1. Run `archctx init`.
2. Run `archctx validate`.
3. Run `archctx status`.
4. Do not manually edit `.archcontext/model`; future writes go through ChangeSet tools.

## Tool Contract

- Before coding: call `archcontext_prepare_task`.
- Before final response: call `archcontext_complete_task`.
- Skills do not implement architecture logic; they only route to runtime tools.
