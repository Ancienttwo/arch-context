# Legacy manifest recovery guidance and ignored-model detection (#399)
Status: Review

## Task Breakdown
- [x] Reproduce missing actionable diagnostic using pure contract fixture.
- [x] Add conditional recovery guidance and missing-model safety documentation for #399.
- [x] Detect model paths excluded by Git ignore rules through `git check-ignore --no-index`.
- [x] `status` reports `architectureModelIgnoredPaths`; `docs adopt` and protocol adopt refuse with `architecture-model-ignored`.
- [x] Document the model paths that must be committed.
- [ ] Hosted CI on the PR head, review, merge with user approval.

Scope: baseline b4d62fa7b0c3eca4d45dd00c0fd300ae1e79edaa. No downstream data changes, manifest removal, apply operations or model reconstruction.

Evidence: baseline diagnostic regression failed; failure-envelope file 21 pass / 1117 assertions. Ignored-model detection: git-adapter and CLI regressions in this PR.
