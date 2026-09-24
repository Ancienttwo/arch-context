# Issue cleanup: runtime boundary bugs

Date: 2026-09-25. Scope: the owner's bug-only cleanup batch, based on `main@995b03f` after PR #189. This is an investigation and validation snapshot, not a release or acceptance receipt.

## Findings and fixes

| Issue | Trace and root cause | Result |
|---|---|---|
| #188 | `computeWorktreeDigest` hashes hook output written between ChangeSet preview and apply. | Exclude the root harness `checks`, `evidence`, and `runs` trees from the ChangeSet digest. Tracked source and harness policy remain bound. The repository file inventory is unchanged. |
| #183 | `doctorReport` used its own process environment even when a separate daemon was executing work. | The daemon health response reports its actual Context7 adapter configuration, daemon environment, and repository audit consent. Doctor uses that report; without a daemon it labels the report `cli-environment`. A running daemon without a report yields unknown egress, not a local-only assertion. |
| #169 | `jobsComplete` forwarded metadata, errors, and advisory proposal bodies to the job store without the ledger persistence guard. The agent and ledger raw-key sets disagreed. | Validate the combined completion payload before persistence, using existing size/depth limits, secret checks, bare unified-hunk detection, and one exported raw-key set. Rejected drafts never become pending audit proposals or reach GitHub publishing. |
| #174 | The stdio adapter exposed business envelopes directly, omitted schemas, echoed unsupported protocol versions, and let JSON parse errors end the loop. | Publish and validate six tool schemas, emit text content arrays with `isError`, return JSON-RPC errors, recover after bad input, and negotiate the existing `2025-03-26` version. Business envelope types remain unchanged behind the adapter. |

Egress formatting has two consumers and one implementation under local-runtime; the daemon does not acquire a dependency on cloud. MCP schema validation uses the existing contracts validator. The official MCP SDK is a pinned development dependency used by the stdio contract test, not a production runtime dependency.

The digest continues to traverse source files, so source volume remains its scaling limit. The persistence guard has the existing 256 KiB payload, 8 KiB string and depth-32 limits. Egress health reads configuration without creating repository sessions, snapshots, or network requests. This batch makes no broad 10x performance claim.

## Verification

- Each issue had a failing regression on the unfixed implementation before its fix.
- `bun run verify:governance`: exit 0; 24 commands, 0 skipped. Its nested `verify` included typecheck, package boundaries, production mock reachability, the full suite (1851 passed, 0 failed), Explorer, packaged CLI smoke, privacy checks and evals.
- `bun run e2e:local-product-tarball`: exit 0; local tarball installation, CLI/daemon/MCP invocation, upgrade and uninstall exercised in temporary directories. No registry publication occurred.
- Read-only security, architecture, and four adversarial passes found no blocking introduced defects. The final smoke assertion updates were checked against the actual standard MCP wire response.
- The two old approval-stage rejection tests now check rejection before persistence, including no pending audit proposal and no GitHub calls. This follows the earlier security boundary rather than allowing unsafe fixture data to be stored.

MCP references: [tools](https://modelcontextprotocol.io/specification/2025-03-26/server/tools), [version negotiation](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle).

## Remaining issue boundaries

Live GitHub readback confirmed #161 and #179 closed, superseding their open status in the previous fix-round handoff. PR #189 is merged and continues the separate #163 workstream.

| Issues | Disposition |
|---|---|
| #163, #164, #165, #166 | Continue their architecture/model/refactor workstreams separately. |
| #168 | Surface authorization and out-of-band approval remain a separate security contract. Strict stdio argument types do not resolve this issue. |
| #162 | Synthetic credentials and connection truthfulness need the local/cloud delivery scope decision recorded in the previous handoff. |
| #170 | Public `archctx-contracts` staging is intentional in the existing release flow; reconciling its source package and ADR requires the release-contract decision. |
| #171 | Mixed hygiene/security roundup remains open; this batch does not claim its individual findings resolved. |

The four fixed issues should close when their PR merges. Hosted CI, merge, release publication, and installation into the owner's active runtime are separate from the local evidence above.
