# Practice Assets S4 Waiver Governance

This slice completes the S4 waiver write path after deterministic complete enforcement. It keeps waiver writes inside the existing ChangeSet approval boundary instead of adding a direct mutation command.

## P1 Map

- Contracts: `schemas/runtime/changeset.schema.json` now accepts `write_waiver`; waiver payload shape remains `schemas/repo/practices/practice-waiver.schema.json`.
- Policy boundary: `packages/core/policy-engine/src/index.ts` adds `.archcontext/waivers/` to the local write allowlist.
- ChangeSet engine: `packages/core/changeset-engine/src/index.ts` treats `write_waiver` as a normal approved file write with expected hash, allowlist validation, journal, rollback, and generated projection rebuild.
- Practice engine: `packages/core/practice-engine/src/enforcement.ts` builds an owner registry from `.archcontext/model/nodes/**` `ownership.lifecycle` and `ownership.data`, then rejects JSON-compatible waiver files whose owner is not registered.
- Runtime: `packages/local-runtime/runtime-daemon/src/index.ts` exposes `practiceWaivers` for readback and `planPracticeWaiver` for ChangeSet draft creation.
- CLI: `packages/surfaces/cli/src/main.ts` exposes `archctx practices waivers` and `archctx practices waive`.

Out of scope: new deterministic checkers such as dependency-direction, owner-required, migration cleanup, and required-test-evidence. MCP already has generic `plan_update`/`apply_update`; this slice does not add a destructive waiver-specific MCP command.

## P2 Trace

Concrete write path:

1. `archctx practices waive --practice-id ... --owner ... --expires-at ... --evidence-digest ... --subject ...` parses required waiver fields in the CLI.
2. The CLI calls `RuntimeDaemonClient.planPracticeWaiver`; no file is written by the CLI command.
3. Runtime opens the repo session, validates the current model, loads owner truth from `.archcontext/model/nodes/**`, validates the waiver, and rejects unknown owners.
4. Runtime creates a deterministic `.archcontext/waivers/<waiver-id>.json` body and plans a ChangeSet operation `{ op: "write_waiver", path, expectedHash, body }`.
5. The preview path runs through policy-engine allowlist checks. The draft records current `headSha`, `worktreeDigest`, and `modelDigest`.
6. The actual file write requires the existing apply path with explicit approval and matching worktree digest. Apply writes through the ChangeSet engine journal and rollback machinery.
7. `archctx practices waivers` reads JSON-compatible `.archcontext/waivers/*` files, validates each waiver against the current owner registry, and returns waiver digests for audit.

Error paths covered: missing CLI fields, missing scope, unknown owner, invalid waiver id, path allowlist denial, stale worktree digest at apply, and existing expected-hash mismatch.

## P3 Decision

The core invariant is that an agent can propose a waiver but cannot silently create durable policy exceptions. Keeping writes behind ChangeSet means waiver creation inherits the same local approval, worktree digest, path allowlist, symlink denial, journal, and rollback behavior as other architecture-governed writes.

The owner registry is intentionally derived from the model instead of introducing a second owner database. At 10x scale, the first pressure point will be richer YAML parsing and owner lifecycle states; this slice keeps the registry as a deterministic read model over existing architecture ownership fields.

## Verification Readback

Commands executed during implementation:

```bash
bun test packages/core/practice-engine/test/practice-engine.test.ts packages/core/changeset-engine/test/changeset-engine.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts
bun run typecheck
git diff --check
node scripts/sprint-status-check.mjs
bun test packages/surfaces/cli/test/local-product-e2e.test.ts
bun run verify
```

Observed readbacks:

- Targeted waiver/governance matrix: 50 pass / 0 fail / 535 expects across practice-engine, changeset-engine, runtime-daemon, and CLI tests.
- `bun run typecheck`: pass.
- `git diff --check`: pass.
- `node scripts/sprint-status-check.mjs`: `STRUCTURE AND EVIDENCE CLAIMS OK`.
- `bun test packages/surfaces/cli/test/local-product-e2e.test.ts`: 3 pass / 0 fail / 59 expects. This was rerun after one full-verify attempt hit a 15s child-process timeout in the same E2E test.
- Final `bun run verify`: 597 pass / 0 fail / 3556 expects; packaged CLI smoke, privacy/security manifests, acceptance ledger, sprint status check, and representative eval all passed.

## Gate Evidence

- S4-16: `loadPracticeWaivers` now validates waiver owners against the model-derived owner registry; targeted tests reject `unknown-team`.
- S4-17: `write_waiver` is schema-valid, allowlisted only under `.archcontext/waivers/`, journaled, and applied through ChangeSet with expected worktree digest.
- S4-18: `archctx practices waivers` reads current waiver state; `archctx practices waive` produces a ChangeSet draft and requires the existing explicit apply step for mutation.
