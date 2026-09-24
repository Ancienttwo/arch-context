# Projection receipt readback

User-approved source repair and npm publication, 2026-09-24. Shared runtime replacement remains a separate operation.

## Boundary and decision

P1: contracts own public protocol, CLI transports exact accepted apply requests, runtime-daemon owns the writer boundary and committed receipt authority. No consumer reads private storage.

P2: accepted apply can commit and consume delivery before the consumer completes refresh or writes its receipt. Repeating old recover gives no signals after delivery and does not produce a fresh current proof.

P3: add non-consuming projection readback with original receipt/result/signals and newly checked fixed point. No store migration or alternative receipt authority is added. A pre-invocation crash is handled by a typed exact-request absence response, with a committed-receipt check inside apply's writer boundary. At higher retry volume, the serialized fixed-point rebuild is the latency constraint; correctness and delivery checkpoints remain stable. Adopt recovery stays unsupported.

## Verification

- Pre-fix public command regression failed: 0 pass / 1 fail, evidence in `.ai/harness/runs/projection-readback/pre-fix.log`.
- `bun test packages/contracts/test/contracts.test.ts --timeout 60000`: 182 pass, 0 fail. The two focused real RPC/CLI scenarios pass with 104 assertions and cover non-consuming pending/delivered reads, changed request, output tamper, absence binding and duplicate apply fence. `bun run typecheck`, package boundary audit and `git diff --check` pass. Final logs live in `.ai/harness/runs/projection-readback/`.
- Official npm dry-run produces local test tarballs only. Downstream repo-harness integration must publish and pin a new dependency version before claiming reproducible shipping.

## Outstanding

The same source gate confirmed its pre-call intent dead-end finding resolved and returned PASS after reviewing the correction and actual test logs. This is a source review, not downstream canonical acceptance. No production 03c receipt, approval, daemon or generated document was modified by this worktree.

## Approved 0.5.11 release

The user approved publishing the two npm packages, pinning repo-harness to the released versions, and completing downstream canonical acceptance. Version metadata is synchronized across all workspace manifests, the public product constant and fixtures, and the practice catalog. Bun 1.4.0 does not refresh workspace-only version labels on `install --lockfile-only`, including with `--force`; the five lockfile workspace metadata versions were updated directly from the manifests, with all dependency resolutions and integrity fields unchanged, then frozen installation checked.

The source gate from the previous slice is reused; only version and release evidence change. The main branch already includes the first-adoption fixed-point correction after v0.5.10; release notes must include it. Registry 0.5.10 remains the verified install guide until 0.5.11 publication/readback succeeds. Shared daemon and original 03c recovery remain separate operations.

Version binding also covers the generated practice catalog digest, Review Action metadata and workflow examples, and the no-provider model digest used by the FG4 process fixture and its FG6 aggregate. The catalog is regenerated through `loadPracticeCatalog`; FG4 and FG6 records are regenerated with their existing `run` commands. These remain process-fixture and aggregate evidence, not a new hosted runner observation. Published-install claims remain on the last verified registry release until actual publication.

## Published artifact readback

Both 0.5.11 packages were published with npm Web Auth on 2026-09-24. Registry latest and downloaded archives match the tested tarballs; a fresh registry installation passes the Node capabilities handshake and contracts readback export checks without creating runtime state. The durable record is `docs/verification/archctx-0.5.11-release.json`. Candidate `4a7e6b6de256c4107233ef57c988e87a100f690f` passed all ten hosted CI jobs, local full verification (1778 tests) and 23 governance inspectors. The release guide now pins the verified published version.
