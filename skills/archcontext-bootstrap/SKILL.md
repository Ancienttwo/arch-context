# ArchContext Bootstrap Skill

Use this skill when installing or initializing ArchContext in a repository.

## SOP

1. Run `archctx init [--infer] [--model-only]` from a Git worktree; outside one it fails with `AC_REPO_NOT_FOUND` (`git-worktree-required`). Use `--model-only` when another orchestrator owns host hooks, skills, or `AGENTS.md`/`CLAUDE.md`.
2. Run `archctx index seed --json` to initialize or seed `.codegraph` separately from `archctx sync`.
3. Run `archctx model validate --json` and `archctx status --json`.
4. Run `archctx sync [--no-instructions] --json` to generate architecture docs.
5. Do not manually edit `.archcontext/model`; future writes go through `archctx plan` and `archctx apply`.

## Tool Contract

- Before coding: run `archctx prepare --task "<task>" --json` (or `archctx context --path <path> --json`).
- Before final response: run `archctx complete --head-sha <sha> --json`.
- Skills do not implement architecture logic; they only route to CLI runtime tools.
