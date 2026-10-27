# Open issue repairs and release preparation

Status: Executing

## Scope and authority

User authorized parallel repair of all open issues, acceptance and PR merges, and preparation of release 0.9.4. Baseline: origin/main b38ae08bb925c88297dd392460122309bd4ca9a9. No npm publication is included. Preserve the primary checkout and its unrelated untracked research file and index lock.

## Design and invariants

- Reuse PR #420 for #419, including its recorded regression and CI evidence; verify the exact patch before integration.
- #417: expose the authoritative product version without runtime initialization; resolve argument failures must direct callers to correct arguments, while model validation remains a model failure.
- #421: introduce an explicit no-sync flow proof path using the same CodeGraph readiness authority as deps. Existing sync behavior stays explicit in help. No stale or partial index may produce a positive proof.
- #415: classify a missing daemon start root at readiness, preserving authenticated shutdown and targeted stop. Do not attribute all publish failures to stale daemons or kill unrelated processes.
- #409: extend the existing stateless impact implementation, preserving Git-object reads, deterministic bounded results and explicit unknown coverage. No source-text heuristics may invent CodeGraph facts.
- #414: export a portable journal receipt through the daemon-owned boundary. Include ChangeSet identity, transition digests and file hashes; verification must distinguish integrity from approval/authenticity. No direct writes to model or ledger state.
- One writer per file. Parent owns CLI integration, shared contracts, documentation, validation and release metadata. Worker source changes use separate clean worktrees; ledger-affecting work returns proposals for parent implementation.

## Task Breakdown

- [x] Inspect and integrate #419 existing PR #420; merged remotely as 226b6bda, issue closed.
- [x] Repair #417 with process-path and invalid-input regressions.
- [x] Complete P1/P2/P3 for #415 and #421; implement independently owned changes.
- [x] Complete P1/P2/P3 for #409 and #414; implement remaining acceptance criteria.
- [x] Integrate worker commits and run typecheck and affected tests.
- [x] Read-only review of implementation and tests on the integrated diff, consuming existing evidence.
- [x] Align version sources and release notes to the user-selected 0.9.4 target.
- [ ] Freeze candidate; run full release verification and package smoke once, recording exact head and exit codes.
- [ ] Prepare reviewable release branch/PR and report remaining external release gates accurately.

## Verification and scale

Tests exercise real temporary Git repositories and actual process boundaries where behavior depends on them. The parent runs all builds, typechecks and tests. At 10x input size, impact limits and coverage must remain explicit; no silent truncation or unbounded output. Receipt verification rejects mismatch rather than reconstructing provenance. Runtime tests must leave shutdown reachable when readiness fails. Stop each repair loop after three attempts.
