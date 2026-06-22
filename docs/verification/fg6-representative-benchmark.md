# FG6 Representative Benchmark

- Generated At: 2026-06-21T19:40:34.425Z
- Environment: local-representative-benchmark
- Source Repo: ~/Projects/aiphabee
- Tracked Files: 1073
- E2E Latency Ms: 5910
- Peak RSS Bytes: 244563968

| Phase | Duration Ms | Peak RSS Bytes |
|---|---:|---:|
| clean-worktree-clone | 1750 | 21626880 |
| codegraph-init | 2410 | 244563968 |
| doctor | 70 | 43057152 |
| archctx-init | 190 | 46907392 |
| archctx-sync | 410 | 45776896 |
| archctx-prepare | 280 | 46006272 |
| archctx-status | 50 | 45907968 |
| archctx-checkpoint | 100 | 93224960 |
| archctx-complete | 390 | 45957120 |
| archctx-review | 380 | 45940736 |

## Result

- Clean worktree: PASS
- CodeGraph measured: PASS
- Review measured: PASS
- Initial index budget: PASS
- Memory observed: PASS
