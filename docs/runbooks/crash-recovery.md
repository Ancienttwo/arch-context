# Crash Recovery Runbook

## Scope

ArchContext local state is rebuildable. Git `.archcontext/` files remain the source of truth; local SQLite stores derived sessions, evidence, verification, and reviews.

## Drill

1. Stop `archctxd`.
2. Run `archctx paths` and move the reported `runtime.sqlite*` files aside, or move the reported workspace runtime state directory aside if daemon connection, lock, log, or review-run state is suspect.
3. Run `archctx init` if `.archcontext/manifest.yaml` is absent.
4. Run `archctx sync`.
5. Run `archctx validate`.
6. Run `archctx context --task "recovery smoke"`.

Expected result: model digest is restored from Git files and CodeGraph adapter state is regenerated.
