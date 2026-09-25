# DE1/DE3 source predicate repair

The approved #171 slice repairs three obsolete source detectors; it does not change runtime semantics or rewrite historical readback verdicts. Evidence: [`20260925-de1-de3-predicate-readback.json`](../verification/20260925-de1-de3-predicate-readback.json).

## P1: authority map

`scripts/data-engine-de1-readback.ts` and `scripts/data-engine-de3-readback.ts` combine source witnesses with mandatory verification commands. Runtime daemon selects graph/evidence authority; `explorer-projection.ts` admits compiler inputs; SQLite owns scoped indexed metadata reads. `data-engine-source-invariants.ts` is shared by both readbacks and checks only the three approved predicates. Other source invariants and all existing commands/preflights remain intact.

## P2: traced path and cause

- DE1 formerly required the unbounded `listArchitectureEventBacklinks(scope)` spelling. Current `buildExplorerProjectionV2` routes ledger inputs and Git metadata through `readExplorerProjectionInputs` / `readExplorerProjectionMetadata`, which call the same scoped, subject-indexed, limited backlink reader. Reintroducing the old call would undo bounded reads.
- DE3 formerly required `required-input-digest-mismatch:graph`. DE4 explicitly separates full-authority graph identity from the selected partial graph. `compileProjectionInputManifest` hashes the selected graph and calls `assertProjectionReadContract`, which verifies canonical plan/read-set digests and `selectedGraphDigest`. Missing observed facts and required domains still throw.
- DE3 formerly inferred authority from cursor presence. The daemon now chooses authority from ledger mode and verified Git graph/scope agreement, then supplies separate graph and evidence cursors. `assertAuthorityBinding` checks source/cursor consistency, repository/worktree and graph/evidence identities.

All three former expressions returned false at unchanged `317725d`. This predates this repair; it is detector drift, not evidence that current runtime admission is absent.

## P3: bounded decision

Keep the current architecture and update the source witnesses to connected call sites and guards. Restrict textual checks to known declaration boundaries; missing/ambiguous declarations fail closed. This remains a source-wiring check, not a general TypeScript parser or semantic proof. Formatting/refactors can require explicit detector maintenance. Both readbacks now execute the detector regression suite in addition to their existing commands.

At 10x graph size, restoring unbounded reads would be the first scale failure. Preserve the selected-subject SQL limit and both graph/evidence authority boundaries instead.

## Verification

Pinned Bun 1.4.0:

- 36 detector tests cover positive current wiring, removed calls/guards/SQL bounds, unrelated-function witnesses and missing/ambiguous declarations.
- Five existing behavioral cases cover SQLite scoped reads and poisoned authority, compiler missing/mismatched inputs, verified-ledger reads, Git graph with separate ledger evidence, and CodeGraph-unavailable refusal.
- Strengthened the SQLite case with a positive backlink-count assertion: an empty array must not pass its existing `every(...)` assertion vacuously.
- Actual temporary source mutations removing backlink output, selected graph digest comparison, and authority worktree comparison each failed their named behavioral test at the intended assertion. Product source was restored byte-for-byte. Final combined run: **41 pass, 0 fail, 118 assertions**.
- Typecheck, package boundaries (five workspaces), and script ownership suite (six tests, 52 assertions) passed.

No full DE1/DE3 command matrix or old contract preflight was rerun, and the historical artifacts are unchanged. The new evidence records only this bounded repair; it does not claim complete DE1/DE3 milestone reacceptance, current-head hosted CI, whole-plan acceptance, merge, deployment or issue closure. Remaining S6 source-predicate failures are a separate slice.
