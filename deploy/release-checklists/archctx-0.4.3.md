# archctx 0.4.3 release checklist

Scope: scope the entity-summary sticky `verifiedAgainst` key to each capability node's own scale signal and semantic proof so unrelated commits and sibling re-measurements stop restamping every module document. Marker `sourceDigest` semantics change, so the architecture docs renderer moves `archcontext.docs-renderer/v2` → `v3` and upgrading re-renders entity docs once. Protocol identifiers, capabilities feature tokens, layout version, and the Node engine range are unchanged.

- [x] `bun run verify` passes under Node `>=24 <26`.
- [x] `archctx` and `archctx-contracts` package versions are exactly `0.4.3`.
- [x] Focused projection-engine tests prove an unrelated commit plus a sibling node's re-measurement leaves an untouched node byte-identical with its stamp reused.
- [ ] A real repo-harness projection apply after upgrade completes the one-time full re-render, and the next unrelated merge restamps nothing.
- [x] Pull request is merged to `main` (#105, #106).
- [x] Publish `archctx-contracts@0.4.3` and read back version, integrity, and shasum.
- [x] Publish `archctx@0.4.3` and read back version, integrity, shasum, Node engine, and exact CodeGraph dependency.
- [x] Clean-room Node 24 smoke returns the `0.4.3` capabilities handshake.
- [ ] Update repo-harness to exact `archctx@0.4.3` and `archctx-contracts@0.4.3`, then prove the stamp-stick behavior end to end.
