# Integrated PR acceptance and issue disposition (2026-09-25)

## Subject and boundary

Source candidate: `18d2075be41a740000bfdf5b9d72961fcb1ef60f`; base: `e3d807759e917b26c539f25c51edc31946feb740`. PR #220 (`5adf469`), #221 (`fd61feb`) and #222 (`df3f8fc`) are ancestors of #223. Their behavior is tested in the integrated candidate; supersession is not merge acceptance. Records-only follow-up commits retain this tested source explicitly.

## P1: authority map

The daemon owns local runtime/auth/egress and ChangeSet mutation; CLI/MCP are triggers. Product architecture remains `.archcontext/`; generated context cannot be edited to bypass its owner. S6 evidence reads current CLI adapter metadata plus product/harness documentation and explicitly historical fixtures. repo-harness owns acceptance freeze and typed AcceptanceReceipt validation. Hosted CI and source review are separate evidence from that formal gate.

## P2: concrete traces

- `hooks status --host codex` → current `hookAdapterContract` → S6 v2 required fields and current adapter assertions → generated/inspected docs readback. Primary hook is enqueue; checkpoint is the existing explicitly advertised fallback. Missing boundary/evidence fields reject the packet. Frozen v1 bytes remain archived.
- `verify-sprint --prepare-acceptance` → automatic architecture projection → provider snapshot observation → `architectureAgentContextTargets()` → `capabilityRegistryFromArchcontextNodes()` → rejects the current two-part capability ID before launching projection or freezing acceptance.
- The repository initializer creates that same ID. The installed harness also requires responsibilities/extensions and a different include/exclude shape, so a textual ID rename would merely expose the next rejection.

## P3: decision

Preserve runtime/model authority and fail closed on missing acceptance evidence. The S6 repair changes current evidence validation, not runtime semantics or historical verdicts. Migrate the retired contract execution keys through the supported Verification Plan tool while preserving all four checks: the targeted Explorer session test, typecheck, package-boundary audit and full verify. The targeted file runs as an explicit `bun test <file>` command because `package_test` expects a package with `scripts.test`.

Track the cross-package architecture contract in #225. A real repair requires agreed ownership semantics, aligned initialization/validation, and (if needed) one explicit ChangeSet migration of every reference and projection. At larger model size, incomplete identity/source-scope migration first breaks ownership and reference integrity; relaxing validation would hide this. No global automatic-projection disablement, direct model write, fabricated receipt or user waiver was used.

## Verification and disposition

Hosted Verify run **36149269956 passed all ten jobs**. Each suite ran 2115 tests: Linux/Governance 2113 pass + 2 skips, macOS/Windows 2114 pass + 1 skip; zero failures. The Windows Node 25 docs digest case passed in 3.385s with its unchanged 15s deadline. All ten archives match GitHub digests; the existing FG6 matrix inspector accepted current run/jobs/native payloads. Source and merge trees match. See `docs/verification/20260925-integrated-pr-hosted-ci.json`.

**Formal disposition: BLOCKED**, with no AcceptanceReceipt. #225 prevents acceptance freeze. Direct local contract verification also failed: three executable preflights passed, but full verify returned 2112 pass / 1 skip / 2 fail (2115 tests, 12128 assertions, 1283.60s for the test suite; 1306.151s for the full command). CodeGraph handshake timed out in the documentation-drift completion case; a different projection RPC readback case exceeded its 120s outer deadline. Subsequent verify commands were not reached. #226 retains the exact test entrypoints and bounded diagnosis criteria. Current hosted success does not make these local failures pass. No blind rerun, timeout change or out-of-scope repair followed the second new failure. Local execution records and log/source hashes: `docs/verification/20260925-integrated-pr-acceptance.json`.

PRs #220/#221/#222 were closed as superseded, preserving branches/history. #223 remains Draft and unmerged. The old contract syntax was migrated; the first mapping incorrectly treated a test-file path as `package_test`, failed before executing checks, and was corrected to the same explicit `bun test` command. That setup error is separate from the real full-suite failures.

#162 local-state truthfulness is completed and closed; #224 and its Cloud control-plane delivery milestone retain D1/Queue/OAuth/device registration and cross-process credentials as real cloud delivery gates. #164 remains open with explicit RPC decoder and remaining service extractions. #171 candidate implementation is recorded per item and stays open pending formal acceptance/landing. #225 and #226 block formal #223 acceptance. No release, deployment or cloud activation was performed.

Historical run 36144083941 remains failed (Windows Node 25 docs digest test, 16.798s against 15s); its slow phase is unproven. The current matrix retains the same 15-second deadline and assertions; a subsequent pass does not retroactively prove a root cause.
