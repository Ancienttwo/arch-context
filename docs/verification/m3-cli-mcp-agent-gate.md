# M3 CLI / MCP / Agent Gate

Date: 2026-06-19

## Scope

M3 embeds the control loop into agent surfaces through CLI commands, local stdio MCP workflow tools, Resource indirection, first-party SOP skills, and host config generation.

## Evidence

- CLI commands: `packages/surfaces/cli/src/main.ts`.
- Local MCP server: `packages/surfaces/mcp-local/src/index.ts`.
- First-party skills: `skills/archcontext-bootstrap`, `skills/archcontext-develop`, `skills/archcontext-intervene`, `skills/archcontext-review`.
- MCP tests: `packages/surfaces/mcp-local/test/mcp-local.test.ts`.

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

- The M3 baseline exposed five workflow tools. The current local surface exposes seven, including `archcontext_practices` and `archcontext_projection`; the authoritative list is `LOCAL_MCP_TOOLS`.
- `archcontext_apply_update` and `archcontext_projection` are annotated destructive and require confirmation. MCP projection writes (`run` with apply or adopt, and `recover`) require `approved: true`, otherwise the daemon returns `AC_USER_CONFIRMATION_REQUIRED`. A `run` request's `expected` snapshot must match the repository: a missing or malformed snapshot is `AC_SCHEMA_INVALID`, a stale one is `AC_PRECONDITION_FAILED`. `recover` has no expected snapshot; it takes a receipt-bound recovery intent and re-proves the current fixed point.
- stdio MCP writes protocol output to stdout and logs to stderr.
- Skills are SOP-only and do not carry runtime business logic.
