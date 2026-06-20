# Sprint 2 Multi-repo Rebuild Proof

Date: 2026-06-20

## Scope

This proof closes MR-16 and MR-EG3 for repo-local deterministic verification. It verifies that local derived landscape state can be deleted and rebuilt from Git-tracked ArchContext model files plus per-repository CodeGraph indexing.

## Source of Truth

- `.archcontext/landscape.yaml` is the Git/worktree source of truth for landscape registration.
- `.archcontext/relations/*.json|yaml` are Git/worktree source files for cross-repo relations.
- Local SQLite/in-memory `landscapes` and `cross_repo_edges` records are derived state.
- CodeGraph is refreshed through an injected per-repository indexing callback during rebuild; local-store does not import CodeGraph directly.

## Evidence

- `packages/core/architecture-domain` parses stable ArchContext YAML and JSON model files back into typed landscape/relation objects.
- `packages/local-runtime/local-store-sqlite` exposes `rebuildDerivedLandscapeState`, which reads the Git-tracked landscape and relation files, validates referenced cross-repo endpoints, indexes each registered repository, and repopulates derived landscape state.
- The rebuild test first saves derived state, clears it, asserts it is gone, rebuilds from files, and then asserts the landscape, relation, digest, and indexed repository list are restored.

## Verification

```bash
bun test packages/core/architecture-domain/test/domain.test.ts
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
```

Result: pass.

## Boundary

This is not a production database restore rehearsal. It proves the repo-local rebuild contract for derived multi-repo landscape state. Production SQLite/D1 persistence and operational restore drills remain separate launch-readback work.
