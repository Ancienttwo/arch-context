# Implementation Notes: ownership-change-acceptance-recovery

> **Status**: Ready for review
> **Plan**: plans/plan-20260901-1836-ownership-change-acceptance-recovery.md
> **Contract**: tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md
> **Review**: tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md
> **Last Updated**: 2026-09-02
> **Lifecycle**: notes

## Design Decisions

- Receipt remains the only durable apply authority. Recovery adds an immutable binding to new
  receipts and a proof-bound delivery transition; it neither fabricates a receipt nor replays the
  ChangeSet or approval.
- `projection recover` is a distinct command. Ordinary apply refuses a pending committed receipt,
  so a refreshed caller snapshot cannot silently convert a stale candidate into recovery.
- Recovery input is an identity-only intent. The runtime daemon re-reads the receipt and rebuilds
  the full no-accepted-change fixed point inside its writer boundary; the RPC surface has no
  direct receipt-delivery method and cannot accept a client-built semantic proof.
- Recovery rebuilds the no-accepted-change fixed point, compares exact architecture digest set,
  provenance, ready CodeGraph generation metadata, and owned output bytes, then daemon rechecks
  the proof snapshot inside its writer boundary before SQLite `BEGIN IMMEDIATE` consumption.
- Projection provenance deliberately ignores CodeGraph reindex churn caused by projection-owned
  output. Declared source/model, renderer/layout, and generated CodeGraph identity remain sticky
  inputs, so a real source or model change breaks the fixed point.
- The recovery protocol has its own unreleased `0.4.8` identity across all workspace manifests,
  lockfile workspace entries, product manifest/capabilities fixtures, and generated practice
  catalog. Existing `0.4.7` receipts and historical release evidence are not rewritten.
- `@archcontext/contracts` remains the scoped source workspace only. The shared FG6/public
  release staging boundary derives unscoped `archctx-contracts` with `src`, `fixtures`,
  `schemas`, and the schema export map; its dry-run rejects a scoped/internal manifest and
  requires `projection-apply-recovery.schema.json` in the consumer tarball.

## Deviations From Plan Or Spec

- The initial provenance key included `codeGraphDigest` and `indexedWorktreeDigest`; real
  CodeGraph reindex of the files it had just projected made a current no-accepted-change fixed
  point impossible. The approved scope expansion corrects that existing projection boundary,
  with source/model causation controls.
- Bun 1.4's `node:sqlite` shim retains prepared-statement lifetime through the migration
  connection close. The local-store adapter now uses Bun's native SQLite connection under Bun,
  releases its query cache before migration compaction and close, and keeps checkpoint plus
  journal-mode transition on that same owning connection. Node keeps its native `node:sqlite`
  adapter.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Cache a recovery proof | Rejected | A cache would become another semantic authority and leave invalidation ambiguous. Recovery recompiles the exact fixed point. |
| Accept v0.4.7 receipts | Rejected | They lack immutable recovery bindings; read-only inspection remains available, recovery fails closed. |
| Include CodeGraph reindex digest in sticky provenance | Rejected | Projection-owned indexing churn would self-trigger projection drift while adding no architecture meaning. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Pre-fix guard: `docs/verification/20260901-ownership-change-acceptance-recovery-pre-fix.txt`
- Regression guard: `tests/ownership-change-acceptance-recovery.test.ts`

## Verification

- Node `22.22.0` and Bun `1.4.0` are the repository-supported toolchain. The full suite and
  strict contract verifier run on that toolchain after the authority-boundary correction.
- Both legacy WAL staging and in-place schema upgrade regressions pass under Bun 1.4.0. This
  proves the migration lifecycle releases owned statements before `journal_mode = DELETE`, with
  no retry, sleep, or journal-mode fallback.
- The recovery guard passed both real race cases: a ready CodeGraph proof reaches one atomic
  delivery only after model/flow/receipt/owned-output/TOCTOU checks, while an unavailable
  CodeGraph proof remains pending.
- Raw authenticated RPC regression rejects both the retired direct-delivery method and a forged
  proof payload; in both cases the pending receipt remains unconsumed.
- The first-pass no-race path now travels through the same daemon authority recovery flow. It
  requires a ready CodeGraph proof; the causation-control fixture initializes CodeGraph before
  planning, while an unavailable proof remains a pending reconcile receipt.
- The real-RPC `.ai/harness` runtime-churn fixture initializes CodeGraph because it isolates
  projection-owned runtime churn, not unavailable-CodeGraph behavior. Its focused run passed
  (`1/1`, 32 assertions).
- Recovery regression: `bun test --timeout 60000` passed `1241/1241` tests with `7717`
  assertions. Contract schema, local-store atomic consumption, accepted apply race/no-race,
  typecheck, task workflow, task sync, architecture sync, and `git diff --check` are green.
- Release-prep proof used Node `22.22.0` + Bun `1.4.0`: frozen install, typecheck, current
  package/catalog/contract tests, and generated `npm pack` plus `npm pack --dry-run` pass for
  both public artifacts. The exact consumer tarballs are
  `/tmp/archctx-release-prep-0.4.8-public-contracts/archctx-0.4.8.tgz` (SHA-256
  `cdc1e060ca78e30086c1539a926b6124245db81386061df7c5398f70398c6fec`) and
  `/tmp/archctx-release-prep-0.4.8-public-contracts/archctx-contracts-0.4.8.tgz` (SHA-256
  `a9be92f610a00dabe9a2e9d46f3e970236c2bef64217e83cbf2430211b4e4f99`). A clean consumer
  installs both exact tarballs, imports `archctx-contracts` recovery types/invariants and its
  recovery schema export, and runs the CLI recovery surface fail-closed for a missing receipt.
- Public rollout remains fail-closed: neither `archctx@0.4.8` nor `archctx-contracts@0.4.8`
  is available from public npm before any publish attempt. The local tarballs are integration
  evidence only; publication, registry mutation, tag, and release readback remain blocked.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
