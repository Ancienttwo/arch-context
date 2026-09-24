# MCP approval boundary — issue #168

Baseline: `main@0b82128`. Scope: MCP apply authorization and the ChatGPT HTTP tool allowlist.

## Root cause evidence

- Trigger: an MCP caller supplies `approved: true`, or calls a tool omitted from the ChatGPT tool list by name.
- Fault: `McpLocalServer.callTool` translated the agent's boolean into daemon approval and did not apply the surface allowlist. The HTTP route advertised the unrestricted local list.
- Pre-fix result: the forged-approval regression wrote the proposed model file; the HTTP regression found apply in its advertised tools. Both regressions failed on the baseline.
- Guard: daemon token verification, plus one shared list/call allowlist. Tests cover rejection without a token, direct-RPC boolean bypass of MCP-created drafts, explicit CLI approval, concurrent spend, replay, expiry, wrong repository/ID/digest, changed worktree and replaced preview.

## Boundary and decision

P1: MCP is an agent transport; daemon owns ChangeSet mutation. The local CLI is the operator approval channel. Existing local projection and internal apply callers keep that operator contract.

P2: MCP plan marks the stored draft as requiring MCP approval. The operator approves the returned preview digests through `archctx approve`; daemon returns an expiring random credential. MCP forwards it to `applyMcpUpdate`. The daemon checks and consumes it before invoking the existing locked, validated ChangeSet apply path. Direct `applyUpdate` refuses MCP-created drafts.

P3: approvals are transient because planned ChangeSets are already daemon-local transient state. A daemon restart requires a new preview and approval. The registry expires grants and caps outstanding entries at 256, so excess approval requests fail visibly instead of growing memory without bound. No raw token is written to runtime storage or ledger artifacts. Local operator access is trusted; MCP cannot invoke the issuer as a tool.

The MCP input changes from `approved` to `approvalToken`; there is no boolean compatibility path. The HTTP ChatGPT default excludes apply at both list and call boundaries. See the [operator runbook](../runbooks/mcp-changeset-approval.md).

## Verification

- Before the fix: both forged-approval and HTTP allowlist regressions failed.
- MCP suite: 37 passed, including official SDK wire conformance and real daemon RPC approval tests.
- Full test suite: 1862 passed, zero failures; typecheck, boundary audits and Explorer checks passed.
- Packaged smoke exercises independent CLI approval and MCP apply processes, including a restarted daemon. Its former boolean-approval flow was replaced with the token contract; packaged smoke and the remaining privacy, acceptance-ledger and eval verification stages passed.
