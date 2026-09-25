# Remaining audit issues: local integration and delivery boundaries

Baseline: main `e3d8077`. This work integrates existing implementation and repairs Explorer transport; it does not claim all three umbrella issues closed.

## P1: map

The local daemon owns service composition, state and writer callbacks. CLI/MCP remain consumers. Existing #220/#221/#222 extraction commits (`ad11f03`, `fd61feb`, `df3f8fc`) supply the generated-path authority, external-documentation service and agent-job service. They were applied locally in dependency order; the only conflict was the facade import block, resolved by retaining current main's Developer Review/Explorer imports and the new projection-path import. Their model nodes/relations are integrated from those original ChangeSet-authored commits; no model file was manually authored here.

ExplorerServerService owns HTTP/SSE authentication and lifecycle; explorer-html owns navigation and the authenticated SSE fetch stream. The projection/ledger writer boundaries remain unchanged. The primary checkout is clean on main; implementation is isolated in the contract worktree.

## P2: concrete trace and root cause

Before the fix, Explorer accepted `?token=` in `isExplorerAuthorized` and the renderer copied it into EventSource URLs. A direct regression on the unfixed code returned HTTP 200 from `/health?token=...` where the new assertion requires 401. Pinned Bun 1.4.0 ran the assertion; a prior attempt using global Bun 1.4.2 was rejected by the toolchain guard before tests and is not product evidence.

The new path is `browserUrl` fragment -> data-free bootstrap -> immediate history clearing -> origin/port-scoped tab sessionStorage -> Bearer HTML fetch and Bearer SSE stream. Query-token requests fail closed. Host/Origin and loopback checks precede all routes; expiry/revoke share the existing session state. No source data is exposed by the bootstrap.

## P3: decision

Keep the existing GET-only service contract and server-side expiry authority. Browser sessionStorage includes the port in its origin boundary; cookies were rejected during review because a sibling loopback port could receive them. Navigation and reload use the data-free bootstrap; HTML and SSE requests explicitly send Bearer headers with credentials omitted and redirects rejected. No cookie, localStorage or query-token compatibility route is introduced. At 10x clients, open SSE connections and projection compilation remain the existing resource limits; no new persistent state, background worker or cloud dependency is added.

## Issue disposition

- **#162:** local connection truthfulness was already delivered by #192. `github connect` fails closed, legacy connection JSON is not authorization, and review requires an injected verified connection reader. ADR-0016 describes the implementation; ADR-0017 preserves the actual cloud release gate. D1/Queue/OAuth/device registration/OS credential delivery remains a separate milestone and is not authorized as an incidental extension of this local repair. Do not close the whole issue.
- **#164:** three pending extraction patches are integrated locally, preserving the feature service callbacks and helper behavior. Source import conflict is resolved. The existing remote PRs are unchanged. The facade still contains ledger/book/recommendation/refactor orchestration, Explorer projection/cache compilation, landscape and session lifecycle; its composition-only acceptance criterion is not yet met. No blanket completion claim.
- **#171:** Explorer query-token transport is repaired. Windows control-file creation/read now uses native owner-only ACL enforcement, and all three Windows targets passed the full Verify plus actual ACL readback; see `20260925-windows-control-file-acl.md` and `20260925-fg6-matrix-conclusions.md` for their exact subjects. The approved `update_manifest_fields` ChangeSet now corrects the existing manifest to `docs/adr` through the daemon; the generic allowlist remains unchanged. See `20260925-manifest-content-paths.md` for its bounded contract, actual write and verification. The missing practices directory is a valid optional overlay and `apps/**` is already absent from tsconfig.
- **#171 egress/scripts:** The scripts owner module was added through ChangeSet preview/apply (proposal digest `sha256:20f4f11de9a95d8e7986c5b9046b7095f89a9b1fa6d1b8fac31c780a4fd5b82f`), with a `scripts/**` source boundary and the existing script-surface retention policy. `egress-admission.ts` now gates Context7, explicit npm lookup, investigator and GitHub subprocess boundaries, with telemetry denial under `local-only`. The local E2E now runs with measured kernel denial and FG6 v2 proof; frozen `5117abd` passed all ten Verify jobs, with actual Linux namespace and macOS Seatbelt proof (`../verification/20260925-egress-hosted-ci.json`). See `20260925-local-egress-admission.md` and `../runbooks/local-egress-policy.md`. Script retention is governed by `docs/architecture/script-surface-policy.md`; a directory reshuffle cannot retire referenced evidence. The three obsolete DE1/DE3 source detectors are repaired with scoped source witnesses and mutation-backed behavior tests; see `20260925-de1-de3-source-predicates.md`. Historical DE1/DE3 artifacts remain unchanged and their full command matrices were not rerun. S6 predicates and whole-plan acceptance remain open.

## Validation

Focused Explorer auth/server/renderer checks and integration tests are recorded in the task notes. Final source verification and review results are recorded there after execution. Local results are not hosted CI, merge, publication, installation or cloud delivery evidence.

The original final verification stopped after two projection/recovery test timeouts per the user AGENTS rule. The subsequently approved bounded diagnosis established outer test-deadline cancellation; see `docs/researches/20260925-codegraph-test-deadline.md`. Focused repair evidence does not retroactively convert the interrupted `_ops/remaining-issues/verify-final.log` into a full verification pass.
