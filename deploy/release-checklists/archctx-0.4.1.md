# archctx 0.4.1 release checklist

Scope: publish the additive `ProjectionRequestV1.acceptedChange` bridge required by repo-harness architecture refresh handling. This patch does not change the v1 protocol identifiers or the Node engine range.

- [ ] `bun run verify` passes under Node `>=24 <26`.
- [ ] `archctx` and `archctx-contracts` package versions are exactly `0.4.1`.
- [ ] Focused projection contract and CLI tests prove unresolved and accepted major-change paths.
- [ ] Pull request is merged to `main`; Claude review is waived by the user's explicit instruction.
- [ ] Publish `archctx-contracts@0.4.1` and read back version, integrity, and shasum.
- [ ] Publish `archctx@0.4.1` and read back version, integrity, shasum, Node engine, and exact CodeGraph dependency.
- [ ] Clean-room Node 24 smoke returns the `0.4.1` capabilities handshake.
- [ ] Update repo-harness to exact `archctx@0.4.1` and `archctx-contracts@0.4.1`, then prove the accepted refresh signal end to end.
