# Frozen S6 docs/ops v1 evidence

These files are byte-for-byte copies of the canonical v1 record at `8b5b37a`, before the current CLI adapter readback was added. They describe the historical checkpoint adapter fixture and are not current runtime acceptance.

The active producer/inspector is `scripts/practice-assets-s6-docs-ops-readback.ts` (v2), with current output at `docs/verification/practice-assets-s6-docs-ops-readback.json`. v2 reads the actual `hooks status --host codex` contract and requires `hook enqueue`; it does not accept v1 as current evidence. The separate S3 historical fixture and its inspector remain unchanged for their historical ledger references.
