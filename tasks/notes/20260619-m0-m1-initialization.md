# M0/M1 Initialization

Date: 2026-06-19

## What Changed

- Initialized the repository Git state.
- Added the M0 contracts package, JSON schemas, fixtures, ADR records, threat model, and verification note.
- Added local runtime packages for architecture-domain, git-adapter, local-store-sqlite, codegraph-adapter, model-store-yaml, runtime-daemon, and the thin cli.
- Added root README and local verification scripts for privacy route and sprint status checks.
- Updated the sprint tracker to mark M0 contract freeze and M1 local runtime complete.

## Why

The sprint requires contract freeze before runtime, CLI, MCP, SaaS, GitHub, and skills work. Freezing schema and port contracts first prevents downstream packages from inventing incompatible semantics; the local runtime slice then proves the offline init/sync/validate/context/status path before cloud or MCP work begins.

## Verification

- `bun test`: 38 pass.
- `bun run verify`: pass.

## Tradeoff

The contracts package uses a minimal in-repo JSON Schema validator for deterministic M0 fixture checks. It is sufficient for the current schema subset, but replacing it with a standards-complete validator is a future implementation decision, not required for the initialization slice.

The CLI package is counted only for the M1 thin local commands required by the runtime gate. It does not mark M3 MCP/Agent integration complete.
