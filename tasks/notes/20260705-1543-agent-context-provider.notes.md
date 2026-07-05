# Implementation Notes: agent-context-provider

> **Status**: Active
> **Plan**: plans/plan-20260705-1543-agent-context-provider.md
> **Contract**: tasks/contracts/20260705-1543-agent-context-provider.contract.md
> **Review**: tasks/reviews/20260705-1543-agent-context-provider.review.md
> **Last Updated**: 2026-07-05 15:44
> **Lifecycle**: notes

## Design Decisions

- `NativeNode.source` is typed as `Json` (not a nested named `NativeNodeSource` interface),
  because `NativeNode extends Record<string, Json | undefined>` and TypeScript rejects a
  named interface property whose own index signature isn't exactly `Json` (TS2411),
  even when every concrete field is Json-compatible. Added `nativeNodeSource(node)` as the
  one typed accessor (`packages/core/projection-engine/src/index.ts`); all new code reads
  `source` through it instead of casting inline.
- Agent-context target objects (`AgentContextProjectionTarget`) use a locally-scoped type
  in `projection-engine/src/index.ts`, not the strict `ProjectionTargetV1`/
  `ProjectionTargetType` from `packages/contracts/src/ledger.ts` — that file is outside
  this contract's `allowed_paths` (only `packages/contracts/test/` is listed), so the
  `"agent-context"` literal cannot be added to the TS union there. The JSON Schema
  (`schemas/runtime/projection-target.schema.json`, in allowed_paths and the actual
  runtime validation source of truth) was updated normally. The new type is structurally
  identical to `ProjectionTargetV1`, so widening the contracts union later is a
  compatible, additive follow-up.
- `renderAgentContextProjection` is an independent entrypoint, not folded into
  `renderArchitectureDocumentationProjection`'s `docs/architecture/*` pipeline. That
  pipeline's existing-file discovery (`loadArchitectureDocumentationFiles`) only scans a
  fixed whitelist under `docs/architecture/*`, and its drift/merge functions
  (`findGeneratedRegion` et al.) hardcode the `<!-- BEGIN ARCHCONTEXT:generated ... -->`
  marker family. The brief specifies a distinct marker label, `BEGIN/END ARCHCONTEXT
  AGENT CONTEXT`, for the agent-context region, most plausibly so it doesn't collide with
  repo-harness's own pre-existing CLAUDE.md/AGENTS.md generated-block mechanism
  (`context-contract-sync.sh`, referenced in this repo's own root `CLAUDE.md`) when the
  two coexist in the same file. Reusing the existing pipeline's marker/drift machinery
  wholesale would have meant either colliding marker formats or a generalization of that
  machinery well beyond "target construction + marker rendering."
- Replaced the ad hoc flat YAML parser (`parseFlatYaml`/`readYamlObjects`) in
  `projection-engine` with the repo's existing full-fidelity `parseJsonOrStableYaml`
  (`packages/core/architecture-domain/src/index.ts`, imported via the same relative-path
  pattern `architecture-ledger` already uses). The flat parser only read unindented
  top-level scalars and silently dropped nested structures, so it could never have
  produced `node.source.include`/`node.extensions` — both required for agent-context
  rendering and `resolve`. Verified no regression: `packages/surfaces/renderer/test/
  renderer.test.ts` (existing, out of allowed_paths, not edited) still passes unchanged.
- `archctx resolve --path` exit codes (0/1/2) are new, isolated CLI behavior. Confirmed by
  reading the dispatcher that every other command always exits `0` regardless of the
  envelope's `ok` field (the only other `process.exitCode` write in the file is the
  `daemon start --foreground` crash path). Implemented as one added `if (command ===
  "resolve") process.exitCode = resolveCommandExitCode(result);` line plus one exported
  helper, instead of changing exit-code behavior for every command.
- The `resolve` envelope always returns `ok: true` with `data.matched`/`data.ambiguous`
  flags, rather than an error code, for the no-match/ambiguous cases.
  `packages/contracts/src/schema.ts`'s `ArchContextErrorCode` enum is out of allowed_paths
  and none of the existing codes fit "no owner" or "ambiguous owner." This also matches
  the ADR's framing: ambiguity is a deliberate, first-class resolution outcome, not a
  thrown error.
- `primarySourceDirectoryFromInclude`: the directory root of a `source.include` entry is
  the literal prefix before its first `*`/`?`, truncated back to the last `/`; a literal
  entry with no wildcard is treated as an entrypoint file and resolves to its containing
  directory. This was the plan's one named open implementation detail; the exact rule is
  now written into ADR-0043 §4 rather than left implicit in code.

## Deviations From Plan Or Spec

- The brief said to read ADR-0042 (and one or two others) for format. ADR-0041/ADR-0042 do
  not exist in this worktree at base `2729112` (highest present is ADR-0040) — presumably
  reserved by concurrent sibling work off a later `main`. Used ADR-0040, ADR-0037, and
  ADR-0026 for format instead; ADR-0043 itself is written exactly as named by the contract
  and plan, so the target filename/number was never in question.
- Test group (b) ("projection-engine test for agent-context target construction + marker
  rendering") and the pure-function half of group (c) ("resolve 4 型") were added under a
  new `packages/core/projection-engine/test/` directory, rather than extending
  `packages/surfaces/renderer/test/renderer.test.ts`, which is where every other
  projection-engine rendering behavior is currently tested. `packages/surfaces/renderer/`
  is not in this contract's `allowed_paths`; `packages/core/projection-engine/` is, and a
  per-module `test/` directory is already the dominant convention across every other
  `packages/core/*` module (projection-engine was the one exception, with no test
  directory of its own before this change).
- The CLI-level half of group (c) (end-to-end `archctx resolve --path` behavior plus the
  exit-code mapping) was added to the existing `packages/surfaces/cli/test/cli.test.ts`,
  matching that file's single-flat-`describe` convention.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Fold `agent-context` into `renderArchitectureDocumentationProjection`'s existing docs/architecture/* pipeline | Rejected — built an independent `renderAgentContextProjection` entrypoint | Existing pipeline's file discovery and marker/drift functions are hardcoded to `docs/architecture/*` paths and the `ARCHCONTEXT:generated` marker family; forcing agent-context through it means either a marker collision or a scope-expanding generalization of tested, shared code |
| Widen `parseFlatYaml` to also parse nested `source`/`extensions` | Rejected — reused the existing `parseJsonOrStableYaml` full-fidelity parser | Avoids a second hand-rolled YAML parser for the same file shape; `parseJsonOrStableYaml` already round-trips `stableYaml()` output exactly, verified via the existing renderer test |
| Tie process exit code to the `ok` field for every CLI command | Rejected — special-cased only `resolve` | Every other command currently always exits `0` regardless of `ok`; a global change is out of scope and risks unrelated regressions |
| Widen `packages/contracts/src/ledger.ts`'s `ProjectionTargetType` union to add `"agent-context"` | Rejected — locally-scoped structural type in projection-engine | `packages/contracts/src/` is outside this contract's allowed_paths |

## Open Questions

- `docs/adr/README.md`'s ADR index table was not updated to list ADR-0043 — that file is
  outside this contract's allowed_paths.
- Wiring `agent-context` into an actual write path (a `docs apply`-style command that
  writes `<primarySourceDir>/CLAUDE.md`/`AGENTS.md` to disk through ChangeSet, per
  ADR-0040's ledger-mutation boundary) is not implemented. Scope named "target
  construction + marker rendering" only; `renderAgentContextProjection` is a pure
  function today with no CLI-triggered disk write.
- `packages/contracts/src/ledger.ts`'s `ProjectionTargetType` union does not include
  `"agent-context"` (see Tradeoffs). A follow-up contract should widen it once
  agent-context targets need to flow through code typed against the strict contracts
  interface.
- ADR-0041/ADR-0042 numbering gap: neither exists in this worktree at base `2729112`
  (highest present is ADR-0040). Not renumbered or backfilled here; presumably owned by
  concurrent sibling work.
- Confirmed out of scope and untouched, per the contract: repo-harness Stage 0 adapter,
  MCP `prepare_task` output extension, PRD §29.3 Q1 (node kind enum openness), PRD
  §17.7:2235 write-time overlap-exclusivity validator, and migrating repo-harness's six
  existing capabilities.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
