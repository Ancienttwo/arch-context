# Implementation Notes: audit-residuals-108-117-remediation

> **Status**: Ready for review
> **Plan**: plans/plan-20260902-2222-audit-residuals-108-117-remediation.md
> **Contract**: tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md
> **Review**: tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md
> **Last Updated**: 2026-09-02 22:42
> **Lifecycle**: notes

## Design Decisions

- The RPC cleanup command accepts only `repositoryRoot`, `challengeId`, and `runId`. The daemon derives the fixed state path, reloads its persisted manifest, verifies the lock and every owned path, then delegates to a separately named in-process cleanup method.
- Runtime startup hydrates the canonical `landscape.local` before accepting calls. Repository removal commits session deletion and the new landscape projection in one SQLite `BEGIN IMMEDIATE` transaction, then mutates in-memory state only after commit.
- GitHub issue preflight detects concrete GitHub PAT prefixes (`github_pat_`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) and long Bearer values only in authorization/assignment contexts. Benign “Bearer authentication” prose is not treated as a credential.
- #111 remains conditionally accepted. Node/Bun on macOS cannot open a child through `/dev/fd/<directory-fd>/...` (`ENOENT`), and the repository has no `openat`/`renameat` native helper. Path rechecks would narrow but not close the same-UID concurrent parent-swap race, so no false no-follow guarantee was added.

## Deviations From Plan Or Spec

- The generated contract named `bun run build`, but this repository has no `build` script. The nonexistent gate was removed; `bun run typecheck`, the 323-test affected-suite run, and the 1304-test root suite cover the implemented TypeScript surfaces.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Keep a path-bearing cleanup RPC | Rejected | It leaves caller input as deletion authority. |
| Add a second manifest overload to preserve structural compatibility | Rejected | A distinct in-process method keeps one public RPC shape and avoids dual semantic authority. |
| Persist session delete and landscape separately | Rejected | A crash between writes recreates the stale restart state. |
| Add more pathname rechecks for #111 | Rejected | The TOCTOU window remains; it would overstate the security property. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Pre-fix red evidence: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.pre-fix.log` (0 pass, 5 fail).

## Verification

- Focused post-fix regressions: 29 pass, 0 fail.
- Affected cross-package suites: 323 pass, 0 fail, 2860 assertions.
- Root suite: 1304 pass, 0 fail, 8042 assertions.
- `bun run typecheck`: exit 0.
- `git diff --check`: exit 0.
- `repo-harness run verify-contract --strict`: 9/9 pass, contract status `Fulfilled`.
- `repo-harness run verify-sprint --prepare-acceptance` froze the verification evidence but cannot select the intended subject: policy `review_base` resolves the dirty primary checkout's stale local `main@01d42c`, while this isolated candidate is based on current `origin/main@961f965`. The resulting Change Assessment includes unrelated historical changes, so no AcceptanceReceipt was issued.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
