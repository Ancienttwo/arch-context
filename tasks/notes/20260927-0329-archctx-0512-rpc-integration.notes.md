# Implementation Notes: archctx-0512-rpc-integration

> **Status**: Active
> **Plan**: plans/plan-20260927-0329-archctx-0512-rpc-integration.md
> **Contract**: tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md
> **Review**: tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md
> **Last Updated**: 2026-09-27 03:29
> **Lifecycle**: notes

## Design Decisions

- Current main already contains #178, so this integration changes release identity and projected metadata only. Keep `packages/contracts/package.json` at `private: true` as main requires; the release stage creates the public `archctx-contracts` artifact.
- The tag-based hotfix tarballs and current-main tarballs have different SHA-256 values. The publication agent must rebuild from the merged current-main source instead of reusing tag-based bytes.

## Deviations From Plan Or Spec

- The first cherry-pick was accidentally attempted in the clean local main checkout; it was aborted immediately, leaving that checkout unchanged. The same commit was then cherry-picked in the isolated integration worktree, resolving the single `private` manifest conflict in favor of current main.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Merge the tag-based hotfix branch directly | Rejected | Main has many later changes and extracted the RPC client; a release merge should not reintroduce the old file layout or duplicate the already-merged fix. |
| Cherry-pick only the version integration onto current main | Selected | Keeps the PR to version anchors and the handoff note; publication remains a separate irreversible action. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Full pinned-Bun `verify`: `/tmp/archctx-main-0512-verify.log`, exit 0; 2,022 tests passed, 0 failed, representative evaluation verdict PASS.
- Current-main release dry-run: `_ops/npm/main-0512/evidence.json`, status `verified`, no failures.
- Installed tarball smoke: `/tmp/archctx-main-0512-smoke.log`, exit 0; installed CLI identifies as 0.5.12.
- Current-main candidate SHA-256: `archctx-0.5.12.tgz` `7b2fba89cf16469c2151e7f14d7bb6350f30c3364ec74a14942e7d0e13627f4b`; `archctx-contracts-0.5.12.tgz` `b0201f28409868232ec8c9b28b170ff063b38dbe28da29b46754b69b088ed98b`. These are local pre-merge artifacts, not registry publications.
- Local `repo-harness architecture-projection plan --json` fails on current main's existing `.archcontext/model/nodes/capability.architecture-context.yaml` ID `capability.architecture-context` (requires `capability.<domain>.<name>`). Draft PR #223 owns that model file; this version PR does not change it. Treat local strict sprint acceptance as blocked until the baseline model is repaired or an approved exact waiver is recorded.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
