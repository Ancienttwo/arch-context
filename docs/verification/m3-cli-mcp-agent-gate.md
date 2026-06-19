# M3 CLI / MCP / Agent Gate

Date: 2026-06-19

## Scope

M3 embeds the control loop into agent surfaces through CLI commands, local stdio MCP workflow tools, Resource indirection, first-party SOP skills, and host config generation.

## Evidence

- CLI commands: `packages/cli/src/main.ts`.
- Local MCP server: `packages/mcp-local/src/index.ts`.
- First-party skills: `skills/archcontext-bootstrap`, `skills/archcontext-develop`, `skills/archcontext-intervene`, `skills/archcontext-review`.
- MCP tests: `packages/mcp-local/test/mcp-local.test.ts`.

## Verified Path

```text
archctx prepare
  -> application prepareTask
  -> JSON/Human render support
  -> max-bytes/max-items budget

archcontext_prepare_task
  -> same posture semantics as CLI
  -> large content becomes Resource URI

archcontext_plan_update/apply_update
  -> preview without write
  -> explicit approval required
  -> stale digest denied

archcontext_complete_task
  -> ReviewResult gate before final response
```

## Verification

Command:

```bash
bun test
```

Observed result:

```text
70 pass
0 fail
```

## Boundary Notes

- MCP exposes exactly five workflow tools.
- `archcontext_apply_update` is annotated destructive and requires confirmation.
- stdio MCP writes protocol output to stdout and logs to stderr.
- Skills are SOP-only and do not carry runtime business logic.
