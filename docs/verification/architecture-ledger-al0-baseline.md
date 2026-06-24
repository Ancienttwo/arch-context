# Architecture Ledger AL0 Baseline

> Captured: 2026-06-25
> Scope: current CLI/runtime path timings before AL2 ledger implementation
> State isolation: temporary `ARCHCONTEXT_STATE_DIR`; `init` ran in a temporary Git repository

This is a local readback for AL0-13. It is not a performance claim for the
future ledger. The goal is to pin the current path shape before adding ledger
tables, dual writes, queues, and Book queries.

| Path | Command | CWD | Exit | ok | Elapsed ms | Schema / reason |
|---|---|---|---:|---:|---:|---|
| init | `bun packages/surfaces/cli/src/main.ts init --name AL0 Baseline` | temp repo | 0 | true | 450 | `init` |
| status | `bun packages/surfaces/cli/src/main.ts status` | repo | 0 | true | 567 | `status` |
| sync | `bun packages/surfaces/cli/src/main.ts sync --changed packages/contracts/src/ledger.ts` | repo | 0 | true | 774 | `sync` |
| context | `bun packages/surfaces/cli/src/main.ts context --task "AL0 architecture ledger contract freeze" --max-symbols 3` | repo | 0 | true | 557 | `archcontext.task-context/v1` |
| prepare | `bun packages/surfaces/cli/src/main.ts prepare --task "AL0 architecture ledger contract freeze" --max-items 3 --task-session-id al0_baseline` | repo | 0 | true | 428 | `prepare` |
| checkpoint | `bun packages/surfaces/cli/src/main.ts checkpoint --task-session-id al0_baseline --event manual --changed packages/contracts/src/ledger.ts --max-items 3` | repo | 0 | true | 796 | `archcontext.practice-checkpoint/v1`; `no-op` |
| complete | `bun packages/surfaces/cli/src/main.ts complete --task-session-id al0_baseline --task "AL0 architecture ledger contract freeze" --posture normal` | repo | 0 | true | 392 | `archcontext.review/v1` |

Tradeoff: `init` was measured outside this repository because the current
runtime implementation writes `.archcontext/` during init. The other paths used
this repository to exercise the real CodeGraph-indexed path while keeping
runtime state temporary.
