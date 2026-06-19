# ArchContext Review Skill

Use this skill before delivering task completion or PR review output.

## SOP

1. Call `archcontext_checkpoint`.
2. Call `archcontext_complete_task`.
3. If findings include `stale-context`, rerun `archcontext_prepare_task`.
4. If findings include `unjustified-compatibility-path`, delete the path or create a valid Compatibility Contract through ChangeSet.

## Rule

Review details remain local. Attestation, when used, contains only minimal proof metadata.
