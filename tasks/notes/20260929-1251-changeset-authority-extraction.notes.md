# Implementation Notes: changeset-authority-extraction

> **Status**: Active
> **Plan**: plans/plan-20260929-1251-changeset-authority-extraction.md
> **Contract**: tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md
> **Review**: tasks/reviews/20260929-1251-changeset-authority-extraction.review.md
> **Last Updated**: 2026-09-29 12:51
> **Lifecycle**: notes

## Progress

### 2026-09-29: move-only extraction to `ChangeSetAuthorityService`

- `runtime-daemon/src/index.ts`: 2127 lines at `dadef1c`, 1681 after. The new `runtime-daemon/src/changeset-authority.ts` has 583 lines.
- The service text and the facade removals were generated from `git show dadef1c:…/index.ts` with the TypeScript 5.9.3 compiler API, copying each symbol's source slice instead of retyping it. The repo's `typescript@7.0.2` is the native build and has no classic `createSourceFile` API, so the checker loads 5.9.3 from the local Bun cache.
- Falsifier (before editing): every `this.` member and module identifier in the moved bodies is classified below. Every body stays byte-identical; nothing needed a behaviour change.

| Referenced by moved bodies | Class | Where it lives now |
|---|---|---|
| `changesets`, `changeSetRoots`, `mcpChangeSets`, `mcpApprovals`, `changeSetWorktreeDigestProfiles` | moved | service fields (still `private readonly`) |
| `applyAuthorizedUpdate`, `appendAppliedChangeSetToArchitectureLedger` | moved | service (still `private`) |
| `readModelStore`, `localStore`, `changeSetEngine`, `architectureLedger` | mirrored port (same-named field) | facade instances passed in, so one engine is shared with ledger-admin |
| `assertRunning`, `clock`, `openSession`, `withWriter`, `appendArchitectureEventsWithFeed`, `projectionHost`, `projection` | mirrored port (same-named private method → context callback) | facade; `withWriter` is still the single writer lock, and `projectionHost` still calls the facade's `this.planUpdate`/`this.applyUpdate` |
| `RuntimeUpdateInputError`, `decodeRuntimeWorktreeDigestProfile`, `decodeRuntimePlanUpdateInput`, `decodeRuntimeApplyUpdateInput`, `runtimeUpdateInputRecord`, `acceptedCommittedChangeScope`, `safePracticeWaiverId`, `architectureLedgerWriteAppendsEvents` | moved (used only by moved bodies) | service module scope |
| `runtimeWorktreeDigest` | moved + shared (also used by the facade's `ProjectionApplyService` wiring) | exported from the service and imported by the facade. It throws the moved `RuntimeUpdateInputError`, and the service may not import `./index`, so it cannot stay in the facade. |
| `committed-change-acceptance`, `projection-service`, `projection-inputs`, core/contracts/store/model-store helpers | shared import | unchanged modules |

- The facade keeps one-line delegates for the 8 public methods; `completeTask`, engine construction, `withWriter`, `openSession`, `appendArchitectureEventsWithFeed`, `projectionHost`, `projection`; and `stop()`, which calls `changeSetAuthority.clearApprovals()`. That call clears only `mcpApprovals`, as before; drafts are still not cleared.
- Verbatim checker (`/tmp/cs-extract/check.cjs`, not committed):
  - 24 moved symbols (5 fields, 10 methods, 9 module helpers): **24/24 byte-identical** to `dadef1c`.
  - Enumerated allowances: `private` drops none; `export` added only on `runtimeWorktreeDigest`.
  - 8/8 facade delegates are exactly `return this.changeSetAuthority.X(...)`, and each keeps its `dadef1c` signature and JSDoc.
  - 28 `index.ts` hunks classified: 11 import, 6 removal, 7 delegate, 1 delegate+removal, 2 wiring, 1 `stop()`. There are 0 unclassified hunks. The one delegate+removal hunk is where git fused the `applyUpdate` delegate with the adjacent `applyAuthorizedUpdate` removal.
  - Every moved line is confirmed removed from the facade. Result: **PASS**.
- Negative controls, run on temp copies (each fails the checker with exit 1):
  - NC1: one byte in a moved body (`5 * 60_000` → `6 * 60_000` in `approveMcpUpdate`). Reported as `method approveMcpUpdate: differs at offset 1213`.
  - NC2: `applyMcpUpdate` delegate made two lines. Reported as a non-one-line delegate plus an unclassified hunk.
  - NC3: a stray edit in `completeTask` (`12_288` → `12_289`). Reported as an unclassified hunk.
- Source-reading readbacks: none needed changes. A literal-witness scan of the 12 script/test files that read daemon sources found no assertion on moved text. The Context7 hard-gate scan (`scripts/practice-context7-readback.ts`) already walks all of `runtime-daemon/src/*.ts`.
- Verification Plan (Bun 1.4.0 via `npm exec --yes --package bun@1.4.0`, with `node_modules/.bin` on PATH):
  - `typecheck`: exit 0.
  - `package-boundary-audit`: exit 0 ("passed (5 workspaces)").
  - `affected-tests`: exit 0, 862 pass / 0 fail across 43 files.
  - `full-test`: exit 0, 2356 pass / 1 skip / 0 fail across 212 files.
  - `packaged-cli-smoke`: exit 0 ("OK").

## Design Decisions

- ...

## Deviations From Plan Or Spec

- `runtimeWorktreeDigest` gains an `export` keyword in its new home (the only textual change to a moved symbol). It is listed as a moved helper, but the facade's `ProjectionApplyService` wiring also uses it.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| ... | ... | ... |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.

## 2026-09-29 Dual-Track Review

- Codex: PASS, with no P0 or P1 findings.
- Opus: SHIP. Items 1–6 are CLOSED (byte identity, same instances, binding, tokens, surface, behaviour). It ran a base-vs-head probe with 42 observations in each of the `yaml` and `dual` ledger modes and found 0 differences.
- **`clock: this.clock` wiring (`index.ts:421`).** Codex graded this P2 and Opus graded it LOW; I've recorded it at LOW and deliberately not changed it.
  - Every clock is an arrow function, and the field is `readonly` and assigned before the service is built, so there is no observable effect.
  - Every other extracted service is wired the same way.
  - If it is changed, change all services together in a separate PR, not in this move-only one.
- **Mirrored store/engine/ledger fields are construction-time snapshots.** Both reviewers found this harmless: the fields are `private readonly`, assigned once, and nothing reassigns them after construction. Same pattern as `practice-checkpoint.ts` and `explorer-projection-service.ts`.
- **Opus's load-induced failures.** Opus's `/tmp` run of `accepted-committed-change.test.ts` failed twice, both times with git reads returning empty under a load average of 9–14. A re-run on head `a8c1a1e` passed: that file together with `tests/ownership-change-acceptance-recovery.test.ts` gave 33 pass / 0 fail at a load average of about 5–7.
