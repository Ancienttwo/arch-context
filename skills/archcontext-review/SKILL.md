# ArchContext Review Skill

Use this skill before delivering task completion or PR review output.

## SOP

1. Run `archctx check --base <ref> --slice --json` (and `archctx checkpoint --json`).
2. Run `archctx complete --head-sha <sha> --json`.
3. If findings include `stale-context`, rerun `archctx prepare --task "<task>" --json`.
4. If findings include `unjustified-compatibility-path`, delete the path or create a valid Compatibility Contract through `archctx plan` / `archctx apply`.

## Rule

Review details remain local.
