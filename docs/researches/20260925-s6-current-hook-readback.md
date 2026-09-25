# S6 current hook documentation and contract readback

## P1: map

Harness-owned `.ai/hooks/README.md` defines user-level runtime ownership and helper-only local files. The product runbook owns installation guidance and product evidence links. CLI `hookAdapterContract` is the current adapter contract authority; the daemon owns queued execution. The S3 JSON is explicitly a historical fixture.

## P2: trace

Harness refresh `b24808c` removed the old product-specific README text; S6 `run` consequently failed `hookReadmeCentralFirst`, propagating to `centralHookComplete`. Separately, the current CLI advertises `hook enqueue` and a distinct `hook checkpoint` compatibility entrypoint, while S6 v1 read only the old checkpoint fixture.

S6 v2 now invokes the side-effect-free `runCli("hooks", ["status", "--host", "codex"])` path. That branch returns adapter metadata without host installation, provider access or daemon mutation. The producer and inspector require the current envelope, central ownership, exact enqueue entrypoint and advertised checkpoint network boundary. Missing current evidence cannot be replaced by all-true booleans or the old fixture.

## P3: decision

Keep product documentation in the product runbook and check the current harness ownership language. Move current acceptance to v2, with no v1 fallback. Freeze the original v1 record under `docs/verification/archive/s6-docs-ops-v1/`; retain the separate historical S3 evidence and inspector for existing ledger references. Regenerate the canonical S6 docs/ops record through its script. This avoids recurring drift when generic harness assets refresh; it does not change runtime behavior.

The new record explicitly scopes its result to current docs/CLI metadata and historical fixture inputs. It is not a fresh installed-host packet capture or a new production/network-isolation claim.

## Verification

The added run-path regression failed on unchanged code/docs (exit 1, `hookReadmeCentralFirst` false). After repair, docs/hook tests passed 14 cases / 61 assertions, including missing documentation, missing live contract, wrong entrypoint, extra args and permitted-network negatives. Two existing CLI hook cases passed with 29 assertions. Canonical v2 run/inspect, typecheck and both acceptance ledgers passed. Exact input hashes and scope are in `../verification/20260925-s6-current-hook-readback.json`.
