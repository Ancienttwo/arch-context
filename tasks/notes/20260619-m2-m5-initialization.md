# M2-M5 Initialization

Date: 2026-06-19

## What Changed

- Added the M2 control loop packages: application orchestration, context compiler, pressure engine, refactor decision, policy engine, ChangeSet engine, reconcile engine, and review engine.
- Added the M3 agent-facing surfaces: expanded CLI commands, local MCP workflow tools, Resource indirection, host config output, and first-party SOP skills.
- Added the M4 ChatGPT-facing local surface: loopback HTTP MCP, opt-in secure tunnel model, metadata-only cloud MCP, ChatGPT UI resource, and OAuth/PKCE client checks.
- Tightened `application` ChangeSet calls so they provide the frozen `base` and `reason` fields, while still allowing real snapshot metadata to be injected by callers.
- Added the M5 metadata-only control plane: GitHub OAuth/device auth contracts, entitlement and subscription state, D1 metadata schema, GitHub App challenge/check lifecycle, signed local attestation, queue/log/retention/cost limits, and privacy route checks.

## Why

M2-M5 need one coherent path from local architecture review to metadata-only SaaS attestation. The path is now prepare/checkpoint/plan/apply/complete through shared core packages, exposed by CLI/MCP adapters, then verified by minimal signed proof metadata for GitHub checks.

## Verification

- `bun test`: 83 pass.
- `bun run verify`: pass.
- `./scripts/check-task-workflow.sh --strict`: pass.
- `./scripts/check-context-files.sh`: pass.

## Boundary

M0-M5 are complete for the repository MVP gates recorded in `docs/verification/`. M6 launch hardening is not complete: cross-platform matrix, large-repo performance, external security review, installer/uninstaller, diagnostics, privacy audit UX, troubleshooting docs, examples, and data export/delete remain outside this initialization slice.
