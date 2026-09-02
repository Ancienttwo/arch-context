# Implementation Notes: fix-111-descriptor-relative

> **Status**: Ready for review
> **Plan**: plans/plan-20260903-0008-fix-111-descriptor-relative.md
> **Contract**: tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md
> **Review**: tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md
> **Last Updated**: 2026-09-03 00:08
> **Lifecycle**: notes

## Design Decisions

- `writeFileWithoutFollowingSymlinks` keeps its public request contract but delegates the mutation to one native filesystem boundary.
- Linux/macOS traverse and create parents with `openat`/`mkdirat` plus `O_DIRECTORY|O_NOFOLLOW`, read the precondition through the pinned parent fd, then create, write, `fchmod`, `fsync`, `renameat`, and directory-`fsync` without resolving child pathnames again.
- POSIX verifies the visible parent inode immediately before mutation and after durable rename. A concurrent rename-to-symlink therefore fails before mutation in the deterministic regression; a later swap can never redirect the descriptor-relative write outside the repository and is reported after commit.
- Windows opens every parent with `CreateFileW(FILE_FLAG_OPEN_REPARSE_POINT)` where applicable, validates `FileAttributeTagInfo`, and deliberately omits `FILE_SHARE_DELETE`. The held parent handles prevent the pathname chain from being renamed/replaced while the existing atomic temp/rename sequence runs.
- Koffi 3.1.6 is exact-pinned as the maintained Node FFI runtime. The one-product bundler externalizes it and the staged npm manifest declares it, matching the existing native-tokenizer packaging pattern.
- The test synchronization seam is internal to `descriptor-relative-write.ts`; no test-only field was added to the public write request.

## Deviations From Plan Or Spec

- Windows does not expose a practical public descriptor-relative rename API through Node. Parent handle pinning closes the named replacement-to-symlink race without introducing a custom prebuilt addon; destination rename remains the existing atomic pathname operation inside the pinned chain.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Add more `lstat`/`realpath` checks | Rejected | A pathname check cannot be atomic with the later mutation. |
| Build a project-owned N-API addon | Rejected | It creates a new multi-platform prebuild and release authority for one boundary. |
| Use Linux-only `openat2` | Rejected | It would abandon the supported macOS and Windows product matrix. |
| Koffi plus native OS primitives | Accepted | One exact dependency supplies supported prebuilt FFI runtimes while the repository owns the explicit fail-closed syscall contract. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Pre-fix regression: `tasks/notes/20260903-0008-fix-111-descriptor-relative.pre-fix.txt` (`PRE_FIX_EXIT=1`; old implementation did not throw).

## Verification

- Focused no-follow suite: 8 pass, 0 fail.
- `bun run typecheck`: pass.
- `node scripts/package-boundary-audit.mjs`: pass.
- Node-only local product tarball: install, daemon, approved docs pin through the native boundary, upgrade, and uninstall pass.
- Root `bun run verify`: 1305 tests pass, 0 fail, 8045 assertions; representative eval PASS.
- Hosted Linux/macOS/Windows Node 22.22/24/25 evidence is required on the PR head before merge.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
