# Task Review: axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake

> **Status**: Pass
> **Plan**: plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md
> **Contract**: tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md
> **Notes File**: tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-08-08 18:10
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:1d1bb75a87d67c113cc64bca719dfa9c24b9700b776fb3594508409639a4fddd
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 74ac67872e4ef21616a96baff9c2423495c3da85

## Human Review Card

- Verdict: pass
- Change type: code-change
- Intended files changed: contract `allowed_paths` 内的 snapshot contract、projection engine、
  CodeGraph adapter、CLI/daemon orchestration与回归测试。
- Actual files changed: 26 files；实现 commit `8bfb126`。
- Commands passed: `bun run verify`；strict contract verification `13/13`；targeted suite
  `260 pass / 0 fail`；runtime fixed-point suite `5 pass / 0 fail`。
- Residual risks: 当前 source checkout 没有 `.codegraph`，因此没有对本仓库生成 P1/P2；actual
  1.5 ready path在 disposable indexed fixture验证，consumer E2E归 AXR7。
- Reviewer action required: none。
- Rollback: revert `8bfb126`，恢复 CodeGraph 1.4 dependency 与旧 projection snapshot schema。

## Mode Evidence

- Selected route: contract worktree；external Claude semantic acceptance。
- P1/P2/P3 evidence: plan Architecture Map / Concrete Trace / Decision Rationale 与 implementation
  notes逐项对应；single snapshot assembly同时被 CLI 与 daemon调用。
- Root cause or plan evidence: pre-fix commit-only `stamp..HEAD` 无法看见 dirty bytes，且 provider
  静态 version + `.codegraph` existence 不能证明实际 indexed snapshot。

## Verification Evidence

- Waza `/check` run: 未单独运行；Acceptance Policy 要求 Claude，使用 Claude Code 2.1.222
  `claude-haiku-4-5` read-only review，session `45e6e7e6-2092-4942-9d31-1f0765a727d0`。
- Commands run: `bun run verify`；`repo-harness run verify-contract ... --strict`；contract
  targeted suite；actual CodeGraph 1.5 两轮 snapshot fixed-point readback。
- Manual checks: external reviewer实读 `8bfb126..74ac678`，P0 none、P1 none、overall PASS。
- Supporting artifacts: `.ai/harness/checks/latest.json`、contract verify stdout、implementation notes。
- Implementation notes reviewed: yes。
- Run snapshot: `.ai/harness/runs/`。

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- Contract没有声明额外 `manual_checks`。

## Acceptance Receipt Projection

> **Disposition**: external_pass
> **Reviewer**: Claude
> **Source**: claude-review
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: sha256:1d1bb75a87d67c113cc64bca719dfa9c24b9700b776fb3594508409639a4fddd
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 74ac67872e4ef21616a96baff9c2423495c3da85
> **Verification Evidence SHA256**: sha256:d7418aaf4190e9cc48b3c036923d706a391a3a06e995a1a47fa8e8add3cb09d2
> **Issued At**: 2026-08-08T10:15:32.154Z

- Summary: Claude read-only review found no P0 or P1 findings; AXR2 snapshot, CodeGraph 1.5 handshake, fixed-point, and fail-closed acceptance passed.
- Findings: none

## Behavior Diff Notes

- Projection runtime从 PATH/静态 1.4 version升级为 package-local actual 1.5 binary + public
  status/sync/query proof，任何 existing stale/mismatch/timeout fail closed。
- Manifest/CLI/daemon携带同一 provenance；dirty source在 HEAD不变时也会 stale。
- base HEAD/worktree仅记录生成 snapshot；semantic inputs未变时sticky，提交 projection 自身和
  无关 commit 保持 fixed point。

## Residual Risks / Follow-ups

- AXR3 才定义 `ArchitectureFlowV1` semantic proof matrix；本 task 不提升现有 import/call trail
  为更强语义 authority。
- AXR7 负责在 repo-harness disposable consumer 上做 packed-tarball ready-index E2E。

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 10/10 | contract suites、runtime fixed point与 full verify全绿 |
| Product depth | 9/10 | receipt绑定完整 runtime/source proof；consumer E2E按 Sprint后续切片 |
| Design quality | 10/10 | 单一 snapshot assembly、public status、fail closed、无 compatibility lane |
| Code quality | 9/10 | exact schema/tests齐全；CodeGraph status contract仍受上游 public shape约束 |

## Failing Items

- None。

## Retest Steps

- Re-run: `bun run verify`。
- Re-check: strict contract verification与 actual 1.5 two-run snapshot digest equality。

## Summary

- PASS。External Claude review无 P0/P1；实现满足 binary/version/sync/indexed-worktree receipt
  binding、dirty source freshness与 source+docs fixed-point acceptance。
