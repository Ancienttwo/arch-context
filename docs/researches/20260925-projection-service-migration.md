# Projection service migration — issue #165

Status: implementation and targeted verification complete; full verification and hosted CI pending. Baseline: `c2a8d8ffc8c67acffd7865a961f994d594d508b9`.

## P1 — ownership

The CLI currently constructs production CodeGraph projection inputs and owns documentation rendering, adoption, expected file hashes, fixed-point computation and receipt/recovery bindings. The daemon already owns ChangeSet writes and committed receipt readback/recovery. MCP exposes only low-level plan/apply and cannot run the same projection operation. ADR-0006 and ADR-0034 require shared application semantics behind daemon RPC.

Move docs, agent-context and the versioned projection protocol orchestration into a runtime service. Preserve the existing `ProjectionRequestV1`, `ProjectionResultV2`, receipt, absence, readback and recovery contracts. CLI parses flags/JSON into typed requests and prints the returned envelope. MCP calls the same projection service through a protected daemon entrypoint. Git provenance/workspace identity helpers shared with daemon recovery have one implementation.

## P2 — trace

A protocol request checks its expected repository/worktree snapshot, reads prior committed applies, builds the projection, computes an accepted-change fixed point, plans/applies through the daemon, then verifies post-write authority and delivers the committed receipt through recovery. Adoption additionally checks its preview identity and preserves human-owned sections. A later recovery call is explicit and consumes only a verified committed receipt; readback remains non-consuming. These checks and their order must survive the move.

Existing CLI projection/adoption/readback/recovery tests are the behavior baseline and must remain intact. Add transport parity and authorization coverage around the new RPC/MCP boundary, including a real approved write, stale snapshots, missing/mismatched/expired/replayed approval and malformed requests.

## P3 — authorization and scope

#168 already prevents MCP arguments from granting write authority. A projection request's `mode: apply` or `acceptedChange` is not a human MCP approval. The new MCP entrypoint must consume a daemon-issued, short-lived, one-time token for apply/adopt/recovery, bound to canonical repository identity and the exact typed invocation. Issue tokens only through an explicit CLI command; never expose approval issuance as an MCP tool. Share the daemon approval registry with existing ChangeSet grants using distinct scope tags so tokens cannot cross-authorize operations. Consume synchronously before asynchronous work, then retain the service's snapshot and writer checks.

No new persistence authority, compatibility read path, cloud dependency or direct file-write path is introduced. CodeGraph remains daemon-owned. Existing readback/recovery results and CLI output contracts stay stable. At 10x requests, CodeGraph and renderer work remain the cost; this change does not add concurrency or caching.

Completion requires removal of CLI rendering/CodeGraph construction, CLI/MCP operation parity, self-model flow ownership updates through ChangeSet, approval regression coverage, full verification and green CI. #165 is not complete while any of those are missing.

## Implemented boundary and verification

`projection-service.ts` owns the extracted orchestration; `projection-inputs.ts` owns Git provenance and workspace identity shared with daemon recovery. The facade adds five typed RPC methods: `docsProjection`, `agentContextProjection`, `projection`, `approveMcpProjection`, and `mcpProjection`. All five have wire coverage. The CLI has no projection renderer or CodeGraph snapshot construction. Its remaining renderer imports serve independent export/resolve commands.

`archcontext_projection` is the seventh local tool. It receives `action: run|readback|recover`, a typed protocol request and an optional `approvalToken`. For writes, first use `archctx projection approve --action run --request-json '<ProjectionRequestV1>' --approved` (or `--action recover` with a recovery intent). A grant lasts five minutes, is consumed before async execution, and is bound to canonical root and exact invocation digest. Grants share a bounded registry with ChangeSet approvals, with distinct scopes. The tool is unavailable on the ChatGPT HTTP surface unless write mode is enabled. Readback remains non-consuming; recover retains committed receipt/fixed-point checks.

The existing projection/adoption scenarios and assertions remain intact. Six race/readback tests now inject at daemon methods because client `planUpdate`/`applyUpdate` interception no longer reaches the orchestration. They still use real RPC for transport cases. Ten projection scenarios pass (269 assertions); new CLI/MCP parity and real-write authorization coverage passes (61 assertions); RPC/MCP suite passes (130 tests, 538 assertions). Typecheck passes.

Self-model updates were applied using a daemon ChangeSet: new projection service component and relations, facade ownership exclusions, and the projection flow's former CLI entrypoint now names `runProjectionProtocolCommand` in the daemon service. Model validation reports no errors. Historical AL7 evidence still records its original six-tool baseline; the current product spec and M3 boundary note name seven.
