# Projection receipt readback

User-approved source repair, 2026-09-24. Publication and shared runtime replacement remain separate approval boundaries.

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
