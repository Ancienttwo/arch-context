# Capability projection profile alignment (#225)

Status: partial; controlled migration and whole-plan acceptance remain blocked. Source candidates are isolated in `arch-context-wt-remaining-audit-issues` and `repo-harness-wt-archctx-projection-profile`. Harness counterpart is local commit `e7955bb5e1fa03a02ca6eaabd821884c3256ca3e`; it has not been pushed or released. No installed package was changed.

## P1: authority map

ADR-0043 defines three-part capability identity, generic include/exclude globs and optional workflow metadata. The initializer owns fresh models, ChangeSet/daemon owns existing model and projection writes, and `layout.ts#parseRepoHarnessNodeProfile` defines explicit projection targets. This repository selects `context.capability_source: registry`; the workflow registry is not being migrated in this slice.

The projection consumer previously invoked the full ownership-registry translator just to discover output targets. Its restricted prefix grammar and required responsibilities/LSP metadata are not the projection profile contract. The separate unmerged source-exclusion branch retains that restricted grammar and cannot consume this repository's nested globs.

## P2: concrete trace and regressions

`verify-sprint --prepare-acceptance` → automatic projection → snapshot capture → `architectureAgentContextTargets` → strict ownership registry failed before producer execution. Focused tests on unchanged source reproduced the initializer ID mismatch and three consumer boundary failures: metadata requirement, omission of deprecated capabilities rendered by the producer, and a noncanonical backslash target accepted by the old mapper.

The initializer now emits `capability.architecture.context` (architecture domain, context function), retaining the Architecture Context name. Existing create-only refusal/rollback remains intact; initialization still invents no source ownership. Seed consumers were updated to the new identity. The isolated harness provider now validates projection identity and explicit canonical contract targets directly, without interpreting source globs/exclusions or altering the workflow registry. Duplicate/malformed identity and unsafe/wrong targets fail closed.

A real fresh initialized model was configured through a daemon ChangeSet in a disposable repository. Both producer profile parsing and candidate consumer discovery returned `AGENTS.md`, `CLAUDE.md`, and `docs/architecture`, preserving `packages/**/src/**` and `packages/**/test/**` without responsibilities/LSP/verification metadata. This proves profile agreement, not permission to write root contract files.

## P3: migration decision and stop boundary

The intended model migration preserves all source/entrypoint fields and updates root identity, six module parents, flow capability/participant references, the projection relation, and ADR-0021 appliesTo in one transaction. Explicit root contract targets follow the existing root routing contract.

Two controlled attempts were rejected and rolled back:

1. The 10-operation model-only proposal failed final validation because ADR-0021 still referenced the old ID.
2. An 11-operation proposal including ADR-0021 reached the existing ChangeSet write guard and failed: `docs/adr/ADR-0021-first-party-skills-sop-only.md` is outside the allowlist. The temporary proposal-parser extension was removed byte-for-byte after this finding.

Readback checked all 11 operation preconditions: ten original files are byte-identical to their preimages and the proposed new node is absent. No model, ADR, generated projection, policy or runtime semantic mutation remains.

A separate direct guard probe confirms root `AGENTS.md` and `CLAUDE.md` are also denied even when explicitly listed in agent-context scope. `packages/core/policy-engine/src/index.ts` documents root routing contracts as never machine-writable (lines 205–218). The producer's explicit root-target profile and this writer boundary therefore conflict. This is a concrete writer-contract decision, not permission to widen ALLOWLIST merely to pass acceptance.

The bounded next work-package must define an approved, existing-file/hash-bound ADR reference update plus marker-only root contract projection, preserve human text, reject unrelated paths/body edits, and prove journal rollback. Then the same complete migration can be retried and projections regenerated. No alias, source-glob narrowing, direct YAML/projection edit, guard bypass or synthetic acceptance is acceptable. At 10x nodes, snapshot filesystem traversal remains the cost boundary; target discovery adds no resolver or provider subprocess.

## Verification and disposition

- Pinned Bun 1.4.0 and task-scoped TMPDIR throughout.
- ArchContext: 29 initializer/model validation tests, 108 seed-consumer tests, 8 relevant CLI tests; all pass (145 total, 983 assertions). Typecheck and five-workspace package boundary audit pass.
- Harness: 72 provider/orchestration tests pass (389 assertions); typecheck passes. Required hooks/helpers/reference-configs/deploy-SQL/architecture-sync/task-workflow/state/init-dry-run checks pass. Task-sync initially requested the exact substantive digest; recording it in canonical notes made the same check pass.
- Independent read-only consumer security review passed; it is not whole-task acceptance.
- No full matrix was rerun: migration remains a prerequisite. Historical hosted proof applies to its recorded source only, not these new source changes. #223 stays Draft; #225 stays open; no typed AcceptanceReceipt, merge or release is claimed.

Machine-readable source hashes, counts, paired readback and rollback proof: `docs/verification/20260926-capability-profile-diagnosis.json`.
