# Implementation Notes: codegraph-latest-no-bin-collision

> **Status**: Active release closeout
> **Plan**: plans/plan-20260711-0055-codegraph-latest-no-bin-collision.md
> **Contract**: tasks/contracts/20260711-0055-codegraph-latest-no-bin-collision.contract.md
> **Review**: tasks/reviews/20260711-0055-codegraph-latest-no-bin-collision.review.md

## Registry Grounding

- 2026-07-11: `archctx@latest` is `0.2.2`, exposes `archctx` and `codegraph`, and depends on CodeGraph `1.0.1`.
- 2026-07-11: `@colbymchenry/codegraph@latest` is `1.4.0`.
- User-facing integration policy is `archctx@latest`; source/release dependencies remain exact after resolving the current tag so builds stay reproducible.

## Evidence

- Runtime authority and lockfile now use exact CodeGraph `1.4.0`.
- `CodeGraphCliProvider` keeps executable PATH/custom command precedence and falls back to its package-local dependency only for the unresolved default command.
- Public release staging exposes only `archctx`; the ArchContext-owned `bin/codegraph.mjs` shim was removed while CodeGraph remains an exact internal dependency.
- Focused tests: 17 pass, 0 fail; typecheck passes.
- Temporary npm dry-run: verified with only `bin/archctx.mjs` and exact CodeGraph `1.4.0`.
- Installed-tarball smoke: pass with runtime PATH deliberately excluding CodeGraph, proving `archctx sync` can execute the package-local dependency.
- `0.2.3` source, workspace, product manifest, runner/action example, lockfile, and practice catalog version surfaces are aligned; the catalog digest is `sha256:4eb838762f60289e014d20a14411e6471d0d4e6ed97fccdf393fdb2a2583c872`.
- Full `bun run verify` passes after the version bump.
- Current release dry-run evidence is verified for `_ops/npm/fg6-release-dry-run/archctx-0.2.3.tgz`; registry readback returned `E404` for `archctx@0.2.3` before publication.
- npm Web authorization completed successfully for account `ancienttwo`; `publish-archctx.mjs` preflight reports `ready` with no blockers.
- Release-candidate tarball digests are SHA-1 `0ad264beca1c0d2ee0f993b2604295bcaf3ba37c` and SHA-256 `a85f54bb9027070823ee4d7b65d7dc17184bb480a3330b8b9d9b05c738bd0b81`.

## Design Decisions

- `latest` is a consumer selection policy (`archctx@latest`), not a floating source dependency. The repository records the registry resolution (`1.4.0`) exactly so builds and attestations stay reproducible.
- The generated package no longer owns the public `codegraph` command. This removes global bin collision without splitting the one-package Local Core dependency boundary.
- Historical verification evidence remains unchanged because it records previously published artifacts.

## Residual Risks

- Registry latest remains `0.2.2` until the authorized publish command succeeds.
- `parseExploreSymbols` still recognizes the older human-readable explore format; current JSON query authority and real 1.4.0 paths pass.
- Windows PATH resolution does not emulate `PATHEXT`, so the package-local fallback may be chosen even when a `.cmd` or `.exe` is available by shell convention.

## Release Closeout Authorization

- 2026-07-11: user explicitly requested publication and offered to complete browser authorization.
- Current release target: `archctx@0.2.3` / `v0.2.3` / GitHub Release `v0.2.3`.
- `repo-harness run contract-worktree finish` cannot run because the capability resolver classifies the tracked ArchContext projection `docs/architecture/modules/capability-architecture-context.md` as orphan while `.ai/context/capabilities.json` is empty. Both are outside this contract and remain untouched; the already-passing contract/sprint evidence is retained and the release uses direct Git operations.
